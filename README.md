# FaceRecServer

Real-time, browser-based face recognition with live enrollment — no offline training required.

Built for the **Debi Hackathon, May 2026**.

---

## How it works

1. Open the web app in any browser (HTTPS required for camera access)
2. The server draws a bounding box around every face — **green** for known, **red** for unknown
3. Click a face, type a name, click **Save All** — the person is recognised on the next frame
4. The entire enroll-to-recognise cycle takes under **5 seconds**

---

## Stack

| Layer       | Technology                                      |
|-------------|-------------------------------------------------|
| Recognition | dlib ResNet — 128-d face embeddings, 99.38% LFW |
| Server      | Flask + Flask-SocketIO (HTTPS :8080)            |
| Transport   | WebSocket — base64 JPEG frames                  |
| Storage     | `model/face_embeddings.json`                    |
| Frontend    | Vanilla JS + Canvas                             |
| Deployment  | Docker Compose (two-image stack)                |
| CI/CD       | GitHub Actions                                  |

---

## Quick start

```bash
# Install dependencies (requires cmake for dlib)
uv sync

# Generate TLS certificate (required for browser camera access)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certificates/private.key \
  -out    certificates/certificate.crt \
  -subj   "/CN=localhost"

# Run
uv run python scripts/run_server.py
```

Open `https://localhost:8080` — accept the self-signed cert warning, allow camera access.

---

## Docker

```bash
docker build -f infra/docker/Dockerfile.app -t facerecserver-app:local .
uv run python scripts/package_model_bundle.py
docker build -f infra/docker/Dockerfile.models -t facerecserver-models:local .
docker compose -f infra/docker/compose.yaml up
```

Open `http://localhost:8080`. For HTTPS inside the container set `FACEREC_ENABLE_TLS=1`.

---

## CI/CD

| Job                   | Trigger           | Action                              |
|-----------------------|-------------------|-------------------------------------|
| `ci`                  | every push / PR   | uv sync, compile, health smoke test, docker build |
| `build-and-push-app`  | `main` + tags     | push `facerecserver-app` to Docker Hub |
| `build-and-push-models` | manual dispatch | push `facerecserver-models` from a private model bundle URL |

Requires repository secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

---

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md) — full write-up: architecture, problems solved, conclusion
- [DEPLOYMENT.md](DEPLOYMENT.md) — Docker, CI/CD, and production notes
- [architecture.md](architecture.md) — Mermaid diagrams
- [doc/architecture.svg](doc/architecture.svg) — SVG architecture diagram


# Team 
# Mahmoud Saad Dwidar 