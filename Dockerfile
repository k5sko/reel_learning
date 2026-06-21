# Full-stack backend image: clipper API (ingest/transcribe/clip) + recsys (FAISS + encoders),
# mounted as one FastAPI app. Redis is a separate compose service.
# Uses uv (fast resolver) + a BuildKit cache mount so rebuilds reuse the wheel cache
# (no re-downloading torch/whisper every time).
FROM python:3.11-slim

# uv binary from the official image.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_HTTP_TIMEOUT=120 \
    HF_HOME=/root/.cache/huggingface

# System binaries clipper shells out to (config.py asserts these on PATH).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch FIRST so sentence-transformers / faster-whisper don't pull the multi-GB CUDA wheel.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --index-url https://download.pytorch.org/whl/cpu torch==2.5.1

# Deps before code → layer caching on rebuilds; uv cache mount makes re-installs near-instant.
COPY clipper/requirements.txt clipper/requirements.txt
COPY recsys/requirements.txt recsys/requirements.txt
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system -r clipper/requirements.txt -r recsys/requirements.txt

COPY . .

EXPOSE 8000
# recsys/api.py mounts into clipper's app (pending build step 9); until then this serves clipper's API.
CMD ["uvicorn", "clipper.api:app", "--host", "0.0.0.0", "--port", "8000"]
