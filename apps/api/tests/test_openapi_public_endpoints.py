"""OpenAPI public-endpoint contract tests (Phase 4.3).

Acceptance criterion being verified
-----------------------------------
*GET /v1/health and GET /v1/version remain public with no security scheme
in OpenAPI.*

This module is one slice of the broader ``openapi_contract_valid`` exit
condition (which also covers the sign-in endpoint schema and the
``POST /v1/diagnose`` security scheme, both owned by sibling tasks). The
scope here is *deliberately* narrow:

    1. ``GET /v1/health`` is exposed in the OpenAPI document.
    2. ``GET /v1/version`` is exposed in the OpenAPI document.
    3. Neither operation declares a ``security`` block — i.e., both
       endpoints stay reachable without a bearer JWT, exactly as the Seed
       contract requires.
    4. At runtime, an anonymous request to ``GET /v1/health`` and an
       anonymous request to ``GET /v1/version`` both return HTTP 200 with
       the expected JSON shape (defensive parity check between the spec
       and the live handlers).

Why an OpenAPI-level assertion (not just a "200 without Authorization" check)?
-----------------------------------------------------------------------------
The OpenAPI document is the machine-readable contract that the Phase 4.3.5+
mobile codegen step consumes. A regression that adds a global FastAPI
``Security(...)`` dependency would still let the handlers return 200 in
the test environment (the dependency would not be enforced if no auth
header is missing-required), but it would silently flip the public
endpoints into the "requires bearer" bucket in the generated client. We
test the spec — not just the live response — so the bug is caught at the
contract surface.

Test seam
---------
The OpenAPI document is fetched in-process via
``httpx.AsyncClient(transport=ASGITransport(app=app))`` and decoded with
``response.json()``. This matches the Seed-mandated unit-tier test seam
used by ``test_health_endpoint.py`` and avoids booting uvicorn /
opening a TCP socket.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import create_app

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _fetch_openapi(app: Any) -> dict[str, Any]:
    """Issue ``GET /openapi.json`` in-process and return the decoded body.

    Centralizes the ASGI-transport boilerplate so each test case stays
    focused on a single assertion. The helper deliberately does *not*
    cache the result — every test constructs a fresh app via
    ``create_app()`` so global ``dependency_overrides`` and middleware
    state cannot leak between cases.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/openapi.json")
    assert response.status_code == 200, (
        "OpenAPI JSON document must be reachable at ``/openapi.json`` for "
        "the Phase 4.3 contract gate to function — got HTTP "
        f"{response.status_code} with body {response.text!r}. If this fails "
        "with 404, ``openapi_url`` was likely reset to ``None`` in "
        "``api.main.create_app``."
    )
    body = response.json()
    assert isinstance(body, dict), (
        "Expected ``GET /openapi.json`` body to decode to a dict, got "
        f"{type(body).__name__}"
    )
    return body


# ---------------------------------------------------------------------------
# Contract assertions — OpenAPI document inspection
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_openapi_document_is_publicly_reachable() -> None:
    """``GET /openapi.json`` returns HTTP 200 with a dict body.

    The OpenAPI document is the contract surface that Phase 4.3.5+ mobile
    codegen consumes; if it 404s, every other contract assertion in this
    module degrades to a misleading collection error. This test serves as
    the canonical "the spec is exposed" trip-wire.
    """
    app = create_app()
    spec = await _fetch_openapi(app)

    # Sanity-check the top-level OpenAPI shape so a regression that breaks
    # the document structure (e.g., FastAPI bumped to a major version that
    # changes the envelope) is caught here rather than as a misleading
    # KeyError in the per-endpoint assertions below.
    assert "openapi" in spec, (
        "OpenAPI document missing the ``openapi`` version key — got top-"
        f"level keys={sorted(spec.keys())!r}"
    )
    assert "paths" in spec, (
        "OpenAPI document missing the ``paths`` key — got top-level "
        f"keys={sorted(spec.keys())!r}"
    )


@pytest.mark.unit
async def test_openapi_health_endpoint_is_documented() -> None:
    """``GET /v1/health`` appears in the OpenAPI ``paths`` section.

    Confirms the health router is correctly mounted and that the route
    surfaces through FastAPI's OpenAPI generator. Without this assertion
    the no-security check below would silently pass when the endpoint
    was accidentally removed.
    """
    app = create_app()
    spec = await _fetch_openapi(app)

    paths = spec.get("paths", {})
    assert "/v1/health" in paths, (
        "Expected ``/v1/health`` in OpenAPI ``paths``; got paths="
        f"{sorted(paths.keys())!r}"
    )
    assert "get" in paths["/v1/health"], (
        "Expected ``GET`` operation on ``/v1/health``; got methods="
        f"{sorted(paths['/v1/health'].keys())!r}"
    )


@pytest.mark.unit
async def test_openapi_version_endpoint_is_documented() -> None:
    """``GET /v1/version`` appears in the OpenAPI ``paths`` section.

    Confirms the new Phase 4.3 version router is mounted under ``/v1``
    and visible in the spec. The mobile codegen step (Phase 4.3.5+)
    relies on this entry to surface a typed ``get_version()`` client
    method.
    """
    app = create_app()
    spec = await _fetch_openapi(app)

    paths = spec.get("paths", {})
    assert "/v1/version" in paths, (
        "Expected ``/v1/version`` in OpenAPI ``paths``; got paths="
        f"{sorted(paths.keys())!r}"
    )
    assert "get" in paths["/v1/version"], (
        "Expected ``GET`` operation on ``/v1/version``; got methods="
        f"{sorted(paths['/v1/version'].keys())!r}"
    )


@pytest.mark.unit
async def test_openapi_health_endpoint_has_no_security_scheme() -> None:
    """``GET /v1/health`` declares no per-operation ``security`` block.

    Phase 4.3 Seed contract: liveness probes must stay reachable without
    a bearer JWT. The assertion targets two related failure modes:

        1. A future commit accidentally wraps the health router in a
           ``Depends(require_current_user)`` — that injection would
           cause FastAPI's OpenAPI generator to emit a per-operation
           ``security: [{HTTPBearer: []}]`` block, which this test
           catches.
        2. A global ``security`` was added at the document level. The
           OpenAPI generator does not back-propagate the global onto
           individual operations, but a public endpoint should *also*
           explicitly opt out (empty ``security: []``) if a global is
           introduced. The Phase 4.3 baseline has no global, so the
           assertion is "no ``security`` key at all on this operation".
    """
    app = create_app()
    spec = await _fetch_openapi(app)

    health_get = spec["paths"]["/v1/health"]["get"]
    # ``security`` may be absent (preferred — no auth ever) OR explicitly
    # set to an empty list (an opt-out marker that publicly overrides a
    # document-level global). Both satisfy "no auth required".
    security = health_get.get("security")
    assert security in (None, []), (
        "GET /v1/health must be public — got ``security`` block "
        f"{security!r} on operation {sorted(health_get.keys())!r}. The "
        "Phase 4.3 Seed pins this endpoint to zero-auth so uptime probes "
        "and the docker-compose smoke step keep working."
    )


@pytest.mark.unit
async def test_openapi_version_endpoint_has_no_security_scheme() -> None:
    """``GET /v1/version`` declares no per-operation ``security`` block.

    Symmetric to the ``/v1/health`` assertion above. The version endpoint
    is the second of two endpoints the Seed AC names as "remain public
    with no security scheme in OpenAPI", so both must be checked
    independently to prevent regression on just one.
    """
    app = create_app()
    spec = await _fetch_openapi(app)

    version_get = spec["paths"]["/v1/version"]["get"]
    security = version_get.get("security")
    assert security in (None, []), (
        "GET /v1/version must be public — got ``security`` block "
        f"{security!r} on operation {sorted(version_get.keys())!r}. The "
        "Phase 4.3 Seed pins this endpoint to zero-auth so release tooling "
        "and uptime probes can call it without a bearer JWT."
    )


@pytest.mark.unit
async def test_openapi_document_has_no_global_security_requirement() -> None:
    """The OpenAPI document declares no document-level ``security`` block.

    Phase 4.3 uses per-operation security on the single auth-gated route
    (``POST /v1/diagnose``); a document-level ``security`` requirement
    would implicitly mark *every* endpoint as auth-gated unless explicitly
    overridden, which is the opposite of what the Seed asks for. The
    assertion catches the case where a future contributor adds a global
    bearer-required marker without realizing it cascades onto the
    public health/version endpoints.
    """
    app = create_app()
    spec = await _fetch_openapi(app)

    global_security = spec.get("security")
    assert global_security in (None, []), (
        "OpenAPI document declares a top-level ``security`` requirement "
        f"({global_security!r}); the Phase 4.3 contract uses per-operation "
        "security only so the public health/version endpoints stay "
        "reachable without explicit opt-out markers."
    )


# ---------------------------------------------------------------------------
# Defensive runtime parity — anonymous calls succeed
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_get_v1_health_anonymous_request_returns_200() -> None:
    """An anonymous (no Authorization header) request to ``/v1/health`` → 200.

    Live-handler parity check against the OpenAPI assertion above. If the
    spec says "no security" but the route enforces auth at runtime, this
    test catches the divergence by issuing a request without any
    ``Authorization`` header.
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        # No headers={"Authorization": ...} — strictly anonymous.
        response = await client.get("/v1/health")

    assert response.status_code == 200, (
        "Anonymous GET /v1/health must return 200 — got "
        f"{response.status_code} with body {response.text!r}. If this is "
        "401 or 403, a require_current_user dependency leaked onto the "
        "health router."
    )
    assert response.json() == {
        "status": "ok"
    }, f"Expected body {{'status': 'ok'}}, got {response.json()!r}"


@pytest.mark.unit
async def test_get_v1_version_anonymous_request_returns_200() -> None:
    """An anonymous request to ``/v1/version`` → 200 with the pinned body.

    Live-handler parity check matching the symmetric assertion for
    ``/v1/health`` above. The body is also asserted to confirm the
    ``VersionResponse`` Pydantic model serializes the expected two
    fields exactly.
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        # No headers={"Authorization": ...} — strictly anonymous.
        response = await client.get("/v1/version")

    assert response.status_code == 200, (
        "Anonymous GET /v1/version must return 200 — got "
        f"{response.status_code} with body {response.text!r}. If this is "
        "401 or 403, a require_current_user dependency leaked onto the "
        "version router."
    )
    body = response.json()
    assert set(body.keys()) == {"name", "version"}, (
        "Expected /v1/version body to have exactly the keys "
        f"{{'name', 'version'}}, got keys={sorted(body.keys())!r}"
    )
    assert body["name"] == "personal-color-kr API", (
        "Expected /v1/version body name field to mirror FastAPI ``title`` "
        f"('personal-color-kr API'), got {body['name']!r}"
    )
    assert body["version"] == "0.1.0", (
        "Expected /v1/version body version field to mirror FastAPI "
        f"``version`` ('0.1.0'), got {body['version']!r}"
    )
