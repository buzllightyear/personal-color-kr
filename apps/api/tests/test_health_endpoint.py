"""Unit tests for the ``GET /v1/health`` endpoint (AC2 — Phase 4.1).

Acceptance criterion (AC2) being verified
-----------------------------------------
``GET /v1/health`` returns HTTP 200 with body ``{"status": "ok"}``.

Verification technique
----------------------
The test drives the FastAPI ``app`` directly via
``httpx.AsyncClient(transport=ASGITransport(app=app))`` so the entire
request/response pipeline is exercised in-process — no uvicorn boot, no
TCP socket, no DB connection. This matches the Seed-mandated test seam
for the unit tier:

    "pytest uses ``httpx.AsyncClient(transport=ASGITransport(app=app))``
     for end-to-end tests."

Invariants asserted by these tests
----------------------------------
1. The HTTP status code is exactly ``200``.
2. The response body is exactly ``{"status": "ok"}`` — no extra fields,
   no missing fields, no drift on the literal ``"ok"`` value.
3. The handler performs **zero** I/O — verified by constructing the app
   without ever wiring a DB engine / session dependency. If the handler
   regressed to a DB-touching implementation it would raise an
   ``AttributeError`` here because ``DATABASE_URL`` is not set in the
   unit test environment.
4. The ``Content-Type`` header is ``application/json`` — confirming the
   Pydantic v2 ``response_model`` is the serialization surface.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import create_app


@pytest.mark.unit
async def test_get_v1_health_returns_200_with_status_ok() -> None:
    """``GET /v1/health`` → 200 ``{"status": "ok"}``.

    Builds a fresh FastAPI app via ``create_app()`` (so the test never
    shares mutable state with other tests' ``dependency_overrides``) and
    issues a request through an in-memory ASGI transport.
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/health")

    assert response.status_code == 200, (
        f"Expected HTTP 200, got {response.status_code} with body " f"{response.text!r}"
    )
    assert response.json() == {
        "status": "ok"
    }, f"Expected body {{'status': 'ok'}}, got {response.json()!r}"


@pytest.mark.unit
async def test_get_v1_health_response_content_type_is_json() -> None:
    """The ``Content-Type`` header is ``application/json``.

    Confirms the Pydantic v2 ``response_model`` is the serialization
    surface (not a bare ``Response(..., media_type='text/plain')``).
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/health")

    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("application/json"), (
        f"Expected Content-Type to start with 'application/json', got "
        f"{content_type!r}"
    )


@pytest.mark.unit
async def test_get_v1_health_body_has_no_extra_fields() -> None:
    """The body contains exactly one field: ``status``.

    Guards against accidental field-creep (e.g., adding ``version``,
    ``timestamp``, or ``request_id`` to the liveness payload). The Phase
    4.1 contract is a single-field response so liveness probes stay cheap
    and PII-free.
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/v1/health")

    body = response.json()
    assert set(body.keys()) == {
        "status"
    }, f"Expected exactly one field 'status', got keys={list(body.keys())!r}"
