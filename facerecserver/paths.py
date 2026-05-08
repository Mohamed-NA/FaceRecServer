from __future__ import annotations

from pathlib import Path


def find_project_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "pyproject.toml").exists() and (candidate / "config" / "recognizer.json").exists():
            return candidate
    raise RuntimeError("Could not locate the FaceRecServer project root.")


PROJECT_ROOT = find_project_root(Path(__file__).resolve().parent)
DATA_DIR = PROJECT_ROOT / "data"
MODEL_DIR = PROJECT_ROOT / "model"
CONFIG_DIR = PROJECT_ROOT / "config"
CERTIFICATES_DIR = PROJECT_ROOT / "certificates"

for path in (DATA_DIR, MODEL_DIR, CONFIG_DIR):
    path.mkdir(parents=True, exist_ok=True)
