from __future__ import annotations

import json
import threading
from pathlib import Path

import cv2
import face_recognition
import numpy as np


class FaceRecognizer:
    """Face detection, recognition, and live enrollment. Thread-safe."""

    def __init__(self, embeddings_path: Path, config: dict) -> None:
        self._path      = embeddings_path
        self._threshold = float(config.get("distance_threshold", 0.5))
        self._model     = str(config.get("detection_model", "hog"))
        self._lock      = threading.Lock()
        self._db: dict[str, list[np.ndarray]] = self._load()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, frame: np.ndarray) -> list[dict]:
        """Return [{name, distance, box}, …] for every face in *frame*.

        Unknown faces are numbered left-to-right: "Unknown 1", "Unknown 2", …
        so the browser can reference them by a stable label within the frame.
        """
        rgb       = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        locations = face_recognition.face_locations(rgb, model=self._model)
        if not locations:
            return []
        encodings = face_recognition.face_encodings(rgb, locations)

        with self._lock:
            db = {name: list(vecs) for name, vecs in self._db.items()}

        # Sort by left-edge so numbering is stable left → right
        pairs = sorted(zip(encodings, locations), key=lambda p: p[1][3])

        results    = []
        unknown_n  = 1
        for enc, loc in pairs:
            name, dist = self._match(enc, db)
            if name == "Unknown":
                name = f"Unknown {unknown_n}"
                unknown_n += 1
            results.append({"name": name, "distance": round(dist, 4), "box": loc})
        return results

    def enroll_at_box(self, frame: np.ndarray, name: str,
                      box: tuple[int, int, int, int]) -> bool:
        """Extract the embedding at *box* (top, right, bottom, left) and save
        it under *name*.  Returns True on success."""
        rgb       = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb, [box])
        if not encodings:
            return False
        with self._lock:
            self._db.setdefault(name, []).append(encodings[0])
            self._save()
        return True

    def draw(self, frame: np.ndarray, results: list[dict]) -> np.ndarray:
        """Draw bounding boxes and name labels onto *frame* in-place."""
        for r in results:
            top, right, bottom, left = r["box"]
            known = not r["name"].startswith("Unknown")
            color = (70, 210, 100) if known else (80, 80, 220)   # BGR

            cv2.rectangle(frame, (left, top), (right, bottom), color, 2)

            label = r["name"]
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(frame, (left, bottom), (left + tw + 8, bottom + th + 12), color, -1)
            cv2.putText(frame, label, (left + 4, bottom + th + 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        return frame

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _match(self, enc: np.ndarray, db: dict) -> tuple[str, float]:
        best_name = "Unknown"
        best_dist = float("inf")
        for name, vecs in db.items():
            if not vecs:
                continue
            dist = float(np.min(face_recognition.face_distance(vecs, enc)))
            if dist < best_dist:
                best_dist = dist
                if dist < self._threshold:
                    best_name = name
        return best_name, best_dist if best_name != "Unknown" else 1.0

    def _load(self) -> dict[str, list[np.ndarray]]:
        if not self._path.exists():
            return {}
        raw = json.loads(self._path.read_text())
        return {name: [np.array(e) for e in vecs] for name, vecs in raw.items()}

    def _save(self) -> None:
        data = {name: [e.tolist() for e in vecs] for name, vecs in self._db.items()}
        self._path.write_text(json.dumps(data, indent=2))
