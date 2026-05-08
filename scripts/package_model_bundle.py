"""
Package model/face_embeddings.json into dist/model-bundle.tar.gz.

Usage:
    uv run scripts/package_model_bundle.py [--output PATH]
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path

from facerecserver.paths import MODEL_DIR, PROJECT_ROOT


def _bundle_files() -> list[Path]:
    if not MODEL_DIR.exists():
        raise FileNotFoundError(f"Missing model directory: {MODEL_DIR}")
    files = sorted(
        p for p in MODEL_DIR.iterdir()
        if p.is_file() and p.name not in {".gitkeep", "README.md"}
    )
    if not files:
        raise FileNotFoundError("No model files found in model/. Enroll at least one person first.")
    return files


def package(output: Path) -> tuple[Path, Path]:
    output.parent.mkdir(parents=True, exist_ok=True)
    files    = _bundle_files()
    manifest = {
        "project": "facerecserver",
        "files": [
            {
                "path": f"model/{p.name}",
                "size_bytes": p.stat().st_size,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
            for p in files
        ],
    }
    manifest_bytes = json.dumps(manifest, indent=2).encode()

    with tarfile.open(output, "w:gz") as arc:
        for p in files:
            arc.add(p, arcname=f"model/{p.name}")
        info      = tarfile.TarInfo("manifest.json")
        info.size = len(manifest_bytes)
        arc.addfile(info, fileobj=io.BytesIO(manifest_bytes))

    sha_path = output.with_suffix(output.suffix + ".sha256")
    digest   = hashlib.sha256(output.read_bytes()).hexdigest()
    sha_path.write_text(f"{digest}  {output.name}\n")
    return output, sha_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Package embeddings into a release bundle.")
    parser.add_argument("--output", type=Path,
                        default=PROJECT_ROOT / "dist" / "model-bundle.tar.gz")
    args = parser.parse_args()
    bundle, sha = package(args.output)
    print(f"Bundle   → {bundle}")
    print(f"Checksum → {sha}")


if __name__ == "__main__":
    main()
