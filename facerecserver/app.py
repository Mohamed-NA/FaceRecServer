from __future__ import annotations

import base64
import binascii
import json
import ssl
import threading

import cv2
import numpy as np
from flask import Flask, render_template
from flask_socketio import SocketIO

from facerecserver.inference import FaceRecognizer
from facerecserver.paths import CERTIFICATES_DIR, CONFIG_DIR, MODEL_DIR, PROJECT_ROOT

app      = Flask(
    __name__,
    template_folder=str(PROJECT_ROOT / "templates"),
    static_folder=str(PROJECT_ROOT / "static"),
)
socketio = SocketIO(app, async_mode="threading")

_config    = json.loads((CONFIG_DIR / "recognizer.json").read_text())
recognizer = FaceRecognizer(MODEL_DIR / "face_embeddings.json", _config)

# Latest frame + detection results — used by enroll_request
_last_frame:   np.ndarray | None = None
_last_results: list[dict]        = []
_frame_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# WebSocket — video stream
# ---------------------------------------------------------------------------

@socketio.on("video_frame")
def handle_video_frame(data: str) -> None:
    global _last_frame

    if not isinstance(data, str) or "," not in data:
        socketio.emit("server_error", {"error": "Invalid frame payload"})
        return

    try:
        img_bytes = base64.b64decode(data.split(",", 1)[1])
    except (ValueError, binascii.Error):
        socketio.emit("server_error", {"error": "Could not decode frame"})
        return

    frame = cv2.imdecode(np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        socketio.emit("server_error", {"error": "Could not parse image"})
        return

    results = recognizer.predict(frame)

    with _frame_lock:
        _last_frame   = frame.copy()
        _last_results = results[:]

    recognizer.draw(frame, results)

    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    frame_b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode()

    socketio.emit("server_frame", frame_b64)
    socketio.emit("detections", [
        {"name": r["name"], "distance": r["distance"], "box": list(r["box"])}
        for r in results
    ])


# ---------------------------------------------------------------------------
# WebSocket — live enrollment
# ---------------------------------------------------------------------------

@socketio.on("enroll_request")
def handle_enroll(data: dict) -> None:
    """Enroll one face by label.

    Expects: {label: "Unknown 2", name: "Alice"}
    The label must match a result from the most recent predict() call.
    """
    label = (data.get("label") or "").strip()
    name  = (data.get("name")  or "").strip()
    if not label or not name:
        socketio.emit("enroll_failed", {"label": label, "reason": "Label and name are required"})
        return

    with _frame_lock:
        frame   = _last_frame.copy()   if _last_frame   is not None else None
        results = list(_last_results)

    if frame is None:
        socketio.emit("enroll_failed", {"label": label, "reason": "No frame available yet"})
        return

    target = next((r for r in results if r["name"] == label), None)
    if target is None:
        socketio.emit("enroll_failed", {"label": label, "reason": f"'{label}' is no longer in frame"})
        return

    ok = recognizer.enroll_at_box(frame, name, tuple(target["box"]))
    if ok:
        socketio.emit("enrolled", {"name": name, "label": label})
    else:
        socketio.emit("enroll_failed", {"label": label, "reason": "Could not extract face encoding"})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    cert = CERTIFICATES_DIR / "certificate.crt"
    key  = CERTIFICATES_DIR / "private.key"

    ssl_ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_ctx.load_cert_chain(certfile=str(cert), keyfile=str(key))

    socketio.run(
        app,
        host="0.0.0.0",
        port=8080,
        ssl_context=ssl_ctx,
        allow_unsafe_werkzeug=True,
    )


if __name__ == "__main__":
    main()
