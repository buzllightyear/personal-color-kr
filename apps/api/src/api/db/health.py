"""Async DB liveness check used by ``GET /v1/db-health`` (Phase 4.1).

The ``check_db_health`` coroutine executes a single ``SELECT 1`` round-trip
through a SQLAlchemy 2.0 :class:`~sqlalchemy.ext.asyncio.AsyncSession` and
returns a boolean status indicator:

    - ``True`` — the round-trip succeeded and the driver returned the literal
      value ``1`` (the database is reachable and accepting queries).
    - ``False`` — any :class:`sqlalchemy.exc.SQLAlchemyError` was raised
      (network failure, dead connection pool, auth failure, etc.). The
      exception is caught and converted to a boolean so the caller (the
      ``/v1/db-health`` route) can map the status to HTTP 503 + JSON body
      ``{"status":"error","db":"unreachable"}`` without re-implementing the
      exception-to-status mapping.

Why catch-and-return instead of propagate?
    The Seed contract pins the ``/v1/db-health`` 503 response shape to
    ``{"status":"error","db":"unreachable"}`` — no exception class names, no
    traceback, no driver string. Converting the SQLAlchemyError to a bool at
    the boundary keeps that contract trivially enforceable in the route
    handler and prevents PII / connection-string leakage through error
    propagation. Non-``SQLAlchemyError`` exceptions (e.g. ``asyncio.CancelledError``,
    ``KeyboardInterrupt``) are intentionally *not* caught — they reflect
    request-scoped lifecycle signals or programmer errors that must surface
    to the route's outer exception handler.

This module is the only place ``sqlalchemy*`` symbols are imported in
``apps/api/src/api/`` outside the rest of the ``api.db.*`` boundary.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession


async def check_db_health(session: AsyncSession) -> bool:
    """Execute ``SELECT 1`` via ``session`` and report reachability.

    Parameters
    ----------
    session:
        A SQLAlchemy 2.0 async session (or any object with a compatible
        ``async def execute(stmt)`` surface that yields a
        :class:`~sqlalchemy.engine.Result`). The session is *not* committed,
        rolled back, or closed here — lifecycle management lives in the
        Depends-injected ``get_session`` factory.

    Returns
    -------
    bool
        ``True`` when the ``SELECT 1`` round-trip succeeds and the scalar
        result equals ``1``. ``False`` when any ``SQLAlchemyError`` is raised
        by the driver.
    """
    try:
        result = await session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return False
    # ``Result.scalar_one()`` is typed as ``Any`` in SQLAlchemy stubs, so an
    # ``== 1`` comparison would leak ``Any`` into the return value under
    # ``mypy --strict``. Wrapping in ``bool(...)`` pins the return to a
    # concrete ``bool`` for the type checker without changing semantics
    # (Python's ``==`` already returns a bool).
    return bool(result.scalar_one() == 1)
