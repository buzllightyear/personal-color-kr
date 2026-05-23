"""Unit test for the Alembic scaffold (Phase 4.1, Sub-AC 1).

Verifies the four invariants of the alembic boundary that downstream
acceptance criteria depend on:

    1. ``apps/api/alembic.ini`` exists at the apps/api root (the SINGLE
       alembic config file in the repository — no flat-prefix duplicates).
    2. The config loads via :class:`alembic.config.Config` and the
       ``script_location`` main option equals ``src/api/db/migrations`` —
       the migration boundary lives inside the ``api.db`` package, a sibling
       of the SQLAlchemy import boundary.
    3. ``api.db.migrations.env`` is importable *outside* the alembic runtime
       (the bottom-of-file guard skips migration execution when the
       ``EnvironmentContext`` proxy isn't bound).
    4. ``env.target_metadata`` is a :class:`sqlalchemy.MetaData` instance
       with an empty table registry — Phase 4.1 ships zero application
       tables; Phase 4.2+ migrations will attach declarative models here.

These four assertions together verify that the alembic env wiring is
correctly configured without requiring a live Postgres connection (which
the integration tier exercises separately).
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import MetaData

# The test file lives at apps/api/tests/unit/test_alembic_env.py, so
# `parents[2]` resolves to the apps/api/ root regardless of where pytest is
# invoked from. Anchoring on __file__ keeps the test working under both
# `pytest apps/api/tests` (from repo root) and `pytest tests/unit` (from
# apps/api/).
_APPS_API_ROOT = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH = _APPS_API_ROOT / "alembic.ini"
_EXPECTED_SCRIPT_LOCATION = "src/api/db/migrations"


@pytest.mark.unit
def test_alembic_ini_exists_at_apps_api_root() -> None:
    """The single alembic config file lives at apps/api/alembic.ini."""
    assert _ALEMBIC_INI_PATH.is_file(), (
        f"alembic.ini missing at {_ALEMBIC_INI_PATH}; Phase 4.1 requires the "
        "single alembic config file to live at the apps/api root."
    )


@pytest.mark.unit
def test_alembic_config_loads_with_expected_script_location() -> None:
    """``script_location`` points at the api.db.migrations boundary."""
    cfg = Config(str(_ALEMBIC_INI_PATH))
    script_location = cfg.get_main_option("script_location")
    assert script_location == _EXPECTED_SCRIPT_LOCATION, (
        f"alembic.ini script_location is {script_location!r}; expected "
        f"{_EXPECTED_SCRIPT_LOCATION!r} (the single migration directory "
        "inside the api.db boundary)."
    )


@pytest.mark.unit
def test_alembic_env_module_imports_outside_alembic_runtime() -> None:
    """env.py is import-safe — the runtime guard prevents premature execution."""
    env_module = importlib.import_module("api.db.migrations.env")

    # The three public entry points alembic will reach for at runtime.
    assert hasattr(env_module, "target_metadata"), (
        "env.py must expose target_metadata at module scope so alembic "
        "autogenerate can resolve the declarative registry."
    )
    assert callable(
        getattr(env_module, "run_migrations_offline", None)
    ), "env.py must expose run_migrations_offline() for `alembic ... --sql`."
    assert callable(
        getattr(env_module, "run_migrations_online", None)
    ), "env.py must expose run_migrations_online() for live alembic runs."


@pytest.mark.unit
def test_alembic_env_exposes_events_target_metadata() -> None:
    """target_metadata is a SQLAlchemy MetaData containing the events table.

    Phase 4.1 shipped this assertion as ``len(metadata.tables) == 0``
    (the empty-baseline invariant). Phase 4.2 introduces the first
    declarative model (:class:`api.db.models.event.Event`), so the
    registry must now contain exactly one table named ``events``.

    A later phase that adds a second model (e.g. ``users`` in Phase 4.3)
    will need to update this assertion. The expected-table set is
    therefore captured as a literal here so any drift fails fast with a
    diff-friendly message.
    """
    env_module = importlib.import_module("api.db.migrations.env")
    metadata = env_module.target_metadata

    assert isinstance(
        metadata, MetaData
    ), f"target_metadata must be a sqlalchemy.MetaData; got {type(metadata)!r}."

    # Phase 4.2 registers exactly the ``events`` table on ``Base.metadata``.
    # Asserting the full table-name set (rather than ``"events" in ...``)
    # catches both kinds of drift: a missing model registration AND an
    # unintended Phase 4.3+ table sneaking into Phase 4.2.
    expected_tables = {"events"}
    assert set(metadata.tables) == expected_tables, (
        f"Phase 4.2 target_metadata must contain exactly {expected_tables!r}; "
        f"found {sorted(metadata.tables)!r}. An extra table indicates a "
        "premature Phase 4.3+ model landed here; a missing table indicates "
        "the events model was not imported by api.db.models.__init__."
    )
