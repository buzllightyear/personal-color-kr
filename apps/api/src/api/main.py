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
from api.routers import auth as auth_router
from api.routers import diagnose as diagnose_router
from api.routers import events as events_router
from api.routers import health as health_router
from api.routers import metrics as metrics_router
from api.routers import referrals as referrals_router
from api.routers import version as version_router


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
        # Phase 4.3 promotes the machine-readable OpenAPI document to a public
        # surface so the contract gate (test_openapi_*.py) can assert security
        # schemes, request/response shapes, and which endpoints are public —
        # this is the only place the spec is exposed; the human-facing Swagger
        # UI / ReDoc surfaces remain disabled until a later phase ships a
        # public docs site.
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
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
    app.include_router(version_router.router, prefix="/v1")
    app.include_router(auth_router.router, prefix="/v1")
    app.include_router(diagnose_router.router, prefix="/v1")
    # Phase 4.4 — authenticated event ingest (`POST /v1/events`) and the
    # retention metric assembled server-side from the events table
    # (`GET /v1/metrics/retention`). Both require a valid backend JWT.
    app.include_router(events_router.router, prefix="/v1")
    app.include_router(metrics_router.router, prefix="/v1")
    # Phase 4.5 — authenticated referral surface (`GET /v1/referrals/me`):
    # the caller's fixed referral code, the server-assembled share URL, and
    # the live friend-used count. Requires a valid backend JWT.
    app.include_router(referrals_router.router, prefix="/v1")

    return app


# Module-level app instance consumed by the uvicorn entry command:
#   uvicorn api.main:app --host 127.0.0.1 --port 8000
app: FastAPI = create_app()
