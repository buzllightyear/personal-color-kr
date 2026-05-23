"""Alembic environment scaffold for ``apps/api`` (Phase 4.1, Sub-AC 1).

This module is loaded by the Alembic CLI when running migrations:

    alembic -c apps/api/alembic.ini upgrade head

It also doubles as an importable Python module so the unit test suite can
assert:

    1. The alembic configuration loads via :class:`alembic.config.Config` and
       reports ``script_location = src/api/db/migrations`` (the Phase 4.1
       single-Alembic-boundary invariant).
    2. ``target_metadata`` is exposed as a :class:`sqlalchemy.MetaData`
       instance, ready for Phase 4.2+ migrations to attach declarative models.

Runtime semantics
-----------------
The module body is import-safe: every interaction with the alembic
``EnvironmentContext`` proxy is deferred until either the alembic CLI
executes the bottom block or a migration function is called explicitly.
When ``env.py`` is imported outside the alembic runtime (e.g. by the unit
test), the proxy isn't bound and ``context.is_offline_mode()`` raises
``NameError`` — the guard at the bottom of the file detects that path and
skips migration execution without silently swallowing real exceptions.

Async wiring
------------
The online migration runner builds a SQLAlchemy 2.0 ``AsyncEngine`` via
:func:`sqlalchemy.ext.asyncio.async_engine_from_config` (matching the
``postgresql+asyncpg://...`` URL scheme used everywhere else in
``apps/api/src/api/db``). The DATABASE_URL is resolved at runtime by
python-dotenv's ``find_dotenv()`` against the Phase 1.2 root ``.env`` — the
``alembic.ini`` value is intentionally blank so credentials never live in
version control.

This module is part of the single SQLAlchemy import boundary for ``apps/api``
(grep invariant AC11). The other members are ``api.db.engine``,
``api.db.session``, and ``api.db.health``.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig
from typing import Any

from alembic import context
from dotenv import find_dotenv, load_dotenv
from sqlalchemy import MetaData, pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# ---------------------------------------------------------------------------
# Target metadata
# ---------------------------------------------------------------------------
# Phase 4.1 ships zero application tables — the baseline migration is a no-op
# whose sole purpose is to establish the migration chain (``down_revision =
# None``) so Phase 4.2+ migrations can extend it. Later phases will register
# declarative models against this same ``MetaData`` instance.
target_metadata: MetaData = MetaData()


# ---------------------------------------------------------------------------
# DATABASE_URL resolution
# ---------------------------------------------------------------------------
def _resolve_database_url() -> str | None:
    """Resolve ``DATABASE_URL`` via the Phase 1.2 root ``.env`` + python-dotenv.

    Returns
    -------
    str | None
        The connection URL when configured, else ``None``. A ``None`` return
        defers to whatever ``sqlalchemy.url`` value is set in ``alembic.ini``
        (Phase 4.1 leaves that blank, so alembic will raise an explicit error
        instead of silently connecting to a default URL — that's intentional).

    Notes
    -----
    Loading is non-overriding: if ``DATABASE_URL`` is already set in the
    process environment (e.g. by CI's ``services: postgres:`` block), the
    existing value wins. The ``find_dotenv(usecwd=True)`` call walks up from
    the current working directory, mirroring the Phase 1.2 + Phase 3.1
    convention used elsewhere in the repo.
    """
    load_dotenv(find_dotenv(usecwd=True), override=False)
    return os.environ.get("DATABASE_URL")


# ---------------------------------------------------------------------------
# Sync inner runner — invoked by ``connection.run_sync(...)``
# ---------------------------------------------------------------------------
def _do_run_migrations(connection: Connection) -> None:
    """Configure the alembic context against an active sync connection.

    The :class:`~sqlalchemy.ext.asyncio.AsyncConnection` exposes ``run_sync``
    which hands a sync :class:`~sqlalchemy.engine.Connection` to a callable.
    Alembic's ``context.configure`` + ``context.run_migrations`` API is
    sync-only, so we tunnel through this helper. The transaction is opened
    explicitly so each migration runs in its own transaction (alembic's
    default behavior).
    """
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Async migration runner — used when alembic is invoked with a live DB
# ---------------------------------------------------------------------------
async def _run_async_migrations() -> None:
    """Build an async engine and run migrations against it.

    Uses :class:`sqlalchemy.pool.NullPool` because alembic CLI processes are
    short-lived; the connection is opened once, the migrations run, and the
    process exits. Persistent pooling would only add shutdown complexity here.
    """
    config = context.config
    raw_section = config.get_section(config.config_ini_section, {}) or {}
    section: dict[str, Any] = dict(raw_section)

    # Prefer the runtime-resolved DATABASE_URL over whatever is in alembic.ini
    # (which is intentionally blank in Phase 4.1).
    db_url = _resolve_database_url()
    if db_url is not None:
        section["sqlalchemy.url"] = db_url

    connectable = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)

    await connectable.dispose()


# ---------------------------------------------------------------------------
# Public entry points (alembic-runtime invoked)
# ---------------------------------------------------------------------------
def run_migrations_online() -> None:
    """Run migrations in 'online' mode — against a live async DB connection.

    Wraps :func:`_run_async_migrations` in :func:`asyncio.run` so the alembic
    CLI (which is fully synchronous) can drive an async engine. Each call
    creates its own event loop; alembic processes invoke this exactly once
    per CLI invocation.
    """
    asyncio.run(_run_async_migrations())


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL without a live connection.

    Offline mode is what ``alembic upgrade head --sql`` triggers; it's useful
    for reviewing the SQL alembic would generate before applying it to a
    real database. The DATABASE_URL resolution falls back to whatever is in
    ``alembic.ini`` if the environment doesn't set one.
    """
    config = context.config
    db_url = _resolve_database_url() or config.get_main_option("sqlalchemy.url")
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Alembic-runtime detection guard
# ---------------------------------------------------------------------------
def _running_under_alembic() -> bool:
    """Detect whether the alembic ``EnvironmentContext`` proxy is bound.

    The alembic CLI binds the proxy via :class:`alembic.runtime.environment.
    EnvironmentContext.configure` *before* executing ``env.py``. When the
    module is imported by the unit test (for the script_location and
    target_metadata assertions), the proxy isn't bound — calling any
    ``context.*`` function raises a ``NameError`` originating from
    ``alembic.util.langhelpers._name_error``.

    Catching ``NameError`` here keeps the module import-safe in tests without
    silently swallowing real exceptions that occur once alembic is actually
    driving the migrations.
    """
    try:
        context.is_offline_mode()
    except NameError:
        return False
    return True


# ---------------------------------------------------------------------------
# Top-level execution (alembic CLI path only)
# ---------------------------------------------------------------------------
if _running_under_alembic():  # pragma: no cover - exercised by alembic CLI
    _config = context.config
    if _config.config_file_name is not None:
        fileConfig(_config.config_file_name)
    if context.is_offline_mode():
        run_migrations_offline()
    else:
        run_migrations_online()
