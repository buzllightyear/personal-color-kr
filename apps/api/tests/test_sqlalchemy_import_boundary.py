"""Static-grep boundary test for the single SQLAlchemy import surface (AC11).

Acceptance criterion (AC11) being verified
------------------------------------------
A static-grep test in ``apps/api/tests/`` asserts that::

    grep -rE '^(from|import) sqlalchemy' apps/api/src/api --include='*.py'

returns matches ONLY for files inside ``apps/api/src/api/db/``.

Why a boundary test?
--------------------
The Phase 4.1 Seed pins SQLAlchemy 2.0 + Alembic as the **single import
boundary** inside ``apps/api/src/api/db/`` (engine.py, session.py, health.py,
migrations/env.py). Any ``from sqlalchemy ...`` or ``import sqlalchemy ...``
line that appears anywhere else in ``apps/api/src/api/`` is a boundary breach
— it bleeds ORM concerns into routers, schemas, dependencies, or the FastAPI
application factory and violates the same single-import-boundary discipline
that Phase 3.1 enforced for ``httpx`` (``fal_ai_vendor_caller.py``) and
Phase 3.2 enforced for MediaPipe / Pillow (``face_detector.py`` /
``image_decoder.py``).

This boundary is enforced by a structural test instead of a lint rule because:

    1. Boundary violations are **silent** at lint/type-check time — mypy and
       ruff happily accept ``from sqlalchemy import select`` inside a router.
       Only a structural grep catches the breach.
    2. The Seed lists this exact ``grep -rE ...`` command in AC11; mirroring
       it as a test gives the boundary a green/red signal in the same pytest
       run that gates the other 18 acceptance criteria.
    3. Phase 4.2+ will add real ORM models (users, events). Those models MUST
       land inside ``apps/api/src/api/db/`` — this test fails fast if a
       contributor places them in ``api.schemas.*`` or ``api.routers.*``.

Implementation notes
--------------------
The test is implemented in pure Python (``pathlib`` + ``re``) rather than
shelling out to ``grep``. The behavior is **semantically identical** to the
``grep -rE '^(from|import) sqlalchemy' apps/api/src/api --include='*.py'``
command listed in AC11:

    - Walks every ``*.py`` file under ``apps/api/src/api/``.
    - For each file, matches lines whose first non-empty token is one of:
        ``from sqlalchemy``     (e.g., ``from sqlalchemy import text``)
        ``import sqlalchemy``   (e.g., ``import sqlalchemy as sa``)
      i.e., the regex ``^(from|import) sqlalchemy``.
    - Records the source-relative path of every matching file.
    - Asserts every recorded path lives under ``apps/api/src/api/db/``.

Using pure Python avoids: (a) requiring ``grep`` on the PATH (Windows CI,
minimal containers), (b) shell-quoting / glob-expansion surprises, and (c)
non-zero-exit-when-empty footguns from ``grep``. The single source of truth
for the boundary is encoded in :data:`SQLALCHEMY_IMPORT_PATTERN` and
:data:`DB_BOUNDARY_DIRNAME` below.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants — single source of truth for the boundary regex + boundary path.
# ---------------------------------------------------------------------------

# Mirrors the regex in AC11: ``^(from|import) sqlalchemy``. The pattern matches
# any line whose first token is ``from`` or ``import`` followed by a space and
# the literal package name ``sqlalchemy`` (covering ``sqlalchemy.exc``,
# ``sqlalchemy.ext.asyncio``, ``sqlalchemy.orm``, etc., via the prefix match).
# We do NOT use ``\b`` after ``sqlalchemy`` because the seed's grep does not —
# matching the seed command verbatim is the contract.
SQLALCHEMY_IMPORT_PATTERN = re.compile(r"^(from|import) sqlalchemy", re.MULTILINE)

# Directory name (relative to ``apps/api/src/api/``) that constitutes the
# single SQLAlchemy import boundary. Every matched file MUST sit somewhere
# under this directory.
DB_BOUNDARY_DIRNAME = "db"


def _api_src_root() -> Path:
    """Return the absolute path of ``apps/api/src/api`` based on this file's
    location.

    Walks upward from ``apps/api/tests/test_sqlalchemy_import_boundary.py``
    to reach the repository root (``apps/api/``) and then descends into
    ``src/api``. Avoids hardcoding worktree paths or relying on ``os.getcwd``
    so the test is robust to ``pytest`` being invoked from any directory.
    """
    # __file__ = apps/api/tests/test_sqlalchemy_import_boundary.py
    #          parents[0] = apps/api/tests
    #          parents[1] = apps/api
    api_root = Path(__file__).resolve().parents[1]
    src_root = api_root / "src" / "api"
    assert src_root.is_dir(), (
        f"Expected apps/api/src/api to exist at {src_root!s}; "
        f"the boundary test cannot run without the source tree present."
    )
    return src_root


def _files_with_sqlalchemy_import(src_root: Path) -> list[Path]:
    """Return all ``*.py`` files under ``src_root`` that import sqlalchemy.

    Equivalent to the AC11 grep command, returning *paths only* (mirroring
    ``grep -l`` behavior). The list is sorted for deterministic assertion
    failure messages.
    """
    matches: list[Path] = []
    for py_file in sorted(src_root.rglob("*.py")):
        # ``rglob`` already walks the directory tree; we filter to files only
        # (excludes the unlikely case of a directory named ``foo.py``).
        if not py_file.is_file():
            continue
        # ``read_text`` decodes via UTF-8 by default — matches the standard
        # Python source encoding declared in PEP 3120.
        try:
            content = py_file.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:  # pragma: no cover - defensive only
            pytest.fail(
                f"Could not decode {py_file!s} as UTF-8 while scanning for the "
                f"SQLAlchemy import boundary: {exc!r}"
            )
        if SQLALCHEMY_IMPORT_PATTERN.search(content):
            matches.append(py_file)
    return matches


@pytest.mark.unit
def test_sqlalchemy_imports_live_only_inside_db_boundary() -> None:
    """``from|import sqlalchemy ...`` appears ONLY in files under ``api/db/``.

    Mirrors AC11's ``grep -rE '^(from|import) sqlalchemy' apps/api/src/api
    --include='*.py'`` command. Every match returned by the regex must live
    somewhere under ``apps/api/src/api/db/`` — any other path is a boundary
    violation and fails this test with a precise list of breaching files.
    """
    src_root = _api_src_root()
    boundary_root = src_root / DB_BOUNDARY_DIRNAME

    matched_files = _files_with_sqlalchemy_import(src_root)

    # Partition matches into "inside boundary" vs. "outside boundary" so the
    # failure message names the breaching files (and only those files).
    outside_boundary: list[Path] = [
        path
        for path in matched_files
        # ``Path.is_relative_to`` (3.9+) returns True iff ``path`` lives
        # inside ``boundary_root`` (or equals it). Files outside the boundary
        # are the violations.
        if not path.is_relative_to(boundary_root)
    ]

    assert not outside_boundary, (
        "SQLAlchemy import boundary breach (AC11): the following files import "
        "sqlalchemy but live OUTSIDE apps/api/src/api/db/. Move the import "
        "into apps/api/src/api/db/ (engine.py, session.py, health.py, or "
        "migrations/env.py) and re-export only the dataclass-friendly surface "
        "the breaching module actually needs.\n"
        + "\n".join(f"  - {path.relative_to(src_root)!s}" for path in outside_boundary)
    )


@pytest.mark.unit
def test_sqlalchemy_imports_are_present_inside_db_boundary() -> None:
    """The boundary is non-empty: at least one file under ``api/db/`` imports
    sqlalchemy.

    Phase 4.1 ships ``api.db.health`` which performs ``SELECT 1`` via a
    SQLAlchemy 2.0 async session, so at least that file must import the
    package. An empty boundary would mean either (a) the entire DB layer
    was deleted (regression) or (b) the file walker silently failed — both
    deserve a hard failure here rather than a vacuously-passing AC11.
    """
    src_root = _api_src_root()
    boundary_root = src_root / DB_BOUNDARY_DIRNAME

    matched_files = _files_with_sqlalchemy_import(src_root)
    inside_boundary = [
        path for path in matched_files if path.is_relative_to(boundary_root)
    ]

    assert inside_boundary, (
        "AC11 sanity check failed: no file under apps/api/src/api/db/ imports "
        "sqlalchemy. Either the DB boundary was emptied (regression) or the "
        "file walker is misconfigured. Expected at least api/db/health.py to "
        "import ``sqlalchemy.text`` / ``sqlalchemy.exc.SQLAlchemyError`` / "
        "``sqlalchemy.ext.asyncio.AsyncSession`` for the /v1/db-health route."
    )
