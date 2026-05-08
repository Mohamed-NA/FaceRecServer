# Deployment

## Runtime shape

FaceRecServer deploys as two Docker images:

- `facerecserver-app`: Flask + Socket.IO app, static frontend, recognition runtime.
- `facerecserver-models`: private model bundle copied into a shared Docker volume.

The app image does not include `model/face_embeddings.json` or TLS private keys. Keep those as runtime artifacts.

## Local container run

```bash
docker build -f infra/docker/Dockerfile.app -t facerecserver-app:local .
uv run python scripts/package_model_bundle.py
docker build -f infra/docker/Dockerfile.models -t facerecserver-models:local .
docker compose -f infra/docker/compose.yaml up
```

Open `http://localhost:8080`. Browsers treat localhost as a secure context for camera access.

For HTTPS in the container, mount certificates and set:

```bash
FACEREC_ENABLE_TLS=1 FACEREC_REQUIRE_TLS=1 docker compose -f infra/docker/compose.yaml up
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- installs locked Python dependencies with `uv sync --frozen`
- compiles `facerecserver/` and `scripts/`
- smoke-tests `/healthz`
- builds the app Docker image

## CD

`.github/workflows/docker-publish.yml` publishes the app image to Docker Hub from `main` and `v*.*.*` tags.

Required repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

The models image contains private embeddings, so it is only built by manual `workflow_dispatch` with a `model_bundle_url` input pointing to a `model-bundle.tar.gz` artifact.

## Production notes

- Prefer terminating public TLS at a reverse proxy or load balancer and run the container with `FACEREC_ENABLE_TLS=0`.
- Persist `/app/model` so live enrollments survive container replacement.
- Use `/healthz` for container or load-balancer health checks.
- Do not commit generated certificates, `dist/`, or `model/face_embeddings.json`.
