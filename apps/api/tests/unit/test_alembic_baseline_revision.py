"""Unit tests for the Alembic migration chain (Phase 4.1 + Phase 4.2).

The two assertions in this module verify the structural shape of the
``apps/api/src/api/db/migrations/versions/`` directory without importing
any migration module (which would trigger ``from alembic import op`` and
require an active alembic runtime).

Phase 4.1 (chain root)
----------------------
    1. The baseline migration is the chain root — ``down_revision = None``.

Phase 4.2 (events)
------------------
    2. The events migration chains on the baseline —
       ``down_revision = "phase_4_1_baseline"``.
    3. The versions directory contains exactly two ``.py`` files
       (baseline + events) — no orphan revisions, no ``__init__.py``.

The AST-based approach is deliberate: it avoids importing
alembic-runtime symbols (``op``, ``context``) during a unit-tier test
run and gives us a static, side-effect-free guarantee that the Seed's
chain constraints are honored verbatim in the source files.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

# The test file lives at apps/api/tests/unit/test_alembic_baseline_revision.py,
# so ``parents[2]`` resolves to the ``apps/api/`` root regardless of where
# pytest is invoked from. Anchoring on ``__file__`` keeps the test working
# under both ``pytest apps/api/tests`` (from repo root) and
# ``pytest tests/unit`` (from apps/api/).
_APPS_API_ROOT = Path(__file__).resolve().parents[2]
_VERSIONS_DIR = _APPS_API_ROOT / "src" / "api" / "db" / "migrations" / "versions"

# Pinned filenames for the two Phase 4.x revisions. The deterministic
# alembic file_template (``%(year)d_%(month).2d_%(day).2d_%(hour).2d%(minute).2d-%(rev)s_%(slug)s``)
# makes these names stable across regenerations.
_BASELINE_FILENAME = "2026_01_01_0000-phase_4_1_baseline_phase_4_1_baseline.py"
_EVENTS_FILENAME = "2026_01_02_0000-phase_4_2_events_create_events_table.py"
_USERS_FILENAME = "2026_01_03_0000-phase_4_3_users_create_users_table.py"
_REFERRALS_FILENAME = "2026_01_04_0000-phase_4_5_referrals_add_referral_columns.py"

# Pinned revision identifiers — single source of truth for the chain
# topology. Any test that asserts a specific ``down_revision`` value reads
# from these constants so a rename anywhere in the chain fails fast.
_BASELINE_REVISION_ID = "phase_4_1_baseline"
_EVENTS_REVISION_ID = "phase_4_2_events"
_USERS_REVISION_ID = "phase_4_3_users"
_REFERRALS_REVISION_ID = "phase_4_5_referrals"


def _collect_py_files() -> list[Path]:
    """Return the sorted list of ``.py`` files in the versions directory."""
    return sorted(_VERSIONS_DIR.glob("*.py"))


def _extract_module_constant(
    tree: ast.Module, name: str
) -> tuple[bool, ast.expr | None]:
    """Locate a module-scope assignment named ``name`` in a parsed AST.

    Handles both annotated (``name: Union[str, None] = ...``) and plain
    (``name = ...``) forms.

    Returns
    -------
    tuple[bool, ast.expr | None]
        ``(found, value_node)`` — ``found`` is ``True`` when an
        assignment was located, in which case ``value_node`` is the
        right-hand-side AST expression. When ``found`` is ``False``,
        ``value_node`` is ``None``.
    """
    for node in tree.body:
        if isinstance(node, ast.AnnAssign):
            target = node.target
            if isinstance(target, ast.Name) and target.id == name:
                return True, node.value
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return True, node.value
    return False, None


@pytest.mark.unit
def test_versions_directory_contains_exactly_four_py_files() -> None:
    """The versions/ directory holds exactly four revision files in Phase 4.5.

    Phase 4.1 shipped a single empty baseline migration. Phase 4.2 added
    the events table. Phase 4.3 added the users table + events.user_id FK.
    Phase 4.5 adds the ``users.referrer_user_id`` referral-attribution
    column (Phase 4.4 shipped no DDL). Any fifth file in this directory is
    an orphan revision (regression) and must be removed or rolled into the
    chain explicitly.
    """
    py_files = _collect_py_files()
    actual_names = sorted(p.name for p in py_files)
    expected_names = sorted(
        [_BASELINE_FILENAME, _EVENTS_FILENAME, _USERS_FILENAME, _REFERRALS_FILENAME]
    )
    assert actual_names == expected_names, (
        "Phase 4.5 must ship exactly four migrations: the empty "
        "baseline, the events table, the users table, and the referral "
        "attribution column. Expected files "
        f"{expected_names!r}; found {actual_names!r}. An extra "
        "file indicates an orphan revision; a missing file indicates a "
        "regression in the migration chain."
    )


@pytest.mark.unit
def test_baseline_migration_ast_sets_down_revision_to_none() -> None:
    """The baseline migration's AST assigns ``down_revision = None``.

    This is the chain-root invariant from Phase 4.1: the baseline must
    remain the chain root so Phase 4.2+ revisions can extend the chain
    without re-doing the alembic scaffolding.
    """
    baseline_path = _VERSIONS_DIR / _BASELINE_FILENAME
    assert baseline_path.is_file(), (
        f"Baseline migration must live at {baseline_path}; missing file "
        "indicates a regression."
    )

    tree = ast.parse(baseline_path.read_text(encoding="utf-8"))
    found, value_node = _extract_module_constant(tree, "down_revision")
    assert found, (
        f"Baseline migration {baseline_path.name} must assign "
        "`down_revision` at module scope; no such assignment found."
    )
    assert isinstance(value_node, ast.Constant) and value_node.value is None, (
        f"Baseline migration {baseline_path.name} must set "
        "`down_revision = None` (the chain root); got "
        f"{ast.dump(value_node) if value_node is not None else 'None'!r}."
    )


@pytest.mark.unit
def test_events_migration_chains_on_baseline() -> None:
    """The events migration's AST asserts ``down_revision = "phase_4_1_baseline"``.

    The Phase 4.2 Seed constraint "Must chain on top of
    phase_4_1_baseline alembic revision (down_revision preserved)" is
    encoded here as a static AST check. Any rewrite of the chain
    topology (collapsing the baseline, inserting a sibling migration)
    flips this assertion red before integration tests run.
    """
    events_path = _VERSIONS_DIR / _EVENTS_FILENAME
    assert events_path.is_file(), (
        f"Events migration must live at {events_path}; missing file "
        "indicates the Phase 4.2 migration was not added correctly."
    )

    tree = ast.parse(events_path.read_text(encoding="utf-8"))

    # First, confirm the events migration's own revision id matches the
    # Seed-pinned string.
    rev_found, rev_value = _extract_module_constant(tree, "revision")
    assert rev_found and isinstance(rev_value, ast.Constant), (
        f"Events migration {events_path.name} must assign `revision` to a "
        "string literal at module scope."
    )
    assert rev_value.value == _EVENTS_REVISION_ID, (
        f"Events migration `revision` id must equal "
        f"{_EVENTS_REVISION_ID!r}; got {rev_value.value!r}."
    )

    # Then, confirm the events migration chains on the baseline. The
    # value lives on the right-hand side of a Union[str, None] annotated
    # assignment, so the ast.Constant check is identical to the baseline
    # case.
    down_found, down_value = _extract_module_constant(tree, "down_revision")
    assert down_found and isinstance(down_value, ast.Constant), (
        f"Events migration {events_path.name} must assign `down_revision` "
        "to a string literal at module scope."
    )
    assert down_value.value == _BASELINE_REVISION_ID, (
        f"Events migration `down_revision` must equal "
        f"{_BASELINE_REVISION_ID!r} (preserves the Phase 4.1 chain); "
        f"got {down_value.value!r}."
    )


@pytest.mark.unit
def test_referrals_migration_chains_on_users() -> None:
    """The Phase 4.5 referrals migration chains on ``phase_4_3_users``.

    The Phase 4.5 Seed constraint "Alembic migration chain:
    phase_4_3_users → phase_4_5_referrals" is encoded here as a static AST
    check: the referral-attribution migration's ``revision`` must equal
    ``phase_4_5_referrals`` and its ``down_revision`` must equal
    ``phase_4_3_users`` (Phase 4.4 shipped no DDL, so the users migration
    is the head this revision extends).
    """
    referrals_path = _VERSIONS_DIR / _REFERRALS_FILENAME
    assert referrals_path.is_file(), (
        f"Referrals migration must live at {referrals_path}; missing file "
        "indicates the Phase 4.5 migration was not added correctly."
    )

    tree = ast.parse(referrals_path.read_text(encoding="utf-8"))

    rev_found, rev_value = _extract_module_constant(tree, "revision")
    assert rev_found and isinstance(rev_value, ast.Constant), (
        f"Referrals migration {referrals_path.name} must assign `revision` "
        "to a string literal at module scope."
    )
    assert rev_value.value == _REFERRALS_REVISION_ID, (
        f"Referrals migration `revision` id must equal "
        f"{_REFERRALS_REVISION_ID!r}; got {rev_value.value!r}."
    )

    down_found, down_value = _extract_module_constant(tree, "down_revision")
    assert down_found and isinstance(down_value, ast.Constant), (
        f"Referrals migration {referrals_path.name} must assign "
        "`down_revision` to a string literal at module scope."
    )
    assert down_value.value == _USERS_REVISION_ID, (
        f"Referrals migration `down_revision` must equal "
        f"{_USERS_REVISION_ID!r} (preserves the Phase 4.3 chain); "
        f"got {down_value.value!r}."
    )
