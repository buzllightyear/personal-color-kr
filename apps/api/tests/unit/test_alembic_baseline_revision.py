"""Unit test for the Phase 4.1 baseline Alembic migration (Sub-AC 2).

Verifies two invariants of the migration chain root via :mod:`pathlib` +
:mod:`ast` — without importing the migration module itself (which would
trigger ``from alembic import op`` and require an active alembic runtime):

    1. ``apps/api/src/api/db/migrations/versions/`` contains EXACTLY one
       ``.py`` file (the baseline migration; no ``__init__.py``, no other
       revisions in Phase 4.1).
    2. That file's parsed AST assigns ``down_revision = None`` at module
       scope, making it the chain root that Phase 4.2+ migrations extend.

The AST-based approach is deliberate: it avoids importing alembic-runtime
symbols (``op``, ``context``) during a unit-tier test run and gives us a
static, side-effect-free guarantee that the seed's "down_revision = None"
constraint is honored verbatim in the source file.
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


def _collect_py_files() -> list[Path]:
    """Return the sorted list of ``.py`` files in the versions directory."""
    return sorted(_VERSIONS_DIR.glob("*.py"))


def _extract_down_revision_value(tree: ast.Module) -> tuple[bool, ast.expr | None]:
    """Locate the module-scope ``down_revision`` assignment in a parsed AST.

    Handles both annotated (``down_revision: Union[str, None] = None``) and
    plain (``down_revision = None``) forms.

    Returns
    -------
    tuple[bool, ast.expr | None]
        ``(found, value_node)`` — ``found`` is ``True`` when an assignment
        was located, in which case ``value_node`` is the right-hand-side AST
        expression. When ``found`` is ``False``, ``value_node`` is ``None``.
    """
    for node in tree.body:
        if isinstance(node, ast.AnnAssign):
            target = node.target
            if isinstance(target, ast.Name) and target.id == "down_revision":
                return True, node.value
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "down_revision":
                    return True, node.value
    return False, None


@pytest.mark.unit
def test_versions_directory_contains_exactly_one_py_file() -> None:
    """The versions/ directory holds exactly one revision file in Phase 4.1."""
    py_files = _collect_py_files()
    assert len(py_files) == 1, (
        "Phase 4.1 baseline must be the only migration: expected exactly "
        f"one .py file under {_VERSIONS_DIR}; found {len(py_files)}: "
        f"{[p.name for p in py_files]}."
    )


@pytest.mark.unit
def test_baseline_migration_ast_sets_down_revision_to_none() -> None:
    """The baseline migration's AST assigns ``down_revision = None``."""
    py_files = _collect_py_files()
    assert len(py_files) == 1, (
        "Cannot inspect baseline AST: expected exactly one .py file under "
        f"{_VERSIONS_DIR}; found {len(py_files)}: "
        f"{[p.name for p in py_files]}."
    )

    baseline_path = py_files[0]
    tree = ast.parse(baseline_path.read_text(encoding="utf-8"))

    found, value_node = _extract_down_revision_value(tree)
    assert found, (
        f"Baseline migration {baseline_path.name} must assign "
        "`down_revision` at module scope; no such assignment found."
    )
    assert isinstance(value_node, ast.Constant) and value_node.value is None, (
        f"Baseline migration {baseline_path.name} must set "
        "`down_revision = None` (the chain root); got "
        f"{ast.dump(value_node) if value_node is not None else 'None'!r}."
    )
