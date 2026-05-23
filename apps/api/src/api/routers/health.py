"""Health-check routes for the apps/api FastAPI workspace (Phase 4.1).

This module hosts both health-check endpoints required by Phase 4.1:

    - ``GET /v1/health``     — pure liveness, no DB touch. Returns
      ``{"status": "ok"}``.
    - ``GET /v1/db-health``  — readiness check that performs an async
      ``SELECT 1`` round-trip via the SQLAlchemy AsyncSession; returns
      ``{"status": "ok", "db": "ok"}`` on success or HTTP 503 with body
      ``{"status": "error", "db": "unreachable"}`` on
      ``SQLAlchemyError``.

The two endpoints intentionally share a single module + ``APIRouter`` so
the import surface stays minimal. The router is mounted under ``/v1`` by
``api.main.create_app``; this module never hardcodes the prefix.

Phase 4.1 invariants honored here:
    - No authentication dependencies (Apple Sign In deferred to 4.3).
    - No request bodies / no PII; logs emit only method / path / status.
    - ``GET /v1/health`` performs zero I/O and zero ``Depends(...)`` calls
      so a sick database never affects the liveness probe.
    - Zero ``sqlalchemy*`` imports in this file (AC11 boundary). The
      ``AsyncSession`` type is re-exported through ``api.db.session``,
      which is itself inside the single ``apps/api/src/api/db/`` boundary.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from api.db import check_db_health
from api.db.session import AsyncSession, get_session

# Router that hosts the health-check endpoints. The prefix is applied by
# ``api.main.create_app`` (``app.include_router(router, prefix="/v1")``)
# so this module is decoupled from the version namespace.
router: APIRouter = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Response schema for ``GET /v1/health``.

    The body is a single literal field ``status == "ok"``. Declaring the
    literal type pins the wire shape: any divergence (extra field, missing
    field, drifted value) produces a Pydantic v2 validation error at
    response-construction time, so the contract is enforced statically
    instead of via runtime asserts.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]


class DbHealthResponse(BaseModel):
    """Response schema for ``GET /v1/db-health`` on the success (200) path.

    Two literal fields — ``status == "ok"`` and ``db == "ok"`` — pin the
    wire shape against drift. The 503 failure body
    ``{"status": "error", "db": "unreachable"}`` is *not* modeled here
    because FastAPI's ``response_model`` validates only the 2xx surface;
    the failure path uses a raw :class:`fastapi.responses.JSONResponse`
    to honor the Seed-pinned body shape verbatim.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    db: Literal["ok"]


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    description=(
        "Pure liveness check. Returns HTTP 200 with body "
        '`{"status": "ok"}`. Performs no database round-trip and has no '
        "dependencies, so a sick database never marks the API unhealthy."
    ),
)
async def get_health() -> HealthResponse:
    """Return a static liveness payload.

    The handler is intentionally trivial: no ``Depends(...)``, no DB
    touch, no env reads. This guarantees that ``GET /v1/health`` reports
    process-level liveness only — used by uvicorn smoke tests, the
    docker-compose smoke step, and (in a future phase) a Kubernetes /
    Fly.io liveness probe.

    Returns
    -------
    HealthResponse
        The 200 OK body ``{"status": "ok"}`` serialized by FastAPI's
        Pydantic v2 ``response_model``.
    """
    return HealthResponse(status="ok")


@router.get(
    "/db-health",
    response_model=DbHealthResponse,
    summary="Database readiness probe",
    description=(
        "Readiness check that issues ``SELECT 1`` over the SQLAlchemy "
        "AsyncSession. Returns HTTP 200 with body "
        '`{"status": "ok", "db": "ok"}` when the round-trip succeeds, or '
        'HTTP 503 with body `{"status": "error", "db": "unreachable"}` '
        "when the driver raises ``SQLAlchemyError`` (network down, "
        "exhausted pool, auth failure, etc.). The exception class name "
        "and traceback are never returned to the client."
    ),
    responses={
        503: {
            "description": "Database unreachable",
            "content": {
                "application/json": {
                    "example": {"status": "error", "db": "unreachable"},
                },
            },
        },
    },
)
async def get_db_health(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response | DbHealthResponse:
    """Issue ``SELECT 1`` via ``session`` and map the bool to an HTTP status.

    The Phase 3.2 / 4.1 contract makes :func:`api.db.health.check_db_health`
    the single seam responsible for catching ``SQLAlchemyError`` and
    converting it to a bool, so this handler is a thin status-mapping
    layer with no exception handling of its own. Non-SQLAlchemy errors
    (e.g. programmer bugs raising ``RuntimeError``) propagate to FastAPI's
    outer exception handler — they should never be silently masked as
    "db unreachable".

    Parameters
    ----------
    session:
        A SQLAlchemy 2.0 ``AsyncSession`` resolved from
        ``api.db.session.get_session``. The session lifecycle (open /
        close / rollback) is managed by that generator dependency; this
        handler only consumes the session value.

    Returns
    -------
    Response | DbHealthResponse
        * On success: :class:`DbHealthResponse` ``(status="ok", db="ok")``
          serialized by Pydantic via the route's ``response_model``,
          yielding HTTP 200.
        * On failure: a :class:`~fastapi.responses.JSONResponse` with
          status 503 and body ``{"status": "error", "db": "unreachable"}``.
          The bypass of ``response_model`` is intentional — FastAPI
          validates ``response_model`` only on the 2xx path, and the
          failure body is a different shape pinned by the Seed.
    """
    ok = await check_db_health(session)
    if not ok:
        # Bypass the success ``response_model`` and emit the exact wire
        # shape mandated by the Seed: ``{"status":"error","db":"unreachable"}``.
        # No exception detail, no traceback, no driver string.
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "error", "db": "unreachable"},
        )
    return DbHealthResponse(status="ok", db="ok")
