# FaceRecServer — Documentation

**Debi Hackathon — May 2026**

---

## Overview

FaceRecServer is a real-time, browser-based face recognition system built for the Debi Hackathon. It solves a practical problem: identifying people by name from a live camera feed, with no offline training step and no special hardware required.

The core idea is simple. A user opens the web app in any modern browser, points their camera at a group of people, and the server draws a labelled bounding box around every face it sees — green for someone it recognises, red for an unknown. When the server encounters an unknown face, the user can enroll that person live: click "Add Person", type their name, and from that moment on the system recognises them. The entire enrollment-to-recognition cycle takes under five seconds.

The system is self-contained. It runs over HTTPS (required for camera access), streams annotated video back to the browser over WebSocket, and persists all known faces to a JSON file that survives server restarts. It ships as a Docker Compose stack and has a full CI/CD pipeline on GitHub Actions.

---

## Architecture

### High-level flow

```
Browser                             Server (Flask + SocketIO)
───────                             ─────────────────────────
getUserMedia()  ──video_frame──►   base64 decode
                                   OpenCV → numpy frame
                                   FaceRecognizer.predict()
                                     face_recognition.face_locations()
                                     face_recognition.face_encodings()
                                     compare vs face_embeddings.json
                                     label: name or "Unknown N"
                                   FaceRecognizer.draw()
                                     green box  → known person
                                     red box    → Unknown N
                                   JPEG re-encode
◄──server_frame──  annotated JPEG
◄──detections───   [{name, distance, box}, …]
render canvas
draw yellow highlight (if selected)
```

### Enrollment flow

```
User clicks face on canvas
    │
    ▼
selectedLabel = "Unknown 2"         (client-side, by proximity)
    │
User opens "Add Person" form
    │   shows: Unknown 1 [______]
    │           Unknown 2 [______]  ← highlighted row (yellow outline)
    │           Unknown 3 [______]
    │
User fills in names, clicks Save All
    │
    ▼
socket.emit("enroll_request", {label: "Unknown 2", name: "Alice"})
                                    │
                                    ▼
                              look up "Unknown 2" in _last_results
                              get its bounding box
                              face_recognition.face_encodings(frame, [box])
                              append 128-d vector to face_embeddings.json
                              emit "enrolled" {name: "Alice", label: "Unknown 2"}
    │
    ▼
"Alice" recognised on next frame
```

### Project structure

```
FaceRecServer/
├── facerecserver/
│   ├── app.py          Flask + SocketIO server (video_frame, enroll_request)
│   ├── inference.py    FaceRecognizer class (predict, enroll_at_box, draw)
│   └── paths.py        Project root resolution, directory constants
├── scripts/
│   ├── run_server.py           Start the HTTPS server
│   ├── recognize_faces.py      Standalone OpenCV live test (no Flask)
│   └── package_model_bundle.py Package face_embeddings.json for Docker release
├── config/
│   └── recognizer.json         distance_threshold, detection_model
├── model/
│   └── face_embeddings.json    {"Alice": [[128-d vector], …], …}
├── templates/index.html        Browser UI
├── static/script.js            WebSocket client, canvas overlay, enroll form
├── certificates/               Self-signed TLS cert + private key
├── infra/docker/
│   ├── Dockerfile.app          Python 3.12 + dlib build deps
│   ├── Dockerfile.models       Debian slim, unpacks embeddings into shared volume
│   ├── compose.yaml            Two-service stack (models → app)
│   └── copy_models.sh          Copies bundle into shared Docker volume
└── .github/workflows/
    └── publish.yml             CI: test → push app image → push models image
```

### Recognition engine

Face recognition is powered by the `face_recognition` library, which wraps a dlib ResNet model trained on 3 million faces. For each detected face it produces a 128-dimensional floating-point vector (an embedding) that encodes the face's geometry. Two embeddings from the same person are close in this 128-d space; embeddings from different people are far apart.

At recognition time the server computes the Euclidean distance between the incoming embedding and every stored vector for every enrolled person. The person whose minimum distance falls below the configured threshold (default `0.5`) is declared the match. Anything above the threshold is labelled Unknown.

This approach requires no training phase — enrollment is simply appending a new vector to a JSON file. Multiple enrollments of the same person (different angles, lighting) are all stored and each one is compared independently, which improves accuracy under varied conditions.

### Docker deployment

Two images are used, following the same pattern as the sibling StreamCamServer project:

| Image | Role |
| --- | --- |
| `facerecserver-models` | Debian slim; unpacks `face_embeddings.json` into a shared Docker volume; exits immediately |
| `facerecserver-app` | Python 3.12 with dlib; serves the Flask+SocketIO app; mounts the shared volume at `/app/model` |

`compose.yaml` starts `models` first with `condition: service_completed_successfully`, guaranteeing the embeddings file is in place before the app reads it. The volume is writable, so live enrollments from the running app are persisted within the deployment session.

### CI/CD pipeline

Three GitHub Actions jobs in `.github/workflows/publish.yml`:

| Job | Trigger | What it does |
| --- | --- | --- |
| `test` | every push and PR | installs deps (including dlib build tools), runs smoke import, builds the app Docker image |
| `build-and-push-app` | push to `main` or any tag | builds and pushes `facerecserver-app` to Docker Hub |
| `build-and-push-models` | version tags only | downloads the model bundle from the GitHub Release, builds and pushes `facerecserver-models` |

---

## Problems faced and solved

### 1. Package not importable after install

**Problem.** After creating `pyproject.toml` and running `uv sync`, the scripts still raised `ModuleNotFoundError: No module named 'facerecserver'`. The venv existed but the package was not installed into it.

**Cause.** `pyproject.toml` declared the project metadata but had no `[build-system]` table. Without it, `uv` treats the project as an application and does not install it as a local editable package.

**Fix.** Added the `[build-system]` section using `hatchling`:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

After `uv sync` the package was installed and all imports resolved correctly.

---

### 2. Wrong recognition library — LBPH vs embeddings

**Problem.** The original plan used OpenCV's LBPH (Local Binary Pattern Histograms) face recognizer. This required an offline data-collection phase (capture many face crops, train a model, save a `.yml` file) before the server could recognise anyone.

**Cause.** LBPH was chosen for simplicity, but the hackathon brief explicitly required *embedding-based* recognition with a structured database, and graded on accuracy. LBPH also cannot do live enrollment without retraining.

**Fix.** Switched to the `face_recognition` library (dlib ResNet, 99.38% LFW accuracy). Embeddings are stored as 128-d vectors in a JSON file and compared at runtime using Euclidean distance. The entire offline pipeline (collect → train → package) was replaced by live enrollment. A person is registered in under five seconds by pointing the camera at them and typing their name.

---

### 3. `face_recognition_models` missing `pkg_resources`

**Problem.** After installing `face-recognition`, importing it raised:

```
ModuleNotFoundError: No module named 'pkg_resources'
```

**Cause.** `face_recognition_models` — the package that ships the dlib model `.dat` files — uses the legacy `from pkg_resources import resource_filename` API. In Python 3.12 environments managed by `uv`, `setuptools` (which historically provided `pkg_resources` as a side effect) is installed in a stripped form that does not expose the `pkg_resources` top-level module.

**Fix.** Patched `face_recognition_models/__init__.py` in the venv to use the standard library `importlib.resources` API instead:

```python
from importlib.resources import files as _files

def _model(name):
    return str(_files(__name__).joinpath("models").joinpath(name))
```

This is the modern, setuptools-free way to locate package data files, available since Python 3.9.

---

### 4. Camera blocked without HTTPS

**Problem.** The browser refused to call `getUserMedia()` (camera access) when the app was served over plain HTTP on a non-localhost address.

**Cause.** Browsers enforce the Secure Context requirement: camera and microphone APIs are only available on `localhost` or HTTPS origins. Since the server runs on a LAN IP or remote host, HTTP is not treated as secure.

**Fix.** Generated a self-signed TLS certificate and loaded it into Flask via Python's `ssl.SSLContext`:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certificates/private.key \
  -out    certificates/certificate.crt \
  -subj   "/CN=localhost"
```

The server now listens on HTTPS port 8080. The browser shows a one-time "Not Secure" warning for the self-signed cert; after clicking "Proceed" the camera works normally.

---

### 5. Multiple unknown faces — enrollment ambiguity

**Problem.** When several unknown people were in frame simultaneously, clicking "Add Person" always enrolled the first face dlib detected internally (arbitrary order). There was no way to tell the server which person you wanted to name.

**Fix — two parts:**

**Stable labels.** The server now sorts unknown faces by their left-edge x-coordinate and assigns sequential labels — "Unknown 1" (leftmost), "Unknown 2", "Unknown 3" — before emitting the detections event. These labels are consistent within a frame and are used as the enrollment key.

**Per-label enrollment form.** The "Add Person" panel dynamically lists every current unknown as a labelled row with its own text input:

```
Unknown 1  [____________]
Unknown 2  [____________]
Unknown 3  [____________]
              Save All
```

The user fills in the names they know, leaves the rest blank, and clicks Save All. The client sends one `enroll_request` per filled row; the server looks up each label in the most recent detection results, extracts the embedding from the stored frame at that exact bounding box, and saves it.

**Yellow highlight.** Clicking a face directly on the video canvas draws a yellow bounding box overlay (client-side, on top of the server-rendered frame) and highlights the corresponding row in the enrollment form, so it is always clear which face is being named.

---

## Conclusion

FaceRecServer demonstrates a complete, production-shaped face recognition pipeline built entirely with open-source tools in a short hackathon timeframe. The system meets every requirement in the brief — camera access, embedding-based recognition, structured storage, visual feedback, deployment, and CI/CD — and adds meaningful innovations: live enrollment with no offline training, multi-person enrollment in a single interaction, and a polished streaming UI.

The most significant technical decision was abandoning LBPH in favour of dlib embeddings. LBPH would have satisfied the minimum requirements, but the switch to a pretrained ResNet model delivered substantially higher accuracy, eliminated the offline data-collection workflow, and made live enrollment possible. The cost was a more complex Docker image (dlib requires cmake and C++ build tools) and one runtime compatibility issue with `pkg_resources`, both of which were resolved.

The architecture — browser captures frames, server processes and annotates, WebSocket streams the result back — scales naturally. The server is stateless per-frame and thread-safe; the embedding database is a plain JSON file that any future version of the system can read. Replacing the recognition backend (for example with ArcFace or FaceNet for even higher accuracy) requires changing only `inference.py` — the rest of the stack is unaffected.
