"""In-process Alembic migration tests for the Phase 4.2 ``events`` table.

Acceptance criteria covered
---------------------------
* **≥80% coverage on new code** — closes the visible gap in
  ``src/api/db/migrations/versions/2026_01_02_0000-phase_4_2_events_create_events_table.py``
  (lines 68–132 and 150–152). The sibling
  ``test_events_migration.py`` already exercises ``upgrade`` /
  ``downgrade`` against real Postgres, but it does so through
  ``subprocess.run([sys.executable, "-m", "alembic", ...])`` — coverage
  collected by the parent pytest process therefore does NOT see those
  lines as executed.
* **migration_applies** + **downgrade_clean** (companion evidence) —
  drives the same migration callables via ``alembic.command.upgrade``
  and ``alembic.command.downgrade`` in-process, against the same real
  Postgres 16 the subprocess tests use.

Why a separate file (not a replacement)?
----------------------------------------
The subprocess-driven test in ``test_events_migration.py`` is the
production-shape integration test: CI, docker-compose smoke, and the
developer's local ``alembic ... upgrade head`` workflow all spawn alembic
as a CLI process. Removing or rewriting that test would weaken the
production-path coverage. This file therefore lives alongside it and
provides the in-process variant **only** so the coverage tool sees the
migration body executed.

The two tests are intentionally redundant in their *behavioral*
assertions (both confirm the events table is created and dropped against
real Postgres). The non-overlapping value is:

    * ``test_events_migration.py``        — production CLI invocation path.
    * ``test_events_migration_inprocess`` — line-coverage visibility for
                                            the migration module body.

Scope discipline
----------------
* No mocks — drives a real Postgres 16 connection via the same
  ``DATABASE_URL_TEST`` / ``DATABASE_URL`` lookup as every other file in
  this directory. Self-skips when neither variable is set.
* Only touches the ``events`` table and the ``alembic_version`` row;
  resets DB state before the test so concurrent sibling integration
  tests are not disrupted.
* Does NOT modify sibling files (no shared conftest changes, no edits
  to the migration module, no edits to the existing subprocess test).
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic import context as alembic_context_module
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# ---------------------------------------------------------------------------
# Path + revision constants (mirror test_events_migration.py for parity)
# ---------------------------------------------------------------------------
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

_BASELINE_REVISION: str = "phase_4_1_baseline"
_EVENTS_REVISION: str = "phase_4_2_events"


def _resolved_database_url() -> str | None:
    """Return the test DB URL (``DATABASE_URL_TEST`` ▸ ``DATABASE_URL``)."""
    candidate = os.environ.get("DATABASE_URL_TEST") or os.environ.get("DATABASE_URL")
    if candidate is None or candidate == "":
        return None
    return candidate


_RESOLVED_URL: str | None = _resolved_database_url()

_SKIP_REASON: str = (
    "Neither DATABASE_URL nor DATABASE_URL_TEST is set; skipping the "
    "in-process alembic migration test (which requires a real Postgres "
    "16 connection). To run it locally: `docker compose up -d postgres` "
    "then export DATABASE_URL_TEST=postgresql+asyncpg://<user>:<pass>@"
    "127.0.0.1:5432/<db>."
)


# ---------------------------------------------------------------------------
# Cross-test isolation: restore alembic context to a "fresh import" state
# ---------------------------------------------------------------------------
# ``alembic.command.upgrade`` / ``command.downgrade`` install and then
# remove an :class:`EnvironmentContext` proxy in the ``alembic.context``
# module's globals. The "remove" step sets ``alembic.context._proxy = None``
# instead of deleting the attribute — which means the generated module-
# level methods (e.g. ``context.is_offline_mode()``) raise
# ``AttributeError: 'NoneType' object has no attribute 'is_offline_mode'``
# on subsequent calls instead of the original ``NameError``.
#
# Downstream tests (notably ``tests/unit/test_alembic_env.py``) re-import
# ``api.db.migrations.env``, whose bottom-of-file guard
# (``_running_under_alembic()``) only catches ``NameError`` — so once our
# in-process alembic invocation has flipped ``_proxy`` from "unbound" to
# ``None``, the guard mis-fires and the env.py import path crashes.
#
# This autouse fixture restores the pre-invocation state (``_proxy``
# attribute fully absent) so the env.py guard's ``except NameError``
# clause catches the proxy-not-installed condition correctly when later
# tests re-import the module. The fixup is local to this test file —
# we do NOT modify ``env.py`` (sibling-file) or any shared conftest.
@pytest.fixture(autouse=True)
def _restore_alembic_and_logger_state_after_test() -> Iterator[None]:
    """Restore alembic + logging state after each in-process alembic call.

    Two pieces of global state get clobbered when ``command.upgrade`` /
    ``command.downgrade`` execute env.py in-process:

    1. **alembic context proxy** — ``command.*`` installs an
       :class:`EnvironmentContext` proxy in the ``alembic.context``
       module's globals, then sets ``_proxy = None`` on teardown
       instead of deleting it. The generated module-level methods
       (``context.is_offline_mode()``) therefore raise
       ``AttributeError: 'NoneType' object has no attribute
       'is_offline_mode'`` instead of the pre-install ``NameError``.

       Why does that matter? Downstream tests (notably
       ``tests/unit/test_alembic_env.py``) re-import
       ``api.db.migrations.env``, whose ``_running_under_alembic()``
       guard only catches ``NameError`` — so leaving ``_proxy`` set
       to ``None`` would crash the env.py import path.

       Restoring with ``del`` (not "set back to None") returns the
       module to its pristine "attribute absent" state.

    2. **stdlib logging registry** — env.py's runtime block calls
       ``fileConfig(alembic.ini)``, which uses the stdlib default
       ``disable_existing_loggers=True``. That sets
       ``Logger.disabled = True`` on every logger that was already
       in the registry — including ``apps.api`` (the FastAPI
       request logger). Downstream tests such as
       ``tests/unit/test_json_log_schema.py`` then see zero records
       because their handler is attached to a disabled logger.

       Re-enabling every previously-disabled logger restores the
       capture path without us having to know which specific names
       the AC15 / AC16 logging tests depend on.

    The fixup is local to this test file — we do NOT modify ``env.py``
    (sibling-file) or any shared conftest. Both restorations are
    idempotent and no-op when the test skipped (no in-process alembic
    call ran).
    """
    yield
    # ---- Restoration 1: alembic context proxy.
    if hasattr(alembic_context_module, "_proxy"):
        delattr(alembic_context_module, "_proxy")
    # ---- Restoration 2: stdlib logger registry.
    # ``Logger.manager.loggerDict`` contains every named logger plus
    # ``PlaceHolder`` entries for orphaned hierarchy nodes; only the
    # ``Logger`` instances carry a ``disabled`` flag we need to reset.
    for _logger in logging.Logger.manager.loggerDict.values():
        if isinstance(_logger, logging.Logger) and _logger.disabled:
            _logger.disabled = False


def _alembic_config(db_url: str) -> Config:
    """Build an :class:`alembic.config.Config` pointed at the Phase 4.1 ini.

    Overrides ``sqlalchemy.url`` so the in-process alembic invocation
    uses the test DB without depending on env.py's ``.env`` resolution —
    keeping this test hermetic regardless of the developer's local
    dotenv setup.
    """
    cfg = Config(str(_ALEMBIC_INI_PATH))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def _reset_db_to_blank(db_url: str) -> None:
    """Drop ``events`` + ``alembic_version`` so the migration runs clean.

    Wraps the async drop helper in :func:`asyncio.run` so this fixture
    can be used from synchronous test bodies (required because the
    in-process alembic command API is itself synchronous).
    """

    async def _drop() -> None:
        engine = create_async_engine(db_url, future=True)
        try:
            async with engine.begin() as conn:
                await conn.execute(text("DROP TABLE IF EXISTS generations CASCADE"))
                await conn.execute(text("DROP TABLE IF EXISTS recipes CASCADE"))
                await conn.execute(text("DROP TABLE IF EXISTS events CASCADE"))

                await conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
                await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
        finally:
            await engine.dispose()

    asyncio.run(_drop())


def _events_table_exists(db_url: str) -> bool:
    """Return ``True`` iff ``information_schema.tables`` lists ``events``."""

    async def _check() -> bool:
        engine = create_async_engine(db_url, future=True)
        try:
            async with engine.connect() as conn:
                result = await conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.tables "
                        "WHERE table_name = 'events'"
                    )
                )
                return result.first() is not None
        finally:
            await engine.dispose()

    return asyncio.run(_check())


# ---------------------------------------------------------------------------
# Test 1 — in-process upgrade head exercises the migration's upgrade() body
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
def test_inprocess_alembic_upgrade_head_creates_events_table() -> None:
    """``command.upgrade(cfg, "head")`` runs the migration and creates events.

    The call path is:

        alembic.command.upgrade
            -> env.py:run_migrations_online()
                -> asyncio.run(_run_async_migrations())
                    -> connection.run_sync(_do_run_migrations)
                        -> context.run_migrations()
                            -> versions/...phase_4_2_events.upgrade()

    Because every step above (including the migration body) runs inside
    the pytest process, ``coverage`` sees the migration's ``upgrade()``
    statements as executed — closing the visibility gap left by the
    subprocess-driven sibling test.
    """
    assert _RESOLVED_URL is not None  # narrowed by skipif; for mypy --strict

    # ---- Deterministic starting state.
    _reset_db_to_blank(_RESOLVED_URL)
    assert not _events_table_exists(
        _RESOLVED_URL
    ), "events table must not exist before the upgrade runs"

    # ---- In-process upgrade — this is the line that makes coverage see
    # the migration body's `op.create_table(...)` and `op.create_index(...)`
    # calls as executed.
    cfg = _alembic_config(_RESOLVED_URL)
    command.upgrade(cfg, _EVENTS_REVISION)

    # ---- Behavioral assertion: events table now exists.
    assert _events_table_exists(
        _RESOLVED_URL
    ), "events table must exist after `alembic upgrade phase_4_2_events`"


# ---------------------------------------------------------------------------
# Test 2 — in-process downgrade to baseline exercises the downgrade() body
# ---------------------------------------------------------------------------
@pytest.mark.integration
@pytest.mark.skipif(_RESOLVED_URL is None, reason=_SKIP_REASON)
def test_inprocess_alembic_downgrade_to_baseline_drops_events_table() -> None:
    """``command.downgrade(cfg, baseline)`` runs the migration's downgrade body.

    Symmetric to the upgrade test above — drives the same alembic
    Python API so the downgrade callable (``drop_index`` x2 +
    ``drop_table``) is executed in the pytest process and therefore
    visible to ``coverage``.

    The test resets state, upgrades to head, then downgrades and asserts
    the events table is gone — proving both that the downgrade ran AND
    that the migration's rollback path is correct.
    """
    assert _RESOLVED_URL is not None

    # ---- Start clean, upgrade, then verify table is in place.
    _reset_db_to_blank(_RESOLVED_URL)
    cfg = _alembic_config(_RESOLVED_URL)
    command.upgrade(cfg, _EVENTS_REVISION)
    assert _events_table_exists(
        _RESOLVED_URL
    ), "events table must exist after upgrade so downgrade has something to drop"

    # ---- In-process downgrade — this is the line that makes coverage
    # see the migration body's `op.drop_index(...)` x2 + `op.drop_table(...)`
    # calls as executed.
    command.downgrade(cfg, _BASELINE_REVISION)

    # ---- Behavioral assertion: events table is gone.
    assert not _events_table_exists(
        _RESOLVED_URL
    ), "events table must not exist after downgrade to phase_4_1_baseline"
