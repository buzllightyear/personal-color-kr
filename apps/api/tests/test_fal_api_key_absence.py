"""Static-grep absence test for ``FAL_API_KEY`` in apps/api source (AC12).

Acceptance criterion (AC12) being verified
------------------------------------------
A static-grep test asserts that::

    grep -r 'FAL_API_KEY' apps/api/src --include='*.py'

returns **zero** matches.

Why an absence test?
--------------------
The Phase 4.1 Seed pins the Fal.ai vendor surface (and therefore the
``FAL_API_KEY`` environment variable) as **out of scope** for the FastAPI
workspace member. The vendor-driven ``/v1/edit`` endpoint is explicitly
deferred to Phase 4.4 (or a later sub-phase of 4.x), and Phase 3.1 already
owns the single ``httpx`` import boundary inside
``packages/core-python/src/personal_color/fal_ai_vendor_caller.py``.

A grep-style absence test enforces a structural invariant that lint /
type-check tools cannot catch:

    1. ``os.environ["FAL_API_KEY"]``, ``os.getenv("FAL_API_KEY")``, and
       ``settings.FAL_API_KEY`` all look perfectly valid to mypy and ruff.
       Only a textual scan can prove the symbol is absent from the
       apps/api HTTP layer.
    2. The Seed lists this exact ``grep -r 'FAL_API_KEY' apps/api/src
       --include='*.py'`` command in AC12; mirroring it as a test gives the
       boundary a green/red signal in the same pytest run that gates the
       other 18 acceptance criteria (parity with AC11's import-boundary
       test).
    3. Phase 4.4+ will add the ``/v1/edit`` route. This test fails fast if a
       contributor reaches for ``FAL_API_KEY`` inside apps/api/src/ before
       that phase is opened — the vendor key must be consumed only via the
       Phase 3.1 vendor-caller surface (``core-python``), never directly
       inside the FastAPI HTTP layer.

Implementation notes
--------------------
The test is implemented in pure Python (``pathlib`` + ``re``) rather than
shelling out to ``grep``. The behavior is **semantically identical** to the
``grep -r 'FAL_API_KEY' apps/api/src --include='*.py'`` command listed in
AC12:

    - Walks every ``*.py`` file under ``apps/api/src/``.
    - For each file, searches for the literal substring ``FAL_API_KEY``
      (case-sensitive, anywhere in the line — exactly what ``grep`` does
      with a fixed-string pattern containing only uppercase letters and
      underscores).
    - Records the source-relative path of every matching file.
    - Asserts the match list is empty.

Using pure Python avoids: (a) requiring ``grep`` on the PATH (Windows CI,
minimal containers), (b) shell-quoting / glob-expansion surprises, and (c)
non-zero-exit-when-empty footguns from ``grep``. The single source of truth
for the absence invariant is encoded in :data:`FORBIDDEN_TOKEN` and
:data:`SCAN_ROOT_RELATIVE` below.

Note on scope: this test scans ``apps/api/src/`` (the entire source tree of
the workspace member), not just ``apps/api/src/api/``. That matches the
``apps/api/src --include='*.py'`` argument in AC12 verbatim — if a
contributor adds a sibling package under ``apps/api/src/`` in a future
phase, the absence invariant still applies.
"""

from __future__ import annotations

from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants — single source of truth for the forbidden token + scan root.
# ---------------------------------------------------------------------------

# The exact uppercase environment-variable name that AC12 forbids inside
# apps/api/src/. Stored as a single module-level constant so the failure
# message and the search both reference the same identifier (no risk of
# drift between the assertion text and the regex).
FORBIDDEN_TOKEN = "FAL_API_KEY"

# Path of the scan root *relative to* the apps/api workspace root
# (``Path(__file__).resolve().parents[1]``). AC12 specifies ``apps/api/src``
# explicitly — broader than AC11's ``apps/api/src/api`` because the Fal.ai
# vendor key must remain absent from any sibling package that future phases
# might place under ``apps/api/src/``.
SCAN_ROOT_RELATIVE = "src"


def _apps_api_root() -> Path:
    """Return the absolute path of ``apps/api`` based on this file's location.

    Walks upward from ``apps/api/tests/test_fal_api_key_absence.py`` to
    reach the workspace root (``apps/api``). Avoids hardcoding worktree
    paths or relying on ``os.getcwd`` so the test is robust to ``pytest``
    being invoked from any directory.
    """
    # __file__ = apps/api/tests/test_fal_api_key_absence.py
    #          parents[0] = apps/api/tests
    #          parents[1] = apps/api
    api_root = Path(__file__).resolve().parents[1]
    assert api_root.is_dir(), (
        f"Expected apps/api workspace root to exist at {api_root!s}; "
        f"the FAL_API_KEY absence test cannot run without it."
    )
    return api_root


def _scan_root() -> Path:
    """Return the absolute path of the directory AC12 scans (``apps/api/src``).

    The scan root must exist before this test can produce a meaningful
    signal: an empty / missing source tree would let the absence assertion
    pass vacuously (Phase 4.2+ regressions could then silently slip in a
    ``FAL_API_KEY`` reference without ever triggering the test).
    """
    scan_root = _apps_api_root() / SCAN_ROOT_RELATIVE
    assert scan_root.is_dir(), (
        f"Expected scan root to exist at {scan_root!s}; the AC12 absence "
        f"test cannot prove FAL_API_KEY is missing from an empty / missing "
        f"source tree."
    )
    return scan_root


def _files_containing_token(scan_root: Path, token: str) -> list[Path]:
    """Return all ``*.py`` files under ``scan_root`` that contain ``token``.

    Equivalent to the AC12 grep command, returning *paths only* (mirroring
    ``grep -l`` behavior). The token is matched as a literal case-sensitive
    substring — identical to ``grep`` with a fixed-string pattern that
    contains only uppercase ASCII letters and underscores. The list is
    sorted for deterministic assertion failure messages.
    """
    matches: list[Path] = []
    for py_file in sorted(scan_root.rglob("*.py")):
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
                f"Could not decode {py_file!s} as UTF-8 while scanning for "
                f"the FAL_API_KEY absence invariant: {exc!r}"
            )
        if token in content:
            matches.append(py_file)
    return matches


@pytest.mark.unit
def test_fal_api_key_is_absent_from_apps_api_src() -> None:
    """``FAL_API_KEY`` MUST NOT appear in any ``*.py`` file under apps/api/src.

    Mirrors AC12's ``grep -r 'FAL_API_KEY' apps/api/src --include='*.py'``
    command. The grep must return zero matches: the Fal.ai vendor key is
    consumed exclusively through Phase 3.1's
    ``packages/core-python/src/personal_color/fal_ai_vendor_caller.py``
    surface (the single ``httpx`` import boundary), and the FastAPI HTTP
    layer in apps/api/ has no business referencing it in Phase 4.1.

    If this test fails, a contributor has reached for ``FAL_API_KEY``
    inside the apps/api workspace — most likely while attempting to wire
    up ``/v1/edit`` before its phase (≥4.4) is opened. The fix is to
    revert the addition and route any vendor access through the
    ``core-python`` editable dependency instead.
    """
    scan_root = _scan_root()

    matched_files = _files_containing_token(scan_root, FORBIDDEN_TOKEN)

    assert not matched_files, (
        f"AC12 violation: the symbol {FORBIDDEN_TOKEN!r} appears in the "
        f"following apps/api/src/ files but MUST be absent in Phase 4.1. "
        f"Route any Fal.ai vendor access through "
        f"`packages/core-python/src/personal_color/fal_ai_vendor_caller.py` "
        f"(the single httpx boundary) instead of consuming the key directly "
        f"inside the FastAPI HTTP layer.\n"
        + "\n".join(
            f"  - {path.relative_to(_apps_api_root())!s}" for path in matched_files
        )
    )


@pytest.mark.unit
def test_fal_api_key_absence_scanner_walks_a_nonempty_tree() -> None:
    """The AC12 scanner is non-vacuous: at least one ``*.py`` file is scanned.

    An empty / missing source tree would let
    :func:`test_fal_api_key_is_absent_from_apps_api_src` pass vacuously
    (a regression that deletes the entire ``apps/api/src/`` tree would
    silently turn AC12 green). This sanity check ensures the scanner has
    real files to look at, so the absence assertion above carries weight.
    """
    scan_root = _scan_root()

    scanned_files = [
        py_file for py_file in scan_root.rglob("*.py") if py_file.is_file()
    ]

    assert scanned_files, (
        f"AC12 sanity check failed: no *.py files found under {scan_root!s}. "
        f"Either the apps/api source tree was deleted (regression) or the "
        f"file walker is misconfigured. Expected at least api/main.py to "
        f"be present so the absence test for {FORBIDDEN_TOKEN!r} carries "
        f"weight."
    )
