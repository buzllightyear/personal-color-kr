"""Diff-invariant test for the docker/deploy-file out-of-scope boundary (AC19).

Acceptance criterion (AC19, sub-AC 3) being verified
----------------------------------------------------
A pytest function asserts that::

    git diff --name-only --diff-filter=A main..HEAD

returns **zero** added file paths whose basename matches one of the
deployment-artifact filenames::

    Dockerfile | fly.toml | railway.toml | render.yaml

Why a forbidden-deploy-basename diff test?
------------------------------------------
The Phase 4.1 Seed explicitly lists **production deploy** as out of scope:
the apps/api workspace ships only the local development surface (docker
compose ``postgres:16`` + uvicorn dev command). Every container image
recipe and every PaaS deployment descriptor is deferred to a later phase:

    * ``Dockerfile``    → Phase ≥7 (production container image)
    * ``fly.toml``      → Phase ≥7 (Fly.io deploy descriptor)
    * ``railway.toml``  → Phase ≥7 (Railway deploy descriptor)
    * ``render.yaml``   → Phase ≥7 (Render deploy descriptor)

A *new* file with any of these basenames anywhere in the tree is a strong
textual signal that a contributor reached past the Phase 4.1 boundary by
trying to wire a production container build or PaaS deployment before its
owning Seed is opened.

This boundary is enforced by a diff-level basename test (not a lint rule)
because:

    1. A new ``Dockerfile`` at the repo root or under ``apps/api/`` would
       pass every ruff / mypy / pytest gate while still violating AC19's
       out-of-scope boundary — Python tooling has no opinion about the
       presence of container recipes.
    2. The Seed lists this exact ``git diff --name-only --diff-filter=A
       main..HEAD`` command in AC19 (sub-AC 3); mirroring it as a test
       gives the boundary a green/red signal in the same pytest run that
       gates the other 18 acceptance criteria (parity with the apps/mobile
       diff guard in :mod:`test_diff_no_mobile_changes` and the
       forbidden-module guard in :mod:`test_diff_no_forbidden_modules`).
    3. ``--diff-filter=A`` restricts the scan to *added* files — the test
       fires only on a newly added deployment artifact, never on a
       legitimate edit elsewhere in the tree.
    4. Phase ≥7 will land production containerisation legitimately under
       its owning Seed. Until that phase is opened, this test fails fast
       if a contributor adds (for example) ``Dockerfile`` while
       implementing the 4.1 backend surface — the diff stays clean by
       construction.

Implementation notes
--------------------
The test shells out to ``git`` directly (rather than re-implementing the
diff in pure Python) because:

    - AC19 (sub-AC 3) explicitly says to run ``git diff --name-only
      --diff-filter=A main..HEAD`` — matching the seed command verbatim
      is the contract.
    - ``git`` is the only tool that knows how to resolve the symbolic
      ``main`` ref against the current HEAD across worktrees, fetches, and
      detached states. Re-implementing that logic with ``GitPython`` or
      pure ``pathlib`` would be both more code and less correct.
    - ``--diff-filter=A`` is a ``git``-native flag for "added files only";
      replicating its semantics outside ``git`` would require tracking
      branch-point file inventory by hand.

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

The forbidden-basename match is **exact** (final path component equality)
rather than a prefix or regex match. The Seed lists four specific
filenames — ``Dockerfile``, ``fly.toml``, ``railway.toml``,
``render.yaml`` — and any false-positive from a prefix match would
penalise legitimate Phase 4.1 work (consider a hypothetical
``apps/api/src/api/render_helpers.py``, which is unrelated to the
``render.yaml`` PaaS descriptor). Exact basename equality matches the
Seed's intent: forbid these *specific* deployment artifacts, nothing more.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants — single source of truth for the diff command + forbidden set.
# ---------------------------------------------------------------------------

# The exact diff range AC19 (sub-AC 3) specifies. Encoded as a constant so
# the failure message and the subprocess call reference the same string
# (no risk of drift between the assertion text and the command actually
# executed).
DIFF_RANGE = "main..HEAD"

# The ``git diff`` filter flag that restricts the output to *added* files.
# AC19 (sub-AC 3) specifies ``--diff-filter=A``; modifying an existing
# file is legitimate Phase 4.1 work and must not trip this guard.
DIFF_FILTER_ADDED_ONLY = "--diff-filter=A"

# The set of forbidden basenames. Each entry is a Phase ≥7 deployment
# artifact whose introduction must NOT land during Phase 4.1. Stored as a
# frozenset for O(1) membership checks and to advertise immutability.
FORBIDDEN_BASENAMES: frozenset[str] = frozenset(
    {
        "Dockerfile",  # Production container image recipe (Phase ≥7)
        "fly.toml",  # Fly.io deploy descriptor (Phase ≥7)
        "railway.toml",  # Railway deploy descriptor (Phase ≥7)
        "render.yaml",  # Render deploy descriptor (Phase ≥7)
    }
)


def _repo_root() -> Path:
    """Return the absolute path of the repository root based on this file's
    location.

    Walks upward from ``apps/api/tests/test_diff_no_docker_or_deploy_files.py``
    to reach the repo root. Avoids hardcoding worktree paths or relying on
    ``os.getcwd`` so the test is robust to ``pytest`` being invoked from
    any directory.
    """
    # __file__ = apps/api/tests/test_diff_no_docker_or_deploy_files.py
    #          parents[0] = apps/api/tests
    #          parents[1] = apps/api
    #          parents[2] = apps
    #          parents[3] = <repo root>
    repo_root = Path(__file__).resolve().parents[3]
    assert (repo_root / ".git").exists() or (repo_root / ".git").is_file(), (
        f"Expected repository root with a .git entry at {repo_root!s}; "
        f"the AC19 docker/deploy diff test cannot run without a git checkout."
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
            "AC19 docker/deploy diff test requires `git` on PATH; not found "
            "in current environment. CI always has git available, so this "
            "skip path only fires in minimal local containers."
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


def _diff_added_only(git: str, repo_root: Path, diff_range: str) -> list[str]:
    """Return the list of *added* file paths in ``diff_range``.

    Equivalent to the AC19 (sub-AC 3) command::

        git diff --name-only --diff-filter=A main..HEAD

    Each returned path is repo-root-relative (git's default for
    ``--name-only``) and uses forward slashes on all platforms.

    Fails the test with an informative message if ``git`` exits non-zero —
    a non-zero exit here means the diff range itself is malformed or one
    of the endpoints (``main`` / ``HEAD``) is unresolvable, which is a
    test-environment problem worth surfacing rather than swallowing.
    """
    result = subprocess.run(
        [git, "diff", "--name-only", DIFF_FILTER_ADDED_ONLY, diff_range],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(
            f"`git diff --name-only {DIFF_FILTER_ADDED_ONLY} {diff_range}` "
            f"exited with code {result.returncode} in {repo_root!s}.\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    # ``git diff --name-only`` emits one path per line; split on newline and
    # drop empty entries (trailing newline at end of output).
    return [line for line in result.stdout.splitlines() if line]


@pytest.mark.unit
def test_no_added_docker_or_deploy_files() -> None:
    """No *added* file may have a forbidden docker/deploy basename.

    Mirrors AC19 (sub-AC 3)'s ``git diff --name-only --diff-filter=A
    main..HEAD`` command. Each added file path is inspected; if its
    basename equals any of ``Dockerfile``, ``fly.toml``, ``railway.toml``,
    or ``render.yaml``, the test fails with an itemized report.

    If this test fails, a contributor has added a production-deploy
    artifact (container recipe or PaaS descriptor) while implementing the
    4.1 backend surface. The fix is to revert the added file and route
    production containerisation work through the appropriate later-phase
    Seed (≥Phase 7).
    """
    repo_root = _repo_root()
    git = _git_executable()

    if not _main_ref_exists(git, repo_root):
        pytest.skip(
            f"AC19 docker/deploy diff test requires the local `main` ref "
            f"to exist at {repo_root!s}; not found. CI always has `main` "
            f"(the workflow uses `actions/checkout` with full history), so "
            f"this skip path only fires in shallow local clones."
        )

    added_files = _diff_added_only(git, repo_root, DIFF_RANGE)

    forbidden_matches = [
        path for path in added_files if Path(path).name in FORBIDDEN_BASENAMES
    ]

    assert not forbidden_matches, (
        f"AC19 (sub-AC 3) violation: `git diff --name-only "
        f"{DIFF_FILTER_ADDED_ONLY} {DIFF_RANGE}` returned "
        f"{len(forbidden_matches)} added file(s) whose basename matches "
        f"the forbidden docker/deploy set "
        f"({', '.join(sorted(FORBIDDEN_BASENAMES))}). These artifacts "
        f"belong to Phase ≥7 production-deploy surfaces and must not land "
        f"during Phase 4.1. Revert the added file(s) below and route the "
        f"work through the appropriate later-phase Seed.\n"
        + "\n".join(f"  - {path}" for path in forbidden_matches)
    )
