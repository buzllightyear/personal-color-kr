"""FastAPI application factory and module-level ``app`` instance (Phase 4.1).

The uvicorn dev command — ``uvicorn api.main:app --host 127.0.0.1 --port 8000`` —
imports this module and binds to the module-level ``app`` symbol. The factory
``create_app()`` is intentionally separate so tests can construct fresh app
instances with isolated ``dependency_overrides``.

Phase 4.1 invariants enforced here:
    - App construction is idempotent (no global side effects on import).
    - Three v1 routes are wired (`/v1/health`, `/v1/db-health`, `/v1/diagnose`)
      under the single ``/v1`` prefix.
    - The request_id middleware and JSON logger are registered exactly once.
    - Zero authentication dependencies (Apple Sign In deferred to Phase 4.3).
"""

from __future__ import annotations

from fastapi import FastAPI

from api.config.logging import configure_json_logging
from api.middleware.request_id import RequestIdMiddleware
from api.routers import diagnose as diagnose_router
from api.routers import health as health_router


def create_app() -> FastAPI:
    """Construct a fresh FastAPI app instance.

    Returns
    -------
    FastAPI
        A FastAPI application with the v1 routers mounted under ``/v1`` and
        the request_id middleware + JSON logger registered.

    Notes
    -----
    This factory is intentionally minimal in the AC1 surface and will be
    extended with router includes + middleware registration as later
    acceptance criteria (AC2–AC19) land. Keeping the surface idempotent and
    side-effect-free is a Phase 4.1 invariant that downstream tests
    (``app.dependency_overrides`` based unit tier) rely on.
    """
    # Configure structured JSON logging exactly once (AC15). The middleware
    # below emits per-request records that the formatter serializes into
    # the 8-key JSON schema (timestamp, level, message, request_id, method,
    # path, status, latency_ms).
    configure_json_logging()

    app = FastAPI(
        title="personal-color-kr API",
        version="0.1.0",
        # Disable the default docs surface; the three v1 endpoints are
        # documented in the Seed contract, not via OpenAPI's auto-docs page,
        # because Phase 4.1 is local-only (no public docs surface).
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    # Register the request_id middleware (AC16) — single source of the
    # per-request UUID4 attached to ``request.state.request_id`` and the
    # ``X-Request-ID`` response header. The same UUID flows into the JSON
    # log record for that request.
    app.add_middleware(RequestIdMiddleware)

    # Mount the v1 routers under the single ``/v1`` prefix. There are no
    # flat-prefix duplicates: the health endpoints are exposed exclusively
    # at ``/v1/health`` (AC2) and ``/v1/db-health`` (AC3); the diagnose
    # endpoint is exposed exclusively at ``/v1/diagnose`` (Sub-AC 5.3).
    app.include_router(health_router.router, prefix="/v1")
    app.include_router(diagnose_router.router, prefix="/v1")

    return app


# Module-level app instance consumed by the uvicorn entry command:
#   uvicorn api.main:app --host 127.0.0.1 --port 8000
app: FastAPI = create_app()
