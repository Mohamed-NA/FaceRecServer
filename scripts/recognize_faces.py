"""
Standalone live face recognition test — no Flask, just OpenCV window.

Requires model/face_embeddings.json (enroll people via the web app first,
or the script will label every face Unknown until you do).

Usage:
    uv run scripts/recognize_faces.py [--camera INT]

Controls:
    Q — quit
"""
from __future__ import annotations

import argparse
import json
import sys

import cv2

from facerecserver.inference import FaceRecognizer
from facerecserver.paths import CONFIG_DIR, MODEL_DIR


def run(camera_index: int) -> None:
    config     = json.loads((CONFIG_DIR / "recognizer.json").read_text())
    recognizer = FaceRecognizer(MODEL_DIR / "face_embeddings.json", config)

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        sys.exit(f"Cannot open camera {camera_index}")

    print("Press Q to quit.")
    while True:
        ok, frame = cap.read()
        if not ok:
            continue

        frame   = cv2.flip(frame, 1)
        results = recognizer.predict(frame)
        recognizer.draw(frame, results)

        label = f"Faces: {len(results)}  Q=quit"
        cv2.rectangle(frame, (0, 0), (frame.shape[1], 26), (22, 22, 22), -1)
        cv2.putText(frame, label, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)

        cv2.imshow("FaceRec", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


def main() -> None:
    parser = argparse.ArgumentParser(description="Standalone live face recognition.")
    parser.add_argument("--camera", type=int, default=0)
    args = parser.parse_args()
    run(args.camera)


if __name__ == "__main__":
    main()
