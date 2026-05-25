"""Version-info route for the apps/api FastAPI workspace (Phase 4.3).

This module exposes the public ``GET /v1/version`` endpoint that returns the
running API's ``name`` and ``version`` metadata as a deterministic JSON body.
The endpoint is intentionally **public** — it carries no authentication
dependency and produces no PII — so it can be polled by uptime probes,
release tooling, and the OpenAPI contract gate without ever triggering the
``require_current_user`` dependency that gates ``POST /v1/diagnose``.

Phase 4.3 invariants honored here:
    - Zero authentication dependencies: the router is mounted under ``/v1``
      with no global ``Depends`` and the route itself declares no
      ``dependencies=...`` (Seed AC: "GET /v1/health and GET /v1/version
      remain public with no security scheme in OpenAPI").
    - Zero I/O: the handler reads only module-level constants. No DB
      round-trip, no env var lookup, no filesystem access — a sick database
      or a missing ``JWT_SECRET`` env var must never affect this endpoint.
    - Stable wire shape: the response is pinned by a Pydantic v2 model with
      ``extra="forbid"`` so the OpenAPI schema cannot drift and accidental
      field-creep (e.g., adding ``git_sha`` or ``build_timestamp``)
      surfaces as a Pydantic validation error rather than a silent change.
    - No PII, no secrets: the only data exposed is the static app name and
      version string, both of which are also visible in FastAPI's
      ``openapi.json`` ``info`` block. There is no incremental information
      leak relative to the OpenAPI document itself.
"""

from __future__ import annotations

from typing import Final

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

# Router that hosts the ``GET /v1/version`` endpoint. The prefix is applied by
# ``api.main.create_app`` (``app.include_router(router, prefix="/v1")``) so
# this module is decoupled from the version namespace and the router can be
# reused under a different prefix in tests if ever needed.
router: APIRouter = APIRouter(tags=["version"])


# ---------------------------------------------------------------------------
# Wire constants — kept in sync with ``api.main.create_app`` FastAPI metadata
# ---------------------------------------------------------------------------

#: Service name exposed by ``GET /v1/version``. Mirrors the ``title`` argument
#: passed to ``FastAPI(...)`` in ``api.main.create_app`` so the version endpoint
#: and the OpenAPI ``info.title`` field cannot drift.
APP_NAME: Final[str] = "personal-color-kr API"

#: Service version exposed by ``GET /v1/version``. Mirrors the ``version``
#: argument passed to ``FastAPI(...)`` in ``api.main.create_app`` so the version
#: endpoint and the OpenAPI ``info.version`` field cannot drift.
APP_VERSION: Final[str] = "0.1.0"


class VersionResponse(BaseModel):
    """Response schema for ``GET /v1/version``.

    Two string fields — ``name`` and ``version`` — pin the wire shape against
    drift. The ``extra="forbid"`` config makes any accidental field-creep
    (e.g., adding ``git_sha`` to the payload without a Seed update) fail
    Pydantic validation at response-construction time instead of silently
    shipping a wider surface.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    version: str


@router.get(
    "/version",
    response_model=VersionResponse,
    summary="Service version metadata",
    description=(
        "Public version-info endpoint. Returns HTTP 200 with body "
        '`{"name": "personal-color-kr API", "version": "0.1.0"}`. Performs '
        "no I/O and declares no authentication dependency, so it is safe "
        "for unauthenticated uptime probes and release tooling. The values "
        "mirror the FastAPI ``title`` and ``version`` metadata in "
        "``api.main.create_app`` so the OpenAPI ``info`` block and this "
        "endpoint stay in lockstep."
    ),
)
async def get_version() -> VersionResponse:
    """Return the static service-version payload.

    The handler reads only module-level constants — no env vars, no DB
    round-trip, no filesystem touch — which guarantees that ``GET /v1/version``
    keeps working even if the database is unreachable or required env vars
    like ``JWT_SECRET`` / ``APPLE_BUNDLE_ID`` are absent at runtime.

    Returns
    -------
    VersionResponse
        The HTTP 200 body ``{"name": APP_NAME, "version": APP_VERSION}``
        serialized by FastAPI's Pydantic v2 ``response_model``.
    """
    return VersionResponse(name=APP_NAME, version=APP_VERSION)
