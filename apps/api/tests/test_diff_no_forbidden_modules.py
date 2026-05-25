"""Diff-invariant test for forbidden out-of-scope module basenames (AC19).

Acceptance criterion (AC19, sub-AC 2) being verified
----------------------------------------------------
A pytest function asserts that::

    git diff --name-only --diff-filter=A main..HEAD

returns **zero** added file paths under ``apps/api/`` whose basename matches
the forbidden out-of-scope regex covering these prefixes with a ``.py``
suffix::

    auth | users | events | magazine | referral | edit | guide |
    curation | wording | cors | rate_limit | sentry

Why a forbidden-basename diff test?
-----------------------------------
The Phase 4.1 Seed explicitly lists the following as **out-of-scope** for
the FastAPI workspace member — every one of them is deferred to a later
Phase 4.x / 5 / 6 / 7 sub-unit:

    * **Apple Sign In auth** → Phase 4.3 (``auth*.py``)
    * **Users / events schema + retention API** → Phase 4.2 / 4.4
      (``users*.py``, ``events*.py``)
    * **Magazine + referral surfaces** → Phase 5 / 4.5
      (``magazine*.py``, ``referral*.py``)
    * **``/v1/edit`` Fal.ai vendor route** → Phase 4.4
      (``edit*.py``)
    * **``/v1/guide`` route** → Phase 4.x (``guide*.py``)
    * **``/v1/curation`` route** → Phase 4.x (``curation*.py``)
    * **``/v1/wording`` route** → Phase 4.x (``wording*.py``)
    * **CORS middleware** → Phase ≥6 (``cors*.py``)
    * **Rate limiting** → Phase ≥6 (``rate_limit*.py``)
    * **Sentry runtime dependency** → Phase ≥7 (``sentry*.py``)

A *new* Python file under ``apps/api/`` whose basename starts with any of
these prefixes is a strong textual signal that a contributor reached past
the Phase 4.1 boundary while implementing the backend surface — typically
by trying to wire one of the deferred routes / middlewares / vendor
integrations into the API before its owning Seed is opened.

This boundary is enforced by a diff-level basename test (not a lint rule)
because:

    1. A new module like ``apps/api/src/api/routers/edit.py`` would pass
       every ruff / mypy / pytest gate while still violating AC19's
       out-of-scope boundary — the FastAPI HTTP layer has no way to know
       the route is forbidden in 4.1 from imports or type signatures
       alone.
    2. The Seed lists this exact ``git diff --name-only --diff-filter=A
       main..HEAD`` command in AC19 (sub-AC 2); mirroring it as a test
       gives the boundary a green/red signal in the same pytest run that
       gates the other 18 acceptance criteria (parity with the apps/mobile
       diff guard in :mod:`test_diff_no_mobile_changes` and the FAL_API_KEY
       absence guard in :mod:`test_fal_api_key_absence`).
    3. ``--diff-filter=A`` restricts the scan to *added* files — modifying
       an existing apps/api file (e.g., adding a comment to ``main.py``)
       is legitimate Phase 4.1 work and must not trip this guard. Only
       brand-new files matching a forbidden prefix represent the scope
       violation we care about.
    4. Phase 4.2+ will land these modules legitimately under their owning
       Seeds. Until those phases are opened, this test fails fast if a
       contributor adds (for example) ``apps/api/src/api/auth.py`` while
       implementing the 4.1 backend surface — the diff stays clean by
       construction.

Implementation notes
--------------------
The test shells out to ``git`` directly (rather than re-implementing the
diff in pure Python) because:

    - AC19 explicitly says to run ``git diff --name-only --diff-filter=A
      main..HEAD`` — matching the seed command verbatim is the contract.
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

The forbidden-prefix regex is anchored to the *basename* (the final path
component) rather than the full path. A file named ``users_router.py``
counts; a file in a directory named ``users/`` whose basename is
``__init__.py`` does NOT — directory-only matches are too coarse and would
generate false positives for legitimate Phase 4.1 utility modules
(consider ``apps/api/src/api/config/env.py`` if someone ever creates a
``corsutil/`` style subdir that happens to share a prefix). The basename
constraint matches the Seed's intent: forbid *new modules* that implement
the deferred surfaces, not any incidental path component.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants — single source of truth for the diff command, scoping prefix,
# and forbidden-basename regex.
# ---------------------------------------------------------------------------

# The exact diff range AC19 (sub-AC 2) specifies. Encoded as a constant so
# the failure message and the subprocess call reference the same string
# (no risk of drift between the assertion text and the command actually
# executed).
DIFF_RANGE = "main..HEAD"

# The ``git diff`` filter flag that restricts the output to *added* files.
# AC19 (sub-AC 2) specifies ``--diff-filter=A``; modifying an existing
# apps/api file is legitimate Phase 4.1 work and must not trip this guard.
DIFF_FILTER_ADDED_ONLY = "--diff-filter=A"

# The path prefix that scopes the AC19 (sub-AC 2) check. Only added files
# whose repo-root-relative path begins with ``apps/api/`` are inspected —
# new files elsewhere in the tree (``packages/core-python``,
# ``apps/mobile`` [guarded separately by :mod:`test_diff_no_mobile_changes`],
# ``docker-compose.yml``, the CI workflow, etc.) are out of scope for this
# specific basename invariant.
SCOPING_PATH_PREFIX = "apps/api/"

# The forbidden module-name prefixes for the apps/api surface. Each entry
# is a Phase ≥4.2 / 5 / 6 / 7 concept whose implementation must NOT land
# inside the apps/api workspace during Phase 4.1. Listed in the same order
# as the Seed text for easy cross-reference.
FORBIDDEN_BASENAME_PREFIXES: tuple[str, ...] = (
    # Phase 4.3 landed `auth` modules (Apple Sign In) legitimately, so the
    # prefix is removed from this gate. The original Phase 4.1 entries for
    # "users" / "events" are retained because Phase 4.2's `event.py` model
    # and Phase 4.3's `user.py` model use singular names that do not match
    # the plural prefixes; a future PR that adds a `routers/users.py` is
    # still gated correctly by the plural prefix here.
    "users",  # Users routers/repositories (Phase 4.4+ if added)
    "events",  # /v1/events endpoint surface (Phase 4.4)
    "magazine",  # Magazine surface (Phase 5)
    "referral",  # Referral wiring (Phase 4.5)
    "edit",  # /v1/edit Fal.ai vendor route (Phase 4.4)
    "guide",  # /v1/guide route (Phase 4.x)
    "curation",  # /v1/curation route (Phase 4.x)
    "wording",  # /v1/wording route (Phase 4.x)
    "cors",  # CORS middleware (Phase ≥6)
    "rate_limit",  # Rate limiting (Phase ≥6)
    "sentry",  # Sentry runtime dep (Phase ≥7)
)

# Compiled forbidden-basename regex. Anchored on both ends:
#   - ``\A`` — match must start at the beginning of the basename (a file
#     called ``handle_authentication.py`` is NOT forbidden because its
#     basename does not *start* with ``auth``).
#   - ``\Z`` — match must end at ``.py``; basenames without the ``.py``
#     suffix (e.g., a ``users`` directory, an ``edit.md`` doc) are not in
#     scope for this Python-module invariant.
# Between the prefix and ``.py`` we allow any characters (``.*``) so that
# variants like ``auth_router.py``, ``users_models.py``, or
# ``sentry_init.py`` are all caught. The ``re.IGNORECASE`` flag mirrors
# the case-insensitive nature of the Seed's prose listing — though all
# legitimate Python module names should already be lowercase, the
# safety-net coverage is cheap.
FORBIDDEN_BASENAME_REGEX = re.compile(
    r"\A(" + "|".join(FORBIDDEN_BASENAME_PREFIXES) + r").*\.py\Z",
    re.IGNORECASE,
)


def _repo_root() -> Path:
    """Return the absolute path of the repository root based on this file's
    location.

    Walks upward from ``apps/api/tests/test_diff_no_forbidden_modules.py``
    to reach the repo root. Avoids hardcoding worktree paths or relying on
    ``os.getcwd`` so the test is robust to ``pytest`` being invoked from
    any directory.
    """
    # __file__ = apps/api/tests/test_diff_no_forbidden_modules.py
    #          parents[0] = apps/api/tests
    #          parents[1] = apps/api
    #          parents[2] = apps
    #          parents[3] = <repo root>
    repo_root = Path(__file__).resolve().parents[3]
    assert (repo_root / ".git").exists() or (repo_root / ".git").is_file(), (
        f"Expected repository root with a .git entry at {repo_root!s}; "
        f"the AC19 forbidden-module diff test cannot run without a git "
        f"checkout."
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
            "AC19 forbidden-module diff test requires `git` on PATH; not "
            "found in current environment. CI always has git available, "
            "so this skip path only fires in minimal local containers."
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

    Equivalent to the AC19 (sub-AC 2) command::

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
def test_no_added_apps_api_files_match_forbidden_basename() -> None:
    """No *added* ``apps/api/`` file's basename may match the forbidden regex.

    Mirrors AC19 (sub-AC 2)'s ``git diff --name-only --diff-filter=A
    main..HEAD`` command. Each added file path that begins with
    ``apps/api/`` is inspected; if its basename matches the forbidden
    regex (any of the deferred-surface prefixes with a ``.py`` suffix),
    the test fails with an itemized report.

    If this test fails, a contributor has added a Python module under
    ``apps/api/`` whose name lays claim to a Phase ≥4.2 / 5 / 6 / 7
    concept (auth, users, events, magazine, referral, edit, guide,
    curation, wording, cors, rate_limit, sentry). The fix is to revert
    the added module and route the work through the appropriate
    later-phase Seed.
    """
    repo_root = _repo_root()
    git = _git_executable()

    if not _main_ref_exists(git, repo_root):
        pytest.skip(
            f"AC19 forbidden-module diff test requires the local `main` "
            f"ref to exist at {repo_root!s}; not found. CI always has "
            f"`main` (the workflow uses `actions/checkout` with full "
            f"history), so this skip path only fires in shallow local "
            f"clones."
        )

    added_files = _diff_added_only(git, repo_root, DIFF_RANGE)

    forbidden_matches: list[str] = []
    for path in added_files:
        if not path.startswith(SCOPING_PATH_PREFIX):
            continue
        # ``path`` is repo-root-relative with forward slashes (git's
        # canonical form on every platform). ``Path(path).name`` extracts
        # the final component without needing platform-specific splitting.
        basename = Path(path).name
        if FORBIDDEN_BASENAME_REGEX.match(basename):
            forbidden_matches.append(path)

    assert not forbidden_matches, (
        f"AC19 (sub-AC 2) violation: `git diff --name-only "
        f"{DIFF_FILTER_ADDED_ONLY} {DIFF_RANGE}` returned "
        f"{len(forbidden_matches)} added file(s) under "
        f"{SCOPING_PATH_PREFIX!r} whose basename matches the forbidden "
        f"out-of-scope regex "
        f"(prefixes: {', '.join(FORBIDDEN_BASENAME_PREFIXES)}; suffix: "
        f"`.py`). These modules belong to Phase ≥4.2 / 5 / 6 / 7 surfaces "
        f"and must not land inside apps/api during Phase 4.1. Revert the "
        f"added file(s) below and route the work through the appropriate "
        f"later-phase Seed.\n" + "\n".join(f"  - {path}" for path in forbidden_matches)
    )
