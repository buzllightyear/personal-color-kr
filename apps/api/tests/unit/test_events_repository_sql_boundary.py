"""Import-guard test: ``events_repository.py`` is the sole SQL access boundary
for the ``events`` table (Phase 4.4 AC).

Acceptance criterion being verified
-----------------------------------
``apps/api/src/api/db/repositories/events_repository.py`` is the *only*
module under ``apps/api/src/api`` that touches the ``events`` table — i.e. the
only module that imports the :class:`api.db.models.event.Event` ORM class for
read/write, and the only module that issues raw SQL naming the ``events``
table.

Routers (``POST /v1/events``, ``GET /v1/metrics/retention``), schemas,
services, and dependencies must depend on the repository's typed function
surface (``insert_event`` / ``fetch_cohort_user_ids`` /
``fetch_active_user_ids``) instead of building event SQL or importing the ORM
model themselves. This is the "repository_encapsulation" evaluation principle:
a schema change to the ``events`` table has exactly one call site to audit.

Why an AST-based import guard (not a flat grep)?
------------------------------------------------
The ``Event`` symbol legitimately appears in *prose* — docstrings and
comments in ``api.db.models.user`` and ``api.db.models.base`` cross-reference
``api.db.models.event.Event`` to document the declarative-base lineage. A flat
``grep Event`` would false-positive on those references. Parsing each file
with :mod:`ast` and inspecting only ``import`` / ``ImportFrom`` nodes (plus a
narrow raw-SQL textual check) makes the guard precise: it flags a real code
dependency on the ORM model, never a documentation mention.

Allowlist
---------
Three files are permitted to reference the ``Event`` model:

    * ``db/repositories/events_repository.py`` — the boundary itself.
    * ``db/models/event.py``                   — the model *definition*.
    * ``db/models/__init__.py``                — the package re-export
      (``from api.db.models.event import Event``) that keeps Alembic's
      ``target_metadata`` aware of the table.

Any other module that imports the ``Event`` model is a boundary breach and
fails this test with a precise, itemized report.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants — single source of truth for the boundary file, the model module,
# and the allowlist of files permitted to reference the Event ORM model.
# ---------------------------------------------------------------------------

#: Repo-relative (to ``apps/api/src/api``) path of the events repository — the
#: single sanctioned SQL access boundary for the ``events`` table.
EVENTS_REPOSITORY_RELPATH = "db/repositories/events_repository.py"

#: The fully-qualified module that defines the ``Event`` ORM class.
EVENT_MODEL_MODULE = "api.db.models.event"

#: The bare attribute/class name imported from the model module.
EVENT_MODEL_NAME = "Event"

#: Files (relative to ``apps/api/src/api``) allowed to import the ``Event``
#: ORM model. Everything else must go through the repository function surface.
ALLOWED_EVENT_IMPORTERS: frozenset[str] = frozenset(
    {
        EVENTS_REPOSITORY_RELPATH,  # the boundary
        "db/models/event.py",  # the model definition
        "db/models/__init__.py",  # the package re-export for Alembic metadata
    }
)

#: Raw-SQL probe: a ``FROM events`` / ``INTO events`` / ``UPDATE events``
#: textual reference inside a string literal would bypass the ORM boundary.
#: Only the repository may name the table directly. The pattern is
#: word-boundary anchored so identifiers like ``events_repository`` or
#: ``event_name`` do not false-positive.
RAW_EVENTS_TABLE_PATTERN = re.compile(
    r"\b(from|into|update|join)\s+events\b",
    re.IGNORECASE,
)


def _api_src_root() -> Path:
    """Return the absolute path of ``apps/api/src/api``.

    Walks upward from this test file (``apps/api/tests/unit/...``) to the
    ``apps/api`` root, then descends into ``src/api``. Avoids hardcoding
    worktree paths so the test is robust to pytest's invocation directory.
    """
    # __file__ = apps/api/tests/unit/test_events_repository_sql_boundary.py
    #          parents[0] = apps/api/tests/unit
    #          parents[1] = apps/api/tests
    #          parents[2] = apps/api
    api_root = Path(__file__).resolve().parents[2]
    src_root = api_root / "src" / "api"
    assert src_root.is_dir(), (
        f"Expected apps/api/src/api to exist at {src_root!s}; the events "
        f"repository boundary test cannot run without the source tree."
    )
    return src_root


def _imports_event_model(tree: ast.AST) -> bool:
    """Return True iff ``tree`` imports the ``Event`` ORM model.

    Matches two shapes (and nothing in docstrings/comments, because the AST
    has already discarded those):

        from api.db.models.event import Event          # ImportFrom, name match
        from api.db.models.event import Event as E      # ImportFrom, asname
        import api.db.models.event                      # plain Import of module
        from api.db.models import Event                 # re-export import

    A bare ``from api.db.models.event import EVENTS_TABLE_NAME`` (a constant,
    not the model) does NOT count — only the ``Event`` class name triggers a
    match, so importing table-name string constants for a migration stays
    allowed.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module == EVENT_MODEL_MODULE:
                # ``from api.db.models.event import <names>`` — flag only when
                # the ``Event`` class itself is among the imported names.
                if any(alias.name == EVENT_MODEL_NAME for alias in node.names):
                    return True
            elif module == "api.db.models":
                # ``from api.db.models import Event`` — the package re-export.
                if any(alias.name == EVENT_MODEL_NAME for alias in node.names):
                    return True
        elif isinstance(node, ast.Import):
            # ``import api.db.models.event`` — module-level import that exposes
            # ``api.db.models.event.Event`` for use.
            if any(alias.name == EVENT_MODEL_MODULE for alias in node.names):
                return True
    return False


def _string_literals(tree: ast.AST) -> list[str]:
    """Return every string-constant literal in ``tree``.

    Used by the raw-SQL probe. Docstrings are themselves ``ast.Constant``
    string nodes, so the caller must scope the raw-SQL pattern tightly
    (``FROM events`` etc.) to avoid flagging prose that merely mentions the
    table name.
    """
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


def _python_files(src_root: Path) -> list[Path]:
    """Return all ``*.py`` files under ``src_root`` (sorted, deterministic)."""
    return sorted(p for p in src_root.rglob("*.py") if p.is_file())


@pytest.mark.unit
def test_event_model_imported_only_by_repository_and_model_package() -> None:
    """Only the allowlisted files may import the ``Event`` ORM model.

    Every other module under ``apps/api/src/api`` must consume the events
    table through the repository's function surface. A breach (e.g. a router
    doing ``from api.db.models.event import Event`` and building its own
    ``select(Event)``) fails here with an itemized list.
    """
    src_root = _api_src_root()

    breaches: list[str] = []
    for py_file in _python_files(src_root):
        relpath = py_file.relative_to(src_root).as_posix()
        if relpath in ALLOWED_EVENT_IMPORTERS:
            continue
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        if _imports_event_model(tree):
            breaches.append(relpath)

    assert not breaches, (
        "events table SQL-boundary breach: the following module(s) under "
        "apps/api/src/api import the `Event` ORM model directly instead of "
        "going through the events repository "
        f"({EVENTS_REPOSITORY_RELPATH}). Replace the direct ORM use with a "
        "call to insert_event / fetch_cohort_user_ids / "
        "fetch_active_user_ids.\n" + "\n".join(f"  - {relpath}" for relpath in breaches)
    )


@pytest.mark.unit
def test_raw_events_table_sql_only_in_repository() -> None:
    """No module outside the repository may name the ``events`` table in raw SQL.

    Catches the bypass where a contributor avoids the ORM model but still
    reaches the table via a ``text("... FROM events ...")`` string literal.
    The repository is the single sanctioned SQL surface, so any
    ``FROM/INTO/UPDATE/JOIN events`` string literal elsewhere is a breach.
    """
    src_root = _api_src_root()

    breaches: list[str] = []
    for py_file in _python_files(src_root):
        relpath = py_file.relative_to(src_root).as_posix()
        if relpath == EVENTS_REPOSITORY_RELPATH:
            continue
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        for literal in _string_literals(tree):
            if RAW_EVENTS_TABLE_PATTERN.search(literal):
                breaches.append(f"{relpath}: {literal!r}")
                break

    assert not breaches, (
        "events table raw-SQL boundary breach: the following module(s) "
        "reference the `events` table in a SQL string literal outside the "
        f"repository ({EVENTS_REPOSITORY_RELPATH}). Move the query into the "
        "repository's function surface.\n"
        + "\n".join(f"  - {entry}" for entry in breaches)
    )


@pytest.mark.unit
def test_events_repository_is_present_and_imports_the_model() -> None:
    """Sanity check: the boundary file exists and actually imports the model.

    An empty or deleted repository would make the two guards above pass
    vacuously (no breaches because nothing references the model at all). This
    test fails fast if the boundary itself regressed — the repository MUST
    import ``Event`` to be the SQL access surface.
    """
    src_root = _api_src_root()
    repo_path = src_root / EVENTS_REPOSITORY_RELPATH
    assert repo_path.is_file(), (
        f"Expected the events repository at {repo_path!s}; not found. It is "
        f"the single SQL access boundary for the events table and must exist."
    )
    tree = ast.parse(repo_path.read_text(encoding="utf-8"), filename=str(repo_path))
    assert _imports_event_model(tree), (
        "The events repository must import the `Event` ORM model to function "
        "as the SQL access boundary; the expected "
        f"`from {EVENT_MODEL_MODULE} import {EVENT_MODEL_NAME}` import was not "
        "found."
    )
