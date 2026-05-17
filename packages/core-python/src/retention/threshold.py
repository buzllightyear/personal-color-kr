"""Retention-threshold evaluation (Sub-AC 6.1).

Building on `calculate_retention_rate` (Sub-AC 7.3): once we have a measured
30-day retention rate, every downstream consumer — the retention dashboard,
the retention_api router, the pivot-alert hook — has to ask the same yes/no
question against the same bar with the same boundary semantics.

Why a dedicated function rather than scattered inline comparisons:

  The Seed Contract names two anchored thresholds:
    - Phase-1 target:    retention_rate >= 0.25  (25%)  → "passing"
    - Pivot signal:      retention_rate <  0.10  (10%)  → "kill switch"

  If site A writes `rate > 0.25` and site B writes `rate >= 0.25`, a cohort
  that lands *exactly* on the 25% bar silently passes in one place and fails
  in another. Centralising the comparison here once kills that drift class
  and lets the comparison be unit-tested independently of any retention
  computation.

Boundary contract — inclusive comparison:

  `meets_threshold` is True iff `retention_rate >= threshold`. Equality
  passes. This matches how retention bars are stated in product specs
  ("at least 25%") and avoids the "one cohort exactly on the line"
  silent-fail trap described above.

Status semantics — three-valued, not just pass/fail:

  Callers frequently want to distinguish "we are at the bar" from "we are
  over the bar" — the former is a single bad day away from a fail and is
  treated as an amber alert by the dashboard; the latter is green. Encoding
  this as `status ∈ {'below', 'at', 'above'}` keeps the boolean answer
  available (`meets_threshold`) without forcing downstream code to do
  approximate float comparisons.

Input-validation policy:

  Both arguments are coerced to `float` after type-checking, and both must
  lie in the closed interval `[0.0, 1.0]`. NaN is rejected because NaN
  compares False to everything (`nan >= 0.25` is False) — silently letting
  NaN through would make every cohort look like it failed the threshold.
  `bool` is refused even though it is an `int` subclass: this module mirrors
  the activity_tracker discipline so `True` never silently means 1.0.
"""

from __future__ import annotations

import math


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate_retention_threshold(
    retention_rate: float,
    threshold: float,
) -> dict:
    """Compare a retention rate against a threshold and report the verdict.

    Args:
        retention_rate: A retention fraction in the closed interval
            `[0.0, 1.0]`. Typically the return value of
            `calculate_retention_rate`. `int` `0` and `1` are accepted and
            coerced to `float`; `bool` is rejected to avoid `True`/`False`
            silently meaning 1.0 / 0.0.
        threshold: The retention bar to compare against, also in
            `[0.0, 1.0]`. Same coercion rules as `retention_rate`.

    Returns:
        A fresh `dict` with five keys:
          - `retention_rate` (`float`): the input rate, normalised to float.
          - `threshold` (`float`): the input threshold, normalised to float.
          - `meets_threshold` (`bool`): `True` iff `rate >= threshold`
            (inclusive — see module docstring).
          - `gap` (`float`): `retention_rate - threshold`. Positive means
            the bar was exceeded; negative means it was missed.
          - `status` (`str`): one of `'below'`, `'at'`, `'above'`.

        A new dict is returned on every call; callers may mutate it freely
        for logging or augmentation without affecting other callers.

    Raises:
        TypeError: if either argument is not a real number (or is a `bool`,
            which is an `int` subclass — refused so booleans never silently
            mean 1.0 / 0.0).
        ValueError: if either argument is NaN, negative, or strictly greater
            than 1.0.
    """
    rate = _validate_unit_interval(retention_rate, "retention_rate")
    bar = _validate_unit_interval(threshold, "threshold")

    gap = rate - bar
    meets = rate >= bar
    if rate == bar:
        status = "at"
    elif rate > bar:
        status = "above"
    else:
        status = "below"

    return {
        "retention_rate": rate,
        "threshold": bar,
        "meets_threshold": meets,
        "gap": gap,
        "status": status,
    }


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _validate_unit_interval(value: object, name: str) -> float:
    """Coerce `value` to a `float` in `[0.0, 1.0]` or raise.

    Centralised so the boundary rules — no bool, no NaN, no out-of-range —
    are applied identically to `retention_rate` and `threshold`. Returning
    the coerced `float` (rather than mutating in place) keeps the public
    function pure.
    """
    # Refuse bool *before* the int/float check; bool is an int subclass and
    # would otherwise sneak through as 0.0 / 1.0 with a confusing trace.
    if isinstance(value, bool):
        raise TypeError(
            f"{name} must be a real number in [0.0, 1.0], "
            f"got bool ({value!r})",
        )
    if not isinstance(value, (int, float)):
        raise TypeError(
            f"{name} must be a real number in [0.0, 1.0], "
            f"got {type(value).__name__} ({value!r})",
        )

    coerced = float(value)
    if math.isnan(coerced):
        raise ValueError(
            f"{name} must not be NaN — NaN comparisons silently fail",
        )
    if coerced < 0.0 or coerced > 1.0:
        raise ValueError(
            f"{name} must be in [0.0, 1.0], got {coerced!r}",
        )
    return coerced
