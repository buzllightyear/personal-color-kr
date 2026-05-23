"""Unit test for the ``GET /v1/db-health`` 503 failure path (AC4 — Phase 4.1).

Acceptance criterion (AC4) being verified
-----------------------------------------
``GET /v1/db-health`` returns HTTP 503 with body
``{"status": "error", "db": "unreachable"}`` when the AsyncSession raises a
:class:`sqlalchemy.exc.SQLAlchemyError`.

Verification technique
----------------------
The test installs a stub :func:`api.db.session.get_session` provider via
``app.dependency_overrides`` that yields a fake ``AsyncSession`` whose
``execute`` coroutine raises ``SQLAlchemyError``. The handler then calls
:func:`api.db.health.check_db_health`, which catches the exception and
returns ``False`` — and the route maps that boolean to the Seed-pinned
503 wire shape.

The request is driven through ``httpx.AsyncClient(transport=ASGITransport(app=app))``
(the Seed-mandated test seam for the unit tier) so the full FastAPI
middleware stack, dependency resolution chain, and Pydantic v2 response
serialization are exercised — but no real Postgres / asyncpg driver is
loaded. The integration tier (``apps/api/tests/integration/test_db_health.py``)
owns the real-Postgres exercise for the 200 path; this unit test owns the
503 path because reliably forcing ``SQLAlchemyError`` from a *real* asyncpg
connection during a unit test would require either a flaky network race or
a fake-postgres process.

Invariants asserted by these tests
----------------------------------
1. The HTTP status code is exactly ``503`` (Service Unavailable).
2. The response body is exactly ``{"status": "error", "db": "unreachable"}``
   — no extra fields, no missing fields, no exception class name, no
   driver string, no traceback (PII/connection-string non-leakage).
3. The ``Content-Type`` header is ``application/json`` — confirming the
   handler returns a :class:`fastapi.responses.JSONResponse` rather than a
   bare ``Response(..., media_type="text/plain")``.
4. The fake session's ``execute`` method is awaited exactly once — guarding
   against a regression where the handler accidentally skips the DB round-trip
   and surfaces a fabricated 503 without ever attempting the query.
5. The ``SQLAlchemyError`` raised by the stub does **not** propagate to the
   client as a 500 / 502 — it is caught inside ``check_db_health`` and
   converted to a boolean, which the handler maps to the documented 503
   wire shape.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import SQLAlchemyError

from api.db.session import AsyncSession, get_session
from api.main import create_app

# ---------------------------------------------------------------------------
# Constants — Seed-pinned wire shape for the 503 failure body
# ---------------------------------------------------------------------------

#: HTTP status code mandated by the Seed for the DB-unreachable case.
EXPECTED_STATUS_CODE: int = 503

#: Exact JSON body mandated by the Seed for the DB-unreachable case. The two
#: literal string values ("error" / "unreachable") are reproduced here verbatim
#: so the test catches any drift in the route handler's failure-path payload.
EXPECTED_BODY: dict[str, str] = {"status": "error", "db": "unreachable"}


# ---------------------------------------------------------------------------
# Stub builder — a ``get_session`` override that yields a session whose
# ``execute`` raises ``SQLAlchemyError`` on the first call.
# ---------------------------------------------------------------------------


def _build_raising_session_override(
    *,
    exc: SQLAlchemyError,
) -> tuple[Any, MagicMock]:
    """Return a ``get_session`` override that yields a failing fake session.

    Parameters
    ----------
    exc:
        The :class:`sqlalchemy.exc.SQLAlchemyError` instance the fake
        session's ``execute`` coroutine will raise. A real instance (not
        the class) is passed so the test message in the ``side_effect`` is
        stable across runs.

    Returns
    -------
    tuple[Any, MagicMock]
        A two-tuple ``(override_callable, fake_session)`` where:

            * ``override_callable`` is an async generator suitable for
              ``app.dependency_overrides[get_session] = override_callable``.
            * ``fake_session`` is the underlying :class:`MagicMock` the
              override yields, exposed so the test can assert the route
              handler actually awaited ``session.execute(...)`` (and thus
              didn't fabricate a 503 without touching the DB seam).
    """
    fake_session = MagicMock(spec=AsyncSession)
    fake_session.execute = AsyncMock(side_effect=exc)

    async def _override_get_session() -> AsyncGenerator[Any, None]:
        # Mirrors the production ``api.db.session.get_session`` shape: an
        # ``AsyncGenerator`` that yields exactly one session value. FastAPI
        # awaits the generator a second time for cleanup; using a plain
        # ``yield`` ensures that cleanup is a no-op (no rollback to issue
        # on a MagicMock).
        yield fake_session

    return _override_get_session, fake_session


# ---------------------------------------------------------------------------
# Tests — AC4: 503 + {"status":"error","db":"unreachable"} on SQLAlchemyError
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_get_v1_db_health_returns_503_when_session_raises_sqlalchemy_error() -> (
    None
):
    """``GET /v1/db-health`` → 503 ``{"status":"error","db":"unreachable"}``.

    Drives a ``SQLAlchemyError`` through the production code path by
    overriding :func:`api.db.session.get_session` with a stub that yields
    a fake session whose ``execute`` raises. The route handler invokes
    :func:`api.db.health.check_db_health`, which catches the exception and
    returns ``False``; the handler then emits the documented 503 wire shape.
    """
    app = create_app()
    override, fake_session = _build_raising_session_override(
        exc=SQLAlchemyError("connection refused by upstream postgres"),
    )
    app.dependency_overrides[get_session] = override

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/v1/db-health")
    finally:
        # Defense-in-depth cleanup. ``create_app()`` returns a fresh app per
        # test so leakage across tests is impossible, but dropping the
        # override here also prevents leakage across assertions inside the
        # same test if the app is later reused (e.g. for a follow-up call).
        app.dependency_overrides.pop(get_session, None)

    # (1) HTTP status is exactly 503.
    assert response.status_code == EXPECTED_STATUS_CODE, (
        f"Expected HTTP {EXPECTED_STATUS_CODE} when the session raises "
        f"SQLAlchemyError, got {response.status_code} with body "
        f"{response.text!r}. The route handler must catch the error (via "
        f"check_db_health) and emit the Seed-pinned 503 wire shape."
    )

    # (2) Response body is exactly the Seed-pinned failure payload.
    assert response.json() == EXPECTED_BODY, (
        f"Expected body {EXPECTED_BODY!r} on the SQLAlchemyError path, got "
        f"{response.json()!r}. The Phase 4.1 Seed pins this body verbatim — "
        f"any extra/missing field or drifted value indicates a contract "
        f"regression."
    )

    # (4) The fake session's ``execute`` was awaited exactly once. This
    # guards against a regression where the handler short-circuits to a 503
    # *without* attempting the DB round-trip (which would mask actual
    # database connectivity from the health probe).
    assert fake_session.execute.await_count == 1, (
        f"Expected exactly one session.execute(...) await on the 503 path, "
        f"got await_count={fake_session.execute.await_count}. The handler "
        f"must always attempt the SELECT 1 round-trip before emitting 503."
    )


@pytest.mark.unit
async def test_get_v1_db_health_failure_body_has_no_extra_fields() -> None:
    """The 503 body contains exactly two fields: ``status`` and ``db``.

    Guards against accidental field-creep on the failure path (e.g. adding
    ``error_id``, ``detail``, ``exception_class``, or ``request_id`` to the
    error body). The Phase 4.1 Seed pins the failure body to a two-field
    response so the PII/connection-string non-leakage invariant stays
    trivially auditable.
    """
    app = create_app()
    override, _ = _build_raising_session_override(
        exc=SQLAlchemyError("auth failed"),
    )
    app.dependency_overrides[get_session] = override

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/v1/db-health")
    finally:
        app.dependency_overrides.pop(get_session, None)

    body = response.json()
    assert set(body.keys()) == {"status", "db"}, (
        f"Expected exactly the fields {{'status', 'db'}} on the 503 body, "
        f"got keys={sorted(body.keys())!r}. Extra fields on the error path "
        f"risk leaking PII / driver internals."
    )


@pytest.mark.unit
async def test_get_v1_db_health_failure_response_content_type_is_json() -> None:
    """The 503 response ``Content-Type`` is ``application/json``.

    Confirms the handler returns a :class:`fastapi.responses.JSONResponse`
    rather than a bare ``Response(..., media_type='text/plain')`` or a
    string body — which would prevent clients from machine-parsing the
    failure shape.
    """
    app = create_app()
    override, _ = _build_raising_session_override(
        exc=SQLAlchemyError("network unreachable"),
    )
    app.dependency_overrides[get_session] = override

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/v1/db-health")
    finally:
        app.dependency_overrides.pop(get_session, None)

    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("application/json"), (
        f"Expected Content-Type to start with 'application/json' on the "
        f"SQLAlchemyError 503 path, got {content_type!r}. The route must "
        f"use JSONResponse so clients can parse the failure body."
    )


@pytest.mark.unit
async def test_get_v1_db_health_503_body_does_not_leak_exception_details() -> None:
    """The 503 body never contains the exception message or driver string.

    The fake session raises an exception whose message would, if leaked,
    expose connection details ("postgres://user:password@host..."). The
    handler must convert the boolean result of ``check_db_health`` to the
    Seed-pinned two-field body — no exception class name, no traceback, no
    sqlalchemy error message anywhere in the response payload.
    """
    app = create_app()
    secret_marker = "postgres://leaked-user:leaked-password@internal.host"
    override, _ = _build_raising_session_override(
        exc=SQLAlchemyError(f"could not connect to {secret_marker}"),
    )
    app.dependency_overrides[get_session] = override

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/v1/db-health")
    finally:
        app.dependency_overrides.pop(get_session, None)

    # The raw response body must not echo the secret-bearing exception
    # message. Checking ``response.text`` (the unparsed string) catches
    # both JSON-embedded leaks and header-level leaks.
    assert secret_marker not in response.text, (
        f"503 response leaked exception details containing "
        f"{secret_marker!r}. The handler must NOT include exception "
        f"messages, traceback, or driver strings in the failure body."
    )
    # Also verify that ``SQLAlchemyError`` / ``sqlalchemy`` strings aren't
    # leaked — those would reveal the ORM stack to an external client.
    assert "SQLAlchemyError" not in response.text
    assert "sqlalchemy" not in response.text.lower()
