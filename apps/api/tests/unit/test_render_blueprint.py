"""Pins the load-bearing fields of the repo-root ``render.yaml`` Blueprint.

A malformed Blueprint fails silently at deploy time on Render; these asserts
give the migration a green/red signal in the normal pytest run. The values
mirror the migration design spec
(``docs/superpowers/specs/2026-06-23-render-backend-migration-design.md``).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

# apps/api/tests/unit/test_render_blueprint.py -> repo root is 4 parents up.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_RENDER_YAML = _REPO_ROOT / "render.yaml"


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


def test_render_blueprint_migrates_then_serves_on_injected_port() -> None:
    cmd: str = _service()["dockerCommand"]
    assert "alembic upgrade head" in cmd
    assert "uvicorn api.main:app" in cmd
    # Render injects $PORT; the command must bind it, not a hardcoded port.
    assert "$PORT" in cmd
    # Migration must complete before the server starts.
    assert cmd.index("alembic upgrade head") < cmd.index(
        "uvicorn api.main:app"
    ), "migration must run before the server starts"
    # A mistyped host silently breaks the Render health check.
    assert "--host 0.0.0.0" in cmd
    # Render already runs dockerCommand through its own shell. An explicit
    # `sh -c "..."` wrapper double-wraps it, so the whole `cd ... && uvicorn`
    # chain is parsed as one command name -> Exited with status 127. Keep the
    # command raw (no self-added shell wrapper).
    assert not cmd.lstrip().startswith(
        "sh -c"
    ), "do not wrap dockerCommand in `sh -c` -- Render double-wraps it (status 127)"


def test_render_blueprint_declares_required_secrets_uncommitted() -> None:
    env_vars = {e["key"]: e for e in _service()["envVars"]}
    for key in ("DATABASE_URL", "JWT_SECRET", "APPLE_BUNDLE_ID"):
        assert key in env_vars, f"{key} must be declared"
        assert env_vars[key]["sync"] is False, f"{key} must be sync:false (uncommitted)"
