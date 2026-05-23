"""Verify the async engine/session fixtures bind to ``DATABASE_URL_TEST``.

Acceptance criterion covered (Sub-AC 8.1)
-----------------------------------------
**Create async engine/session factory fixture bound to ``DATABASE_URL_TEST``
environment variable with a test verifying the engine connects and returns
a working ``AsyncSession``.**

This module exercises the three fixtures defined in
``apps/api/tests/integration/conftest.py``:

    * ``resolved_test_database_url`` — string value or skip.
    * ``async_engine``               — :class:`AsyncEngine` bound to the URL.
    * ``async_session_factory``      — :class:`async_sessionmaker` bound to it.
    * ``async_session``              — :class:`AsyncSession` opened from the
                                       factory.

Why a dedicated smoke test?
---------------------------
The Phase 4.2 events tests (``test_events_migration.py``,
``test_events_model_roundtrip.py``) each build their own engine inline. A
regression that breaks the shared fixture (a typo in the URL lookup, a
missing ``await dispose``) would surface as a confusing cascade failure
across every Phase 4.3+ test that adopts the fixture. This file fails
fast with a focused diagnostic instead: if ``SELECT 1`` does not round-trip
through the fixture, every downstream consumer is also broken — and we
learn it from a single 3-assertion test.

Skip semantics
--------------
The fixtures self-skip the consuming test when neither
``DATABASE_URL_TEST`` nor ``DATABASE_URL`` is set; this file inherits
that behavior automatically by requesting the fixtures as parameters.
"""

from __future__ import annotations

from urllib.parse import urlparse

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)


# ---------------------------------------------------------------------------
# Test 1 — the resolved URL fixture exposes the env var value (or skips)
# ---------------------------------------------------------------------------
@pytest.mark.integration
async def test_resolved_test_database_url_points_at_asyncpg_postgres(
    resolved_test_database_url: str,
) -> None:
    """``resolved_test_database_url`` yields a non-empty ``postgresql+asyncpg`` URL.

    The fixture must:

        * Return a non-empty string (empty string ≡ unset is enforced
          inside the fixture; consumers should never receive ``""``).
        * Use the ``postgresql+asyncpg`` scheme (Seed constraint — the
          asyncpg driver is the only supported async dialect for
          apps/api). A bare ``postgresql://`` URL would silently fall
          back to psycopg2 (sync) and break the rest of the test tier.

    The exact host / port / credentials are intentionally NOT asserted —
    the URL may differ between developer machines, docker-compose, and
    GitHub Actions service containers. We only pin the contract that
    every downstream fixture relies on (scheme, non-empty).
    """
    assert resolved_test_database_url, (
        "resolved_test_database_url returned an empty string. The fixture "
        "should skip the test (not return '') when DATABASE_URL_TEST and "
        "DATABASE_URL are both unset — investigate "
        "apps/api/tests/integration/conftest.py:_resolved_test_database_url."
    )

    parsed = urlparse(resolved_test_database_url)
    assert parsed.scheme == "postgresql+asyncpg", (
        "Integration tests must use the asyncpg dialect, not a sync driver. "
        f"Got scheme {parsed.scheme!r} from "
        f"{resolved_test_database_url!r}. Set DATABASE_URL_TEST to a "
        "'postgresql+asyncpg://user:pass@host:5432/db' URL."
    )


# ---------------------------------------------------------------------------
# Test 2 — async_engine connects and round-trips ``SELECT 1``
# ---------------------------------------------------------------------------
@pytest.mark.integration
async def test_async_engine_fixture_connects_and_executes_select_one(
    async_engine: AsyncEngine,
) -> None:
    """``async_engine`` opens a real connection and returns ``1`` from ``SELECT 1``.

    The smoke test issues the simplest possible round-trip:

        * ``engine.begin()`` opens a transaction (which forces asyncpg to
          actually establish a TCP connection — ``create_async_engine``
          is lazy and does no I/O until this point).
        * ``conn.execute(text("SELECT 1"))`` exercises the asyncpg
          protocol, the SQLAlchemy 2.0 ``text()`` clause, and the result
          unboxing path.
        * ``result.scalar_one() == 1`` asserts the value round-trips
          (catching driver-misconfiguration regressions where asyncpg
          might silently return ``None`` or a string).

    A failure here is a fixture-level failure — every Phase 4.3+ test
    that consumes ``async_engine`` will also fail until this passes.
    """
    async with async_engine.begin() as conn:
        result = await conn.execute(text("SELECT 1"))
        value = result.scalar_one()

    assert value == 1, (
        "async_engine fixture failed the SELECT 1 round-trip. The driver "
        f"returned {value!r} (type {type(value).__name__}). The common "
        "failure modes are: (a) Postgres container not running, (b) "
        "DATABASE_URL_TEST points at a DB that does not accept "
        "connections, or (c) the asyncpg driver is mis-imported."
    )


# ---------------------------------------------------------------------------
# Test 3 — async_session_factory yields a working AsyncSession
# ---------------------------------------------------------------------------
@pytest.mark.integration
async def test_async_session_factory_yields_working_async_session(
    async_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """``async_session_factory()`` opens an :class:`AsyncSession` that executes SQL.

    The factory is the surface most Phase 4.3+ tests will consume (a
    one-line ``async with factory() as session:`` opens a clean session
    per test step). We assert two properties:

        * The opened object is exactly an :class:`AsyncSession` (not a
          ``Session``, not a ``Connection``) so type-checked tests in
          Phase 4.3+ get the expected interface.
        * ``session.execute(text("SELECT 2"))`` round-trips ``2`` (a
          distinct constant from Test 2 so a copy/paste regression that
          mixed up the two tests is caught immediately).
    """
    async with async_session_factory() as session:
        assert isinstance(session, AsyncSession), (
            "async_session_factory must yield an AsyncSession instance; "
            f"got {type(session).__name__!r}. Check that "
            "async_sessionmaker(...) in conftest.py is parameterized with "
            "class_=AsyncSession or accepts the default mapping."
        )
        result = await session.execute(text("SELECT 2"))
        value = result.scalar_one()

    assert value == 2, (
        "async_session_factory opened an AsyncSession that returned "
        f"{value!r} from SELECT 2 instead of 2. The session is wired but "
        "the result-fetch path is broken — likely an asyncpg dialect "
        "regression."
    )


# ---------------------------------------------------------------------------
# Test 4 — the single-session ``async_session`` fixture is also live
# ---------------------------------------------------------------------------
@pytest.mark.integration
async def test_async_session_fixture_executes_select_three(
    async_session: AsyncSession,
) -> None:
    """``async_session`` (single pre-opened session) executes ``SELECT 3``.

    Most Phase 4.3+ tests only need a single session — they request
    ``async_session`` directly instead of opening one through
    ``async_session_factory``. This test asserts the convenience fixture
    is wired to a working session by:

        * Confirming the injected object is an :class:`AsyncSession`.
        * Round-tripping ``3`` via ``SELECT 3`` (distinct from Tests 2/3
          so a fixture-chain regression that re-pointed ``async_session``
          at a stale engine is caught here).
    """
    assert isinstance(async_session, AsyncSession), (
        "async_session fixture must yield an AsyncSession instance; got "
        f"{type(async_session).__name__!r}. Check the fixture chain in "
        "apps/api/tests/integration/conftest.py."
    )

    result = await async_session.execute(text("SELECT 3"))
    value = result.scalar_one()

    assert value == 3, (
        "async_session executed SELECT 3 and got "
        f"{value!r} instead of 3. The session opened but the result "
        "decode path is broken."
    )
