"""Unit tests for ``api.db.health.check_db_health`` (Phase 4.1, Sub-AC 1).

Contract under test:

    ``async def check_db_health(session: AsyncSession) -> bool`` executes a
    single ``SELECT 1`` round-trip through the provided SQLAlchemy 2.0 async
    session.

        - On success, the function returns ``True`` (the database round-trip
          completed and the scalar result is ``1``).
        - When the driver raises ``SQLAlchemyError`` (network down, dead pool,
          auth failure, etc.), the function returns ``False`` *without*
          re-raising — this lets the ``/v1/db-health`` route map the boolean
          to its 200 / 503 response shapes without re-implementing the
          exception-to-status mapping or leaking driver internals.

Why these tests live in the unit tier:

    The mock-based seam stays inside ``api/src/api/db/`` (the single
    SQLAlchemy import boundary). The async session is mocked with
    :class:`~unittest.mock.AsyncMock`, so the real asyncpg driver and the
    real Postgres container are *not* required. The Seed's
    ``test_seam`` constraint reserves real-Postgres exercise for the
    ``@pytest.mark.integration`` tier; this file lives in
    ``apps/api/tests/unit/`` and is always exercised by ``pytest -q
    apps/api/tests`` in the four-way consistency quartet.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from api.db.health import check_db_health


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_db_health_returns_true_when_select_1_round_trip_succeeds() -> None:
    """SELECT 1 success path: scalar result == 1 ⇒ ``check_db_health`` is True."""
    # Build a fake AsyncSession whose ``execute`` is an awaitable returning a
    # Result-like object whose ``scalar_one()`` yields the literal 1 — the
    # exact contract the function checks.
    fake_result = MagicMock()
    fake_result.scalar_one.return_value = 1

    fake_session = MagicMock()
    fake_session.execute = AsyncMock(return_value=fake_result)

    assert await check_db_health(fake_session) is True

    # Verify that exactly one ``SELECT 1`` round-trip was issued — guarding
    # against future refactors that accidentally drop the DB touch (which
    # would make ``check_db_health`` a no-op that always returns True).
    assert fake_session.execute.await_count == 1
    (call,) = fake_session.execute.await_args_list
    (stmt,) = call.args
    # ``text("SELECT 1")`` instances stringify to the literal SQL — comparing
    # by ``str()`` keeps the assertion robust against TextClause identity.
    assert str(stmt) == str(text("SELECT 1"))


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_db_health_returns_false_when_sqlalchemy_error_is_raised() -> None:
    """Failure path: SQLAlchemyError ⇒ ``check_db_health`` returns False (no re-raise).

    The route handler relies on this contract to map a False result to HTTP
    503 + ``{"status":"error","db":"unreachable"}`` without needing to catch
    the SQLAlchemyError itself.
    """
    fake_session = MagicMock()
    fake_session.execute = AsyncMock(
        side_effect=SQLAlchemyError("connection refused by upstream postgres"),
    )

    # The function must swallow the SQLAlchemyError and return False — NOT
    # propagate the exception (which would leak the connection-string-bearing
    # error message into the route's outer exception handler).
    assert await check_db_health(fake_session) is False
    assert fake_session.execute.await_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_check_db_health_propagates_non_sqlalchemy_errors() -> None:
    """Non-SQLAlchemy errors are intentionally NOT caught.

    ``asyncio.CancelledError`` / ``KeyboardInterrupt`` / generic ``RuntimeError``
    reflect request-scoped lifecycle signals or programmer errors that must
    surface to the outer ``/v1/db-health`` exception handler (and ultimately
    the request_id-tagged JSON log line). Catching them here would mask
    those signals as ``db: unreachable``.
    """
    fake_session = MagicMock()
    fake_session.execute = AsyncMock(side_effect=RuntimeError("boom"))

    with pytest.raises(RuntimeError, match="boom"):
        await check_db_health(fake_session)
