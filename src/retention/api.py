"""Retention metrics HTTP handler — `GET /metrics/retention` (Sub-AC 6.3).

The retention layer publishes one externally-readable number: *did this
cohort come back at D+30?* Internal callers (the magazine-publishing job,
the pivot-alert hook) talk to `calculate_30day_retention` and
`evaluate_retention_threshold` directly. External callers — the operator
dashboard, the CI smoke test, the Phase-1 monitoring rollup — need an HTTP
surface that composes those two primitives once and returns a stable
response envelope.

Why a dedicated module rather than inlining the composition in a route file:

  - Routing frameworks come and go (Flask today, FastAPI tomorrow); the
    *handler* — input validation, primitive composition, response shaping —
    is the actual business logic and deserves to be unit-testable without
    standing up an HTTP server. This module exposes a pure Python function
    that any framework adapter can wire to a route in three lines.
  - Splitting "compute" (calculator + threshold) from "publish" (this
    module) keeps the compute modules HTTP-ignorant. Adding a new transport
    (gRPC, websocket push) later means writing another adapter, not editing
    the math.

Response shape — `ApiResponse[RetentionMetricsData]`:

  Mirrors the TypeScript convention used elsewhere in this repo
  (`src/funnel/*.ts`'s analytics envelope, the project rule in
  `~/.claude/rules/typescript/patterns.md`):

      {
        "success": bool,
        "data":    RetentionMetricsData | None,
        "error":   str | None,
      }

  - `success=True`  ⇒  `data` is populated, `error` is `None`.
  - `success=False` ⇒  `data` is `None`,    `error` carries a user-readable
    message.

  Keeping the envelope identical on success and failure means the dashboard
  / smoke-test consumer can `if response["success"]:` without first peeking
  at HTTP status codes — useful in environments where the framework
  swallows or re-skins status codes (Vercel, App Engine).

`RetentionMetricsData` payload:

  A flat `dict` with seven keys — chosen so the dashboard never has to
  re-derive numbers the handler already computed:

  - `cohort_size`     — `int`, after deduplication of the input list.
  - `active_size`     — `int`, after deduplication of the input list.
  - `retention_rate`  — `float` in [0.0, 1.0], from `calculate_30day_retention`.
  - `threshold`       — `float` in [0.0, 1.0], the bar applied (default 0.25,
                        the Seed Contract Phase-1 target).
  - `meets_threshold` — `bool`, from `evaluate_retention_threshold`.
  - `gap`             — `float`, signed `rate - threshold`.
  - `status`          — `str` in {'below', 'at', 'above'}.

Empty-data policy:

  Mirrors `calculate_30day_retention`'s contract: an empty cohort is **not**
  an error. The handler returns `success=True` with `retention_rate=0.0`
  and the threshold verdict applied normally (a 0.0 rate is `below` a 0.25
  threshold). The dashboard expects to render "0건 / 0%" on a fresh cohort
  rather than display an error toast.

Error policy:

  TypeError / ValueError raised by the input validators are converted to
  `success=False` envelopes with the exception's message in `error`. No
  exception propagates out of the handler — the HTTP layer can `return
  jsonify(handler(...))` without try/except guards.

Purity:

  The handler is pure: no globals, no I/O, no time. A new dict is returned
  on every call (callers may mutate the result for logging or augmentation
  without leaking state). This keeps it cache-friendly and trivially
  parallelisable in tests.
"""

from __future__ import annotations

from typing import Final

from .calculator import calculate_30day_retention
from .threshold import evaluate_retention_threshold


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Seed Contract Phase-1 retention bar — the dashboard's "passing" line.
#: Centralised here (rather than as a literal at the call site) so a future
#: Seed amendment lives in exactly one place.
DEFAULT_RETENTION_THRESHOLD: Final[float] = 0.25


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_retention_metrics(
    cohort_users: list[str],
    active_users: list[str],
    *,
    threshold: float = DEFAULT_RETENTION_THRESHOLD,
) -> dict:
    """Handler for `GET /metrics/retention`.

    Composes `calculate_30day_retention` (the rate) and
    `evaluate_retention_threshold` (the verdict against the bar) and returns
    a framework-agnostic `ApiResponse` envelope. See the module docstring
    for the envelope shape and empty-data policy.

    Args:
        cohort_users: User identifiers in the denominator cohort. Duplicates
            are deduplicated (mirrors the calculator's contract). An empty
            list returns a successful response with `retention_rate=0.0`,
            **not** an error.
        active_users: User identifiers observed as active at or after
            D+30 — i.e. the numerator candidates. Caller is responsible for
            applying the 30-day timestamp rule.
        threshold: The retention bar to compare against. Defaults to
            `DEFAULT_RETENTION_THRESHOLD` (0.25, the Seed Contract Phase-1
            target). Must lie in [0.0, 1.0]; out-of-range values are
            converted to a `success=False` envelope rather than raising.

    Returns:
        A fresh `dict` with three top-level keys — `success`, `data`,
        `error` — shaped per the module docstring. Each invocation returns
        a new dict so callers may augment the result for logging without
        affecting other callers.

    Raises:
        Nothing. All boundary errors from the calculator / threshold
        primitives are caught and rendered as `success=False` envelopes.
    """
    try:
        rate = calculate_30day_retention(cohort_users, active_users)
        verdict = evaluate_retention_threshold(rate, threshold)
    except (TypeError, ValueError) as exc:
        return _error_response(str(exc))

    cohort_size = len(set(cohort_users))
    active_size = len(set(active_users))

    return _success_response(
        {
            "cohort_size": cohort_size,
            "active_size": active_size,
            "retention_rate": verdict["retention_rate"],
            "threshold": verdict["threshold"],
            "meets_threshold": verdict["meets_threshold"],
            "gap": verdict["gap"],
            "status": verdict["status"],
        }
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _success_response(data: dict) -> dict:
    """Build a `success=True` envelope around `data`.

    Centralised so the envelope shape lives in exactly one place; a future
    edit to (say) add a `meta` field will not require chasing every call
    site.
    """
    return {
        "success": True,
        "data": data,
        "error": None,
    }


def _error_response(message: str) -> dict:
    """Build a `success=False` envelope carrying `message`.

    `data` is `None` (not `{}` and not omitted) so consumers can rely on
    the key always being present — `response["data"]` never raises a
    KeyError regardless of success/failure.
    """
    return {
        "success": False,
        "data": None,
        "error": message,
    }
