"""SQLAlchemy 2.0 ``AsyncEngine`` factory (Phase 4.1, Sub-AC 2).

This module owns the single ``create_async_engine`` call site for apps/api.
The Phase 4.1 Seed pins ``apps/api/src/api/db/`` as the only directory where
``sqlalchemy*`` imports may appear; this module is one of three such files
(alongside ``api.db.session`` and the future ``api.db.migrations.env``).

# Lifecycle

The engine is constructed lazily on the first call to :func:`get_engine` and
cached at module scope. Repeated calls return the same instance so the
connection pool is shared across all ``/v1/db-health`` requests instead of
re-opening a new pool per request.

Lazy initialization is critical for the unit-test tier: ``GET /v1/health``
does not touch the DB, but it shares the same ``create_app()`` factory. If
the engine were built at import time, every unit test that calls
``create_app()`` would require ``DATABASE_URL`` to be set — defeating the
seam between the unit tier (no DB) and the integration tier (real Postgres).

# Test reset hook

:func:`reset_engine` disposes the cached engine and clears the cache. It is
intended for integration-test teardown so a subsequent test that points at
a different ``DATABASE_URL`` (or the same URL but a fresh pool) doesn't
inherit stale connections. Production code never calls this function.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from api.config.env import get_database_url

# Module-level cache for the lazily constructed engine. Typed explicitly
# (rather than relying on inference) so mypy --strict treats reads as
# ``AsyncEngine | None`` and forces the ``if _engine is None:`` narrowing
# inside :func:`get_engine`.
_engine: AsyncEngine | None = None


def get_engine() -> AsyncEngine:
    """Return the cached ``AsyncEngine`` for apps/api, constructing it once.

    The engine is built from ``DATABASE_URL`` (resolved through
    :func:`api.config.env.get_database_url`, which loads the monorepo-root
    ``.env`` on first access). Subsequent calls return the cached instance.

    Returns
    -------
    AsyncEngine
        A SQLAlchemy 2.0 async engine bound to the asyncpg driver.

    Raises
    ------
    RuntimeError
        If ``DATABASE_URL`` is unset (or empty) when the engine is first
        requested. The error message names the variable and the expected
        ``postgresql+asyncpg://`` scheme so the operator knows exactly
        which value to set; it never includes the resolved URL value
        (which would leak the connection string into logs).
    """
    global _engine
    if _engine is not None:
        return _engine

    url = get_database_url()
    if url is None:
        raise RuntimeError(
            "DATABASE_URL is not set in os.environ; cannot construct the "
            "SQLAlchemy async engine. Set DATABASE_URL to a "
            "'postgresql+asyncpg://user:pass@host:5432/db' URL (Phase 1.2 "
            "root .env) before starting uvicorn or the integration tests."
        )

    # ``future=True`` is the SQLAlchemy 2.0 idiom and a no-op on 2.x where
    # the future API is the default; spelling it out documents intent and
    # protects against accidental 1.4-compat regressions.
    _engine = create_async_engine(url, future=True)
    return _engine


async def reset_engine() -> None:
    """Dispose the cached engine and clear the module-level cache.

    Used by integration-test teardown (and by the future app-shutdown hook,
    Sub-AC pending) so the connection pool releases its asyncpg connections
    cleanly. Calling :func:`get_engine` after :func:`reset_engine` rebuilds
    a fresh engine from the (possibly updated) ``DATABASE_URL`` env var.

    Production request paths never call this function.
    """
    global _engine
    if _engine is None:
        return
    # ``AsyncEngine.dispose`` is an awaitable; awaiting it closes every
    # idle connection in the pool. Pending in-flight queries are *not*
    # cancelled here — callers must complete their requests before
    # resetting the engine.
    await _engine.dispose()
    _engine = None
