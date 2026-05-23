"""Diff-invariant test for the apps/mobile out-of-scope boundary (AC19).

Acceptance criterion (AC19) being verified
------------------------------------------
A pytest function asserts that::

    git diff --name-only main..HEAD

returns **zero** entries whose path begins with ``apps/mobile/``.

Why a diff-invariant test?
--------------------------
The Phase 4.1 Seed pins ``apps/mobile/*`` as **out of scope**: the mobile
client's ``useDummy<DiagnosisView>`` hook stays exactly where Phase 3.3 left
it, and the eventual ``useDummy → useApi`` swap is deferred to a later phase
(≥4.3, after Apple Sign In auth lands). Phase 4.1 must NOT modify any file
under ``apps/mobile/`` — the entire 4.1 surface lives under ``apps/api/``,
the repo-root ``docker-compose.yml``, the root ``.env.example`` extension,
and the ``.github/workflows/ci.yml`` extension.

This boundary is enforced by a diff-level structural test instead of a lint
rule because:

    1. Mobile drift is **silent** at lint/type-check time — a stray edit to
       ``apps/mobile/src/hooks/use-diagnosis-content.ts`` would pass every
       TypeScript / ESLint / vitest gate while still violating the Seed's
       out-of-scope boundary.
    2. The Seed lists this exact ``git diff --name-only main..HEAD`` command
       in AC19; mirroring it as a test gives the boundary a green/red
       signal in the same pytest run that gates the other 18 acceptance
       criteria (parity with AC11 / AC12 boundary tests).
    3. Phase 4.3+ will land the mobile ``useApi`` swap legitimately. Until
       that phase is opened, this test fails fast if a contributor reaches
       into ``apps/mobile/`` while implementing the 4.1 backend surface —
       the diff stays clean by construction.

Implementation notes
--------------------
The test shells out to ``git`` directly (rather than re-implementing the
diff in pure Python) because:

    - AC19 explicitly says "shells out to ``git diff --name-only
      main..HEAD``" — matching the seed command verbatim is the contract.
    - ``git`` is the only tool that knows how to resolve the symbolic
      ``main`` ref against the current HEAD across worktrees, fetches, and
      detached states. Re-implementing that logic with ``GitPython`` or
      pure ``pathlib`` would be both more code and less correct.

The shell-out uses ``subprocess.run(..., check=False, capture_output=True,
text=True)`` so the test surfaces an informative ``pytest.fail`` message
instead of a raw ``CalledProcessError`` traceback when ``git`` errors. The
``cwd`` is set to the repository root (resolved from this file's location
via ``parents[3]``) so the test is robust to ``pytest`` being invoked from
any directory.

If the ``main`` ref does not exist locally (e.g., a contributor cloned a
shallow checkout without ``main``), the test ``pytest.skip``s with a clear
explanation. CI always has ``main`` available — ``actions/checkout`` plus
the ``fetch-depth: 0`` pattern used by the repo's existing workflow
guarantees it — so the skip path only fires in local exploratory checkouts
and never in the gating CI run.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants — single source of truth for the diff command + forbidden prefix.
# ---------------------------------------------------------------------------

# The exact diff range AC19 specifies. Encoded as a constant so the failure
# message and the subprocess call reference the same string (no risk of
# drift between the assertion text and the command actually executed).
DIFF_RANGE = "main..HEAD"

# The path prefix that AC19 forbids in the diff. Phase 4.1 must NOT modify
# any file under ``apps/mobile/`` — the mobile client's ``useDummy`` hooks
# remain frozen until Phase 4.3+ swaps them for ``useApi``.
FORBIDDEN_PATH_PREFIX = "apps/mobile/"


def _repo_root() -> Path:
    """Return the absolute path of the repository root based on this file's
    location.

    Walks upward from ``apps/api/tests/test_diff_no_mobile_changes.py`` to
    reach the repo root. Avoids hardcoding worktree paths or relying on
    ``os.getcwd`` so the test is robust to ``pytest`` being invoked from
    any directory.
    """
    # __file__ = apps/api/tests/test_diff_no_mobile_changes.py
    #          parents[0] = apps/api/tests
    #          parents[1] = apps/api
    #          parents[2] = apps
    #          parents[3] = <repo root>
    repo_root = Path(__file__).resolve().parents[3]
    assert (repo_root / ".git").exists() or (repo_root / ".git").is_file(), (
        f"Expected repository root with a .git entry at {repo_root!s}; "
        f"the AC19 diff-invariant test cannot run without a git checkout."
    )
    return repo_root


def _git_executable() -> str:
    """Return the absolute path to the ``git`` executable.

    Resolved via :func:`shutil.which` so the test fails loudly with a clear
    message when ``git`` is missing from ``PATH`` (rather than dying with a
    cryptic ``FileNotFoundError`` from ``subprocess.run``).
    """
    git_path = shutil.which("git")
    if git_path is None:  # pragma: no cover - defensive only
        pytest.skip(
            "AC19 diff test requires `git` on PATH; not found in current "
            "environment. CI always has git available, so this skip path "
            "only fires in minimal local containers."
        )
    return git_path


def _main_ref_exists(git: str, repo_root: Path) -> bool:
    """Return True iff the symbolic ``main`` ref resolves to a commit.

    Uses ``git rev-parse --verify --quiet main`` which exits 0 iff the ref
    is valid. We do NOT use ``git show-ref`` here because ``rev-parse`` is
    the canonical "does this ref exist" probe and works identically for
    local branches, remote-tracking branches, and tags.
    """
    result = subprocess.run(
        [git, "rev-parse", "--verify", "--quiet", "main"],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def _diff_name_only(git: str, repo_root: Path, diff_range: str) -> list[str]:
    """Return the list of file paths changed in ``diff_range``.

    Equivalent to the AC19 command ``git diff --name-only main..HEAD``.
    Each returned path is repo-root-relative (git's default for
    ``--name-only``) and uses forward slashes on all platforms.

    Fails the test with an informative message if ``git`` exits non-zero —
    a non-zero exit here means the diff range itself is malformed or one
    of the endpoints (``main`` / ``HEAD``) is unresolvable, which is a
    test-environment problem worth surfacing rather than swallowing.
    """
    result = subprocess.run(
        [git, "diff", "--name-only", diff_range],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(
            f"`git diff --name-only {diff_range}` exited with code "
            f"{result.returncode} in {repo_root!s}.\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    # ``git diff --name-only`` emits one path per line; split on newline and
    # drop empty entries (trailing newline at end of output).
    return [line for line in result.stdout.splitlines() if line]


@pytest.mark.unit
def test_diff_contains_no_apps_mobile_changes() -> None:
    """``apps/mobile/`` MUST NOT appear in ``git diff --name-only main..HEAD``.

    Mirrors AC19's ``git diff --name-only main..HEAD`` command. Every line
    of the diff output must NOT start with ``apps/mobile/`` — the Phase 4.1
    backend surface is strictly disjoint from the mobile client, whose
    ``useDummy<DiagnosisView>`` hook stays frozen until Phase 4.3+ swaps
    it for ``useApi``.

    If this test fails, a contributor has modified a file under
    ``apps/mobile/`` while implementing the 4.1 backend surface. The fix
    is to revert the mobile edit and route any client-side change through
    the appropriate later-phase Seed (≥4.3 for auth-gated useApi swap,
    ≥4.4 for /v1/edit wiring, etc.).
    """
    repo_root = _repo_root()
    git = _git_executable()

    if not _main_ref_exists(git, repo_root):
        pytest.skip(
            f"AC19 diff test requires the local `main` ref to exist at "
            f"{repo_root!s}; not found. CI always has `main` (the workflow "
            f"uses `actions/checkout` with full history), so this skip path "
            f"only fires in shallow local clones."
        )

    changed_files = _diff_name_only(git, repo_root, DIFF_RANGE)

    mobile_changes = [
        path for path in changed_files if path.startswith(FORBIDDEN_PATH_PREFIX)
    ]

    assert not mobile_changes, (
        f"AC19 violation: `git diff --name-only {DIFF_RANGE}` returned "
        f"{len(mobile_changes)} path(s) under {FORBIDDEN_PATH_PREFIX!r} but "
        f"Phase 4.1 must NOT modify any file under apps/mobile/. The mobile "
        f"client's useDummy hooks stay frozen until Phase 4.3+ swaps them "
        f"for useApi. Revert the mobile edit(s) below and route any client "
        f"change through the appropriate later-phase Seed.\n"
        + "\n".join(f"  - {path}" for path in mobile_changes)
    )
