FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# dlib requires cmake + C++ build tools; libgl1/libglib2 for OpenCV headless
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        git \
        cmake \
        build-essential \
        libopenblas-dev \
        liblapack-dev \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh

ENV PATH="/root/.local/bin:/app/.venv/bin:${PATH}"

COPY pyproject.toml uv.lock README.md ./

RUN uv sync --frozen --no-dev

COPY config      ./config
COPY facerecserver ./facerecserver
COPY templates   ./templates
COPY static      ./static

RUN mkdir -p /app/model /app/certificates \
    && useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"FACEREC_PORT\", \"8080\")}/healthz', timeout=3).read()"

CMD ["uv", "run", "python", "-m", "facerecserver.app"]
