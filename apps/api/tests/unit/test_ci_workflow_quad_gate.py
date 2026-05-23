"""Structural test for the Phase 4.2 4중 정합 CI gate (Sub-AC 5).

Acceptance criterion (Sub-AC 5) being verified
----------------------------------------------
A CI workflow job in ``.github/workflows/ci.yml`` must run the four
Phase 4.2 quality gates *sequentially* in a single job, and any failing
step must fail the entire job:

    1. ``black --check`` against ``apps/api/{src,tests}``
    2. ``ruff check``  against ``apps/api/{src,tests}``
    3. ``mypy --strict`` against ``apps/api/src``
    4. ``pytest`` from ``apps/api`` (unit + integration tiers)

GitHub Actions' default semantics already satisfy "fails if any step
fails": steps within a job run sequentially in declaration order, and
the job aborts on the first non-zero exit unless the step explicitly
sets ``continue-on-error: true``. This test pins those defaults so a
future workflow edit cannot silently mark one of the four gates as
non-blocking (which would still produce a green-looking job while a
formatter / lint / type / test regression slipped through).

Why a parsed-workflow assertion (not a manual `gh` check)?
----------------------------------------------------------
1. The Seed pins the workflow shape, not just the *existence* of the
   tooling. ``black``, ``ruff``, ``mypy``, and ``pytest`` could all be
   installed in CI yet none of them invoked — a parsed-workflow
   assertion catches that drift in the same pytest run that gates the
   18+ other Phase 4.x acceptance criteria.
2. Mirrors the apps/api unit-test pattern used by
   ``test_alembic_baseline_revision`` (asserts versions/ contents),
   ``test_diff_no_new_runtime_deps`` (asserts pyproject contents), and
   ``test_alembic_history_chain`` (asserts revision linkage) — each
   reaches into a source-of-truth file and validates structural
   invariants without spinning up the runtime.
3. Avoids brittle string matching: PyYAML is a guaranteed transitive
   dependency of ``uvicorn[standard]`` (one of the AC1-allowlisted
   apps/api runtime deps), so parsing the workflow as a structured
   document is portable across local dev and CI without introducing a
   new dependency.

Implementation notes
--------------------
* The workflow path is resolved relative to this test file
  (``parents[3]`` reaches the repository root from
  ``apps/api/tests/unit/<this_file>.py``) so the test is robust to
  pytest being invoked from any directory.
* The four required commands are pinned verbatim from the workflow
  YAML — Sub-AC 9.2/9.3/9.4 (the per-gate sub-ACs that preceded this
  consolidation) already fix the exact CLI invocations:

      - ``python -m black --check src tests``
      - ``python -m ruff check src tests``
      - ``python -m mypy --strict src``
      - ``python -m pytest -q``

  Pinning the command strings (rather than just the tool names) means
  a silent loosening like ``python -m black src tests`` (no
  ``--check`` — it would auto-format the tree green) is caught here.
* The test deliberately does NOT assert the *order* of the four steps
  relative to each other. GitHub Actions runs steps in declaration
  order regardless, so any order is "sequential". The only ordering
  contract pinned by the Seed is that all four gates live in the same
  job (so a failure in one short-circuits the rest).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

# ---------------------------------------------------------------------------
# Constants — single source of truth for the workflow location and the four
# required gate commands.
# ---------------------------------------------------------------------------

# The test file lives at apps/api/tests/unit/test_ci_workflow_quad_gate.py, so
# ``parents[4]`` resolves to the repository root regardless of where pytest is
# invoked from:
#
#   parents[0] = apps/api/tests/unit
#   parents[1] = apps/api/tests
#   parents[2] = apps/api
#   parents[3] = apps
#   parents[4] = <repo root>
_REPO_ROOT: Path = Path(__file__).resolve().parents[4]
_WORKFLOW_PATH: Path = _REPO_ROOT / ".github" / "workflows" / "ci.yml"

# The four pinned CLI invocations the workflow MUST contain inside a single
# job. Each string is the verbatim ``run:`` value the corresponding step
# executes (whitespace-normalised — see ``_normalise_run`` below). Pinning
# the full command (not just the tool name) catches silent loosening like
# dropping ``--check`` from black or ``--strict`` from mypy.
_REQUIRED_RUN_COMMANDS: frozenset[str] = frozenset(
    {
        "python -m black --check src tests",
        "python -m ruff check src tests",
        "python -m mypy --strict src",
        "python -m pytest -q",
    }
)


def _normalise_run(value: str) -> str:
    """Collapse whitespace in a workflow ``run:`` block to a single line.

    GitHub Actions accepts ``run:`` as either an inline scalar or a
    multi-line block scalar. Normalising both forms to a single
    whitespace-collapsed string lets the equality check above stay
    indifferent to YAML formatting choices.
    """
    return " ".join(value.split())


def _load_workflow() -> dict[str, Any]:
    """Parse ``.github/workflows/ci.yml`` and return the document root.

    Fails the test with an informative message if the workflow is
    missing or malformed — both conditions are themselves Sub-AC 5
    regressions worth surfacing rather than swallowing.
    """
    if not _WORKFLOW_PATH.is_file():  # pragma: no cover - defensive
        pytest.fail(
            f"Expected CI workflow at {_WORKFLOW_PATH!s}; file not found. "
            "Sub-AC 5 requires a workflow job that runs the four Phase 4.2 "
            "quality gates — the workflow file itself is the source of truth."
        )

    with _WORKFLOW_PATH.open("r", encoding="utf-8") as fh:
        document = yaml.safe_load(fh)

    if not isinstance(document, dict):  # pragma: no cover - defensive
        pytest.fail(
            f"Expected a YAML mapping at the root of {_WORKFLOW_PATH!s}; "
            f"got {type(document).__name__}. The workflow is malformed."
        )

    return document


def _job_steps(document: dict[str, Any], job_id: str) -> list[dict[str, Any]]:
    """Return the steps list for the named job, or fail the test.

    Sub-AC 5 requires all four gates inside a *single* job; this helper
    centralises the job-lookup error path so the four per-gate
    assertions below share a single failure message contract.
    """
    jobs = document.get("jobs")
    if not isinstance(jobs, dict):  # pragma: no cover - defensive
        pytest.fail(
            f"Expected top-level ``jobs:`` mapping in {_WORKFLOW_PATH!s}; "
            f"got {type(jobs).__name__}. Sub-AC 5 requires at least one job "
            "containing the four quality gates."
        )

    job = jobs.get(job_id)
    if not isinstance(job, dict):  # pragma: no cover - defensive
        pytest.fail(
            f"Expected job ``{job_id}`` in {_WORKFLOW_PATH!s}; not found or "
            f"not a mapping. Sub-AC 5 pins the four quality gates to a single "
            "job so a failure in any one short-circuits the rest."
        )

    steps = job.get("steps")
    if not isinstance(steps, list):  # pragma: no cover - defensive
        pytest.fail(
            f"Expected ``steps:`` array under job ``{job_id}`` in "
            f"{_WORKFLOW_PATH!s}; got {type(steps).__name__}."
        )

    for step in steps:
        if not isinstance(step, dict):  # pragma: no cover - defensive
            pytest.fail(
                f"Every step under job ``{job_id}`` must be a mapping; got "
                f"{type(step).__name__} in {_WORKFLOW_PATH!s}."
            )

    return steps


@pytest.mark.unit
def test_ci_workflow_contains_quad_gate_in_single_job() -> None:
    """All four gates (black, ruff, mypy, pytest) live in the same job.

    Walks the ``test`` job's steps and collects every ``run:`` command,
    whitespace-normalised. Asserts the set of run commands contains all
    four pinned invocations. Because GitHub Actions runs job steps
    sequentially in declaration order, co-locating the gates inside a
    single job is what makes "sequential" hold — and what makes a
    non-zero exit from any one of them short-circuit the rest.

    A failing run of this test means the workflow has either:
      (a) renamed/removed one of the four CLI invocations, OR
      (b) split a gate out into a separate job (defeating the
          short-circuit behaviour Sub-AC 5 requires).
    """
    document = _load_workflow()
    steps = _job_steps(document, job_id="test")

    actual_run_commands: set[str] = set()
    for step in steps:
        run_value = step.get("run")
        if isinstance(run_value, str):
            actual_run_commands.add(_normalise_run(run_value))

    missing = _REQUIRED_RUN_COMMANDS - actual_run_commands
    if missing:
        pytest.fail(
            "Sub-AC 5 violation: the ``test`` job in "
            f"{_WORKFLOW_PATH!s} does not run all four Phase 4.2 quality "
            "gates. Missing run command(s):\n"
            + "\n".join(f"  - {cmd}" for cmd in sorted(missing))
            + "\n\nObserved run commands:\n"
            + "\n".join(f"  * {cmd}" for cmd in sorted(actual_run_commands))
        )


@pytest.mark.unit
def test_ci_workflow_quad_gate_steps_block_on_failure() -> None:
    """No quad-gate step is marked ``continue-on-error: true``.

    GitHub Actions defaults ``continue-on-error`` to ``false`` for every
    step, which is what gives Sub-AC 5 its "fails if any step fails"
    semantics. This test pins that default so a future workflow edit
    cannot opt one of the four gates out of the failure cascade (which
    would silently demote the gate to a soft warning).

    Note: GitHub Actions accepts ``continue-on-error`` as either a
    boolean (``true``/``false``) or an expression string. Both
    representations of "truthy" are rejected here.
    """
    document = _load_workflow()
    steps = _job_steps(document, job_id="test")

    offending_steps: list[str] = []
    for step in steps:
        run_value = step.get("run")
        if not isinstance(run_value, str):
            continue
        normalised = _normalise_run(run_value)
        if normalised not in _REQUIRED_RUN_COMMANDS:
            continue

        flag = step.get("continue-on-error", False)
        # Treat both literal ``True`` and the string ``"true"`` as truthy.
        # Any other expression-string is a YAML mis-spelling worth surfacing
        # as a failure rather than silently passing through.
        is_truthy = flag is True or (
            isinstance(flag, str) and flag.strip().lower() == "true"
        )
        if is_truthy:
            step_name = step.get("name") or normalised
            offending_steps.append(str(step_name))

    if offending_steps:
        pytest.fail(
            "Sub-AC 5 violation: the following quad-gate step(s) in "
            f"{_WORKFLOW_PATH!s} are marked ``continue-on-error: true`` "
            "and would NOT fail the job on a non-zero exit:\n"
            + "\n".join(f"  - {name}" for name in offending_steps)
        )


@pytest.mark.unit
def test_ci_workflow_quad_gate_runs_on_pull_request() -> None:
    """The quad-gate workflow is wired to pull-request triggers.

    Sub-AC 5's "CI workflow job" is only meaningful if it actually runs
    on the changes a contributor proposes. The Seed pins the workflow
    to ``pull_request`` (and ``push``) triggers; this assertion locks
    that in so a future edit cannot accidentally narrow the trigger
    set to (e.g.) ``workflow_dispatch`` only — which would still ship
    a green badge on main while leaving PRs ungated.
    """
    document = _load_workflow()

    # ``on:`` is parsed by PyYAML as the boolean key ``True`` because
    # the unquoted YAML scalar ``on`` is a synonym for ``true`` in
    # YAML 1.1. Handle both representations so a future quoting tweak
    # in the workflow does not break this assertion.
    triggers = document.get("on", document.get(True))
    if not isinstance(triggers, dict):  # pragma: no cover - defensive
        pytest.fail(
            f"Expected ``on:`` mapping in {_WORKFLOW_PATH!s}; got "
            f"{type(triggers).__name__}. Sub-AC 5 requires the quad-gate "
            "workflow to run on pull requests."
        )

    if "pull_request" not in triggers:
        pytest.fail(
            f"Sub-AC 5 violation: the workflow at {_WORKFLOW_PATH!s} is "
            "not wired to ``pull_request`` triggers. Without a PR trigger, "
            "the four quality gates never run on the changes they're "
            "meant to gate. Observed triggers: "
            f"{sorted(triggers.keys())}"
        )
