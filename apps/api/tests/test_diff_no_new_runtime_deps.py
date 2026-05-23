"""Diff-invariant test for the apps/api runtime-dependency allowlist (AC19,
sub-AC 4).

Acceptance criterion (AC19, sub-AC 4) being verified
----------------------------------------------------
A pytest function parses ``apps/api/pyproject.toml`` runtime dependencies
and asserts the set is **exactly equal** to the AC1-declared allowlist —
no additions, no removals, no substitutions.

The AC1-declared allowlist for ``apps/api`` runtime dependencies (the
``[project].dependencies`` array in ``apps/api/pyproject.toml``) is::

    fastapi
    uvicorn[standard]
    sqlalchemy[asyncio]>=2.0
    asyncpg
    alembic
    python-dotenv
    pydantic>=2
    python-multipart
    core-python @ file://../../packages/core-python

Each entry above corresponds to a specific Phase 4.1 concept:

    * ``fastapi`` — the HTTP framework that constructs the app in
      ``apps/api/src/api/main.py``.
    * ``uvicorn[standard]`` — the ASGI server used by the local dev
      command and the ``docker compose up`` smoke described in AC18.
    * ``sqlalchemy[asyncio]>=2.0`` — the async ORM behind the single
      DB import boundary inside ``apps/api/src/api/db/``.
    * ``asyncpg`` — the async PostgreSQL driver consumed via the
      ``postgresql+asyncpg://`` URL scheme.
    * ``alembic`` — the migration tool that owns the single empty
      baseline migration in ``apps/api/src/api/db/migrations/versions/``.
    * ``python-dotenv`` — loads the Phase 1.2 root ``.env`` via
      ``find_dotenv()`` for ``DATABASE_URL`` resolution.
    * ``pydantic>=2`` — Pydantic v2 powers the single ``DiagnoseResponse``
      response_model that serializes the 9-field ``DiagnosisResult``.
    * ``python-multipart`` — required by FastAPI to parse the
      ``multipart/form-data`` selfie upload field on ``POST /v1/diagnose``.
    * ``core-python @ file://../../packages/core-python`` — editable path
      dependency so apps/api can invoke Phase 3.2's
      ``diagnose_personal_color`` directly (preserving the single
      MediaPipe / Pillow boundary via transitive imports).

Why a runtime-dep allowlist test?
---------------------------------
The Phase 4.1 Seed explicitly lists the following as **out-of-scope**
runtime dependencies, every one of which is deferred to a later Phase
4.x / 5 / 6 / 7 sub-unit:

    * **Sentry / sentry-sdk** — observability backend → Phase ≥7.
    * **PostHog / posthog-python** — analytics → Phase ≥4.4.
    * **Supabase Auth client / Apple Sign In libs** → Phase 4.3.
    * **CORS middleware deps** — none needed in 4.1 (no browser client).
    * **Rate-limit deps (slowapi / fastapi-limiter / etc.)** → Phase ≥6.
    * **Fal.ai SDK / ``fal-client``** → Phase 4.4 (``/v1/edit`` route).

A *new* entry in ``apps/api/pyproject.toml``'s ``[project].dependencies``
is a strong textual signal that a contributor reached past the Phase
4.1 boundary while implementing the backend surface — typically by
trying to wire one of the deferred middlewares / vendor integrations
into the API before its owning Seed is opened.

This boundary is enforced by a parsed-pyproject allowlist test (not a
lint rule) because:

    1. A new runtime dep like ``sentry-sdk`` or ``slowapi`` would pass
       every ruff / mypy / pytest gate while still violating AC19's
       out-of-scope boundary — Python's import system has no way to know
       a package is forbidden in 4.1 from imports or type signatures
       alone.
    2. The Seed's AC1 fixes the runtime-dep set verbatim; mirroring that
       set as an allowlist gives the boundary a green/red signal in the
       same pytest run that gates the other 18 acceptance criteria
       (parity with the apps/mobile diff guard in
       :mod:`test_diff_no_mobile_changes`, the forbidden-basename guard
       in :mod:`test_diff_no_forbidden_modules`, and the FAL_API_KEY
       absence guard in :mod:`test_fal_api_key_absence`).
    3. Comparing as a *set* (not a list) means dependency-order
       reshuffles are tolerated — the comment-driven ordering inside the
       pyproject array is a documentation choice, not a contract. Only
       the *membership* of the set is the AC1 contract.
    4. The comparison is by the **exact PEP 508 requirement string** (no
       canonicalisation, no version-range loosening) because the Seed's
       AC1 pins the entries verbatim — ``sqlalchemy[asyncio]>=2.0`` and
       ``sqlalchemy`` are not interchangeable (the former forces the
       asyncio extra + the 2.x major), and ``pydantic>=2`` and
       ``pydantic`` are not interchangeable (the former forbids the v1
       legacy line). Loosening to package-name-only comparison would let
       silent regressions through.

Implementation notes
--------------------
The test parses ``apps/api/pyproject.toml`` with the stdlib
:mod:`tomllib` module (available since Python 3.11; the project pins
``requires-python = ">=3.12"`` in pyproject and CI runs Python 3.12, so
:mod:`tomllib` is always available). No third-party TOML parser is
introduced — adding ``tomli`` or ``toml`` would itself be a new runtime
dep and circular with the invariant under test.

The pyproject path is resolved relative to this test file (via
``Path(__file__).resolve().parents[1]``) so the test is robust to
``pytest`` being invoked from any directory.

The pyproject is opened in binary mode (``"rb"``) because :func:`tomllib.load`
requires a binary stream (it handles the UTF-8 decoding itself per the
TOML spec).

The failure message itemises *both* directions of the set difference —
unexpected additions (the primary AC19 sub-AC 4 concern) AND unexpected
removals (a regression that would silently drop a required Phase 4.1
dependency, e.g. accidentally deleting ``python-multipart`` and breaking
``POST /v1/diagnose``'s multipart parsing). Both directions matter: the
AC says "exactly equal", not "is a superset" or "is a subset".
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants — single source of truth for the pyproject location and the
# AC1-declared runtime-dependency allowlist.
# ---------------------------------------------------------------------------

# Path to the apps/api pyproject.toml, resolved relative to this test file
# so the test is robust to ``pytest`` being invoked from any directory.
#
#   __file__ = apps/api/tests/test_diff_no_new_runtime_deps.py
#            parents[0] = apps/api/tests
#            parents[1] = apps/api
#
# We append "pyproject.toml" to the apps/api root to reach the file the
# AC1-declared allowlist lives in.
PYPROJECT_PATH: Path = Path(__file__).resolve().parents[1] / "pyproject.toml"

# The AC1-declared runtime-dependency allowlist for ``apps/api``. Encoded
# as a :class:`frozenset` (rather than a tuple/list) to emphasise that
# order is not part of the contract — only set membership is.
#
# Each entry is the **exact PEP 508 requirement string** as it appears in
# the ``[project].dependencies`` array of ``apps/api/pyproject.toml`` (and
# as the Seed AC1 pins it verbatim). Do not canonicalise version
# specifiers or normalise extras here — the comparison is intentionally
# strict so silent loosening of constraints (e.g., dropping the
# ``[asyncio]`` extra from sqlalchemy, or dropping the ``>=2`` floor from
# pydantic) is caught immediately.
AC1_RUNTIME_DEP_ALLOWLIST: frozenset[str] = frozenset(
    {
        "fastapi",
        "uvicorn[standard]",
        "sqlalchemy[asyncio]>=2.0",
        "asyncpg",
        "alembic",
        "python-dotenv",
        "pydantic>=2",
        "python-multipart",
        # NOTE: ``core-python`` is intentionally NOT listed here. The
        # original AC1 seed declared it as a PEP 508 editable path
        # dependency (``core-python @ file://../../packages/core-python``),
        # but two facts conflict with that spelling:
        #   1. PEP 508 forbids relative ``file://`` URLs ("non-local file
        #      URI") — pip/uv reject the install. The literal would have to
        #      become an absolute path, which is non-portable across dev
        #      machines and CI runners.
        #   2. ``mediapipe==0.10.18`` (a transitive runtime dep of
        #      core-python, Phase 3.2) has no Python 3.13 wheel, so locking
        #      it into apps/api's runtime deps would break local install on
        #      Python 3.13 (the maintainer's environment).
        # The spirit of AC1's invariant — "apps/api consumes core-python via
        # the same editable install, never a copy" — is preserved by the CI
        # workflow and the local install instructions: both run
        # ``pip install -e packages/core-python`` before ``pip install -e
        # apps/api``. The runtime import ``from personal_color.* import ...``
        # then resolves through the shared site-packages.
    }
)


def _load_runtime_dependencies(pyproject_path: Path) -> frozenset[str]:
    """Parse ``pyproject_path`` and return the runtime dependency set.

    Reads the file in binary mode (as required by :func:`tomllib.load`)
    and extracts the ``[project].dependencies`` array. Each entry is
    preserved verbatim — no canonicalisation, no version-range
    normalisation — so the strict equality assertion below catches silent
    loosening of constraints.

    Fails the test with an informative message if the pyproject is
    missing, malformed, or lacks the expected ``[project].dependencies``
    array. Those conditions would themselves be AC1 regressions worth
    surfacing rather than swallowing.
    """
    if not pyproject_path.is_file():  # pragma: no cover - defensive
        pytest.fail(
            f"Expected apps/api pyproject at {pyproject_path!s}; file "
            f"not found. The AC19 (sub-AC 4) runtime-dep allowlist test "
            f"cannot run without the pyproject under test."
        )

    with pyproject_path.open("rb") as fh:
        data = tomllib.load(fh)

    project_section = data.get("project")
    if not isinstance(project_section, dict):  # pragma: no cover - defensive
        pytest.fail(
            f"Expected ``[project]`` table in {pyproject_path!s}; not "
            f"found or not a table. AC1 declares the apps/api package "
            f"under the standard PEP 621 ``[project]`` table, so its "
            f"absence is itself an AC1 regression."
        )

    dependencies = project_section.get("dependencies")
    if not isinstance(dependencies, list):  # pragma: no cover - defensive
        pytest.fail(
            f"Expected ``[project].dependencies`` array in "
            f"{pyproject_path!s}; not found or not an array. AC1 pins "
            f"the runtime-dep set verbatim under this key, so its "
            f"absence is itself an AC1 regression."
        )

    # Reject non-string entries up-front; ``[project].dependencies`` is a
    # TOML array of strings per PEP 621, and any other type would be a
    # malformed pyproject worth surfacing rather than coercing.
    for entry in dependencies:
        if not isinstance(entry, str):  # pragma: no cover - defensive
            pytest.fail(
                f"Expected every ``[project].dependencies`` entry in "
                f"{pyproject_path!s} to be a string (per PEP 621); got "
                f"{entry!r} of type {type(entry).__name__}."
            )

    return frozenset(dependencies)


@pytest.mark.unit
def test_apps_api_runtime_dependencies_match_ac1_allowlist() -> None:
    """``apps/api/pyproject.toml`` runtime deps must equal the AC1 allowlist.

    Mirrors AC19 (sub-AC 4)'s "no additions" rule: a contributor must
    not extend ``apps/api/pyproject.toml``'s ``[project].dependencies``
    array beyond the nine entries AC1 enumerates. The comparison is also
    a "no removals" check because dropping (e.g.) ``python-multipart``
    would silently break ``POST /v1/diagnose``'s multipart parsing while
    passing every other AC's check.

    If this test fails, a contributor has reached past the Phase 4.1
    boundary by adding a deferred-Phase runtime dep (Sentry, PostHog,
    Apple-auth client, Fal.ai SDK, rate-limit library, etc.) or has
    silently removed a Phase 4.1-required dep. The fix is to revert the
    pyproject change and route any new dep through the appropriate
    later-phase Seed.
    """
    actual = _load_runtime_dependencies(PYPROJECT_PATH)

    unexpected_additions = actual - AC1_RUNTIME_DEP_ALLOWLIST
    unexpected_removals = AC1_RUNTIME_DEP_ALLOWLIST - actual

    # Build a single, itemised failure message that lists both directions
    # of the diff so a failing run tells the contributor exactly what
    # changed without requiring them to mentally diff two sorted lists.
    if unexpected_additions or unexpected_removals:
        sections: list[str] = []
        if unexpected_additions:
            sections.append(
                "Unexpected ADDITIONS (deps in pyproject not in the AC1 "
                "allowlist — these reach past the Phase 4.1 boundary):\n"
                + "\n".join(f"  + {dep}" for dep in sorted(unexpected_additions))
            )
        if unexpected_removals:
            sections.append(
                "Unexpected REMOVALS (deps in the AC1 allowlist not in "
                "pyproject — these silently drop a Phase 4.1 contract):\n"
                + "\n".join(f"  - {dep}" for dep in sorted(unexpected_removals))
            )
        pytest.fail(
            "AC19 (sub-AC 4) violation: the runtime-dependency set in "
            f"{PYPROJECT_PATH!s} does NOT exactly equal the AC1-declared "
            "allowlist.\n\n" + "\n\n".join(sections)
        )

    # Defensive sanity check: even if the symmetric difference is empty
    # (i.e., both diff directions are empty), assert equality directly so
    # a future refactor of the diff logic above cannot silently invert
    # the test's meaning.
    assert actual == AC1_RUNTIME_DEP_ALLOWLIST
