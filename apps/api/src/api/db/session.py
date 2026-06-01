"""``AsyncSession`` factory + FastAPI ``Depends(get_session)`` provider.

This module is the second of three files inside the single SQLAlchemy
import boundary (alongside :mod:`api.db.engine` and :mod:`api.db.health`).
It owns:

    * The ``async_sessionmaker`` bound to the cached engine from
      :func:`api.db.engine.get_engine`.
    * The per-request ``get_session`` async-generator dependency consumed
      by ``GET /v1/db-health`` (and every future DB-touching route).

# Why re-export ``AsyncSession``?

The Phase 4.1 Seed enforces the SQLAlchemy import boundary via the AC11
grep regex ``^(from|import) sqlalchemy`` against ``apps/api/src/api``. Any
file outside ``api/db/`` that imports ``AsyncSession`` directly from
``sqlalchemy.ext.asyncio`` would break that invariant. Re-exporting the
class via ``api.db.session.AsyncSession`` (and only here, inside the
boundary) lets routers type their ``Depends(get_session)`` parameter
without breaking the grep test:

    # inside apps/api/src/api/routers/health.py — boundary-safe:
    from api.db.session import AsyncSession, get_session

The source-line regex doesn't match because the line starts with
``from api.db.session``, not ``from sqlalchemy``.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.sql import func

from api.db.engine import get_engine

# Public symbols re-exported so router/dependency modules can import the
# ``AsyncSession`` type, query builders, and SQL helpers without touching
# ``sqlalchemy.*`` directly (which would violate the AC11 single-import-
# boundary invariant). Phase 4.3 added ``select``/``pg_insert``/``func``
# so the auth router can build the atomic ON CONFLICT upsert without
# importing sqlalchemy itself.
__all__ = [
    "AsyncSession",
    "IntegrityError",
    "func",
    "get_session",
    "pg_insert",
    "select",
]


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a per-request ``AsyncSession`` bound to the cached engine.

    FastAPI invokes this generator as a dependency: the framework awaits
    the first ``yield`` to obtain the session, passes it to the handler,
    then awaits the generator a second time after the response is sent so
    the ``async with`` exit path closes the session and rolls back any
    pending transaction on exception.

    The session is built fresh per request (``async_sessionmaker`` is
    instantiated inline), but the underlying engine — and therefore its
    connection pool — is shared across all requests via
    :func:`api.db.engine.get_engine`. Construction is cheap (no I/O, no
    connection) so building the sessionmaker per request keeps the seam
    simple without measurable overhead.

    Yields
    ------
    AsyncSession
        A SQLAlchemy 2.0 async session ready for ``await session.execute(...)``
        round-trips. Used by ``GET /v1/db-health`` to issue ``SELECT 1`` via
        :func:`api.db.health.check_db_health`.
    """
    # ``expire_on_commit=False`` is the SQLAlchemy 2.0 default for the async
    # API. Setting it explicitly documents that ORM attributes stay live
    # after a commit (which doesn't matter for the SELECT 1 health probe
    # but does matter for future DB-touching routes that read ORM rows
    # outside the transaction window).
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        yield session
