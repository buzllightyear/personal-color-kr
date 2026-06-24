"""Pins the load-bearing fields of the repo-root ``render.yaml`` Blueprint.

A malformed Blueprint fails silently at deploy time on Render; these asserts
give the migration a green/red signal in the normal pytest run. The values
mirror the migration design spec
(``docs/superpowers/specs/2026-06-23-render-backend-migration-design.md``).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

# apps/api/tests/unit/test_render_blueprint.py -> repo root is 4 parents up.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_RENDER_YAML = _REPO_ROOT / "render.yaml"
_START_SCRIPT = _REPO_ROOT / "apps" / "api" / "render-start.sh"

# Where the start script lands inside the image (Dockerfile COPYs apps/api to
# /app/apps/api); render.yaml's dockerCommand must point at this exact path.
_START_SCRIPT_IMAGE_PATH = "/app/apps/api/render-start.sh"


def _service() -> dict[str, Any]:
    data: dict[str, Any] = yaml.safe_load(_RENDER_YAML.read_text())
    services: list[dict[str, Any]] = data["services"]
    assert len(services) == 1, "expected exactly one Render service"
    return services[0]


def test_render_blueprint_is_a_free_docker_web_service() -> None:
    svc = _service()
    assert svc["type"] == "web"
    assert svc["runtime"] == "docker"
    assert svc["dockerfilePath"] == "./Dockerfile"
    assert svc["plan"] == "free"
    assert svc["healthCheckPath"] == "/v1/health"


def test_render_blueprint_dockercommand_is_the_single_path_start_script() -> None:
    cmd: str = _service()["dockerCommand"]
    # Render treats dockerCommand as a single command, so a `&&`-chained inline
    # command is parsed as one command name -> Exited with status 127. The
    # dockerCommand must be a single, space-free path to the start script.
    assert cmd == _START_SCRIPT_IMAGE_PATH, (
        "dockerCommand must be the bare start-script path "
        f"{_START_SCRIPT_IMAGE_PATH!r} (Render mangles chained/quoted commands)"
    )
    assert "&&" not in cmd
    assert " " not in cmd


def test_render_start_script_migrates_then_serves_on_injected_port() -> None:
    script = _START_SCRIPT.read_text()
    assert script.startswith("#!/bin/sh"), "start script needs a /bin/sh shebang"
    assert "alembic upgrade head" in script
    assert "uvicorn api.main:app" in script
    # Render injects $PORT; bind it, not a hardcoded port.
    assert "PORT" in script
    # A mistyped host silently breaks the Render health check.
    assert "--host 0.0.0.0" in script
    # Migration must complete before the server starts.
    assert script.index("alembic upgrade head") < script.index(
        "uvicorn api.main:app"
    ), "migration must run before the server starts"


def test_render_start_script_is_executable() -> None:
    # Render runs the script by bare path, so it must carry the exec bit
    # (committed mode 755) -- otherwise: permission denied at boot.
    assert os.access(_START_SCRIPT, os.X_OK), "render-start.sh must be executable"


def test_render_blueprint_declares_required_secrets_uncommitted() -> None:
    env_vars = {e["key"]: e for e in _service()["envVars"]}
    for key in ("DATABASE_URL", "JWT_SECRET", "APPLE_BUNDLE_ID"):
        assert key in env_vars, f"{key} must be declared"
        assert env_vars[key]["sync"] is False, f"{key} must be sync:false (uncommitted)"
