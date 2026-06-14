# syntax=docker/dockerfile:1
#
# Production container for the personal-color-kr FastAPI backend (apps/api).
#
# Build context MUST be the monorepo ROOT (not apps/api): the image installs
# BOTH `packages/core-python` (the pure diagnosis/generation/enhancer domain)
# and `apps/api` (the HTTP surface) editably, mirroring exactly what CI and
# local dev do:
#
#     pip install -e packages/core-python && pip install -e apps/api
#
# The `from personal_color.* import ...` / `from retention.* import ...` calls
# in apps/api resolve at runtime because core-python lands in the same
# site-packages. apps/api's pyproject deliberately does NOT list core-python as
# a runtime dependency (PEP 508 relative file:// URLs are not portable), so the
# two-step install here is load-bearing, not redundant.
#
# Python is PINNED to 3.12: core-python depends on `mediapipe==0.10.18`, which
# ships no Python 3.13 wheel. Do not bump the base image to 3.13 without first
# resolving the mediapipe wheel constraint.
#
# Migrations are NOT run by this image's CMD — they run once per deploy via
# Fly's `[deploy] release_command` (see fly.toml) so concurrent machines never
# race on `alembic upgrade head`. For non-Fly hosts, run the equivalent
# `cd apps/api && alembic upgrade head` before starting the service.

FROM python:3.12-slim AS base

# mediapipe's transitive OpenCV needs libGL + glib at runtime; without these
# the first `import mediapipe` raises `ImportError: libGL.so.1: cannot open
# shared object file`. `--no-install-recommends` keeps the layer lean; the
# apt cache is removed in the same layer so it does not bloat the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Fail fast and unbuffered logs (so Fly/console sees stdout immediately).
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Copy only the two installable trees (the .dockerignore prunes caches/venvs).
# core-python first so its layer caches independently of apps/api churn.
COPY packages/core-python ./packages/core-python
COPY apps/api ./apps/api

# Editable install in the same order CI uses. `-e` keeps the src/ layout
# importable (`api.*`, `personal_color.*`, `retention.*`) without a build step.
RUN python -m pip install --upgrade pip \
    && python -m pip install -e packages/core-python \
    && python -m pip install -e apps/api

# Run as a non-root user (defense in depth; the container handles user uploads).
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# Fly injects PORT=8080 by default, but we pin internal_port=8000 in fly.toml
# to match the documented local `uvicorn ... --port 8000` smoke. The CMD reads
# $PORT when present so the same image runs on hosts that inject a port.
ENV PORT=8000
EXPOSE 8000

# `api.main:app` is the module path installed by `pip install -e apps/api`
# (src layout → `api` package on sys.path). Single worker: the workload is
# async-I/O bound (asyncpg + Fal.ai HTTP) and Fly scales by adding machines,
# not in-process workers.
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
