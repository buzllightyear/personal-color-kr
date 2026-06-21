"""Day-N retention rate (Sub-AC 7.3).

Building on:
  - `track_user_activity` (Sub-AC 7.1) — durable record of when users were
    active, the substrate every retention question reads from.
  - `get_cohort` (Sub-AC 7.2) — the denominator "who joined in this period".

This module computes the retention layer's headline number: among a cohort
of users, what fraction came back at or after D+`day_offset` days from their
first activity?

Why this matters:

  The Seed Contract pins the *secondary* north-star at "30일 retention rate
  ≥ 25%" (see retention_metric in the ontology). The payment-conversion
  north-star (5.5%+) measures whether new users *pay*; this measures whether
  paying users *come back*. Without an explicit, testable rate, the monthly-
  magazine retention loop has no validation signal — we'd be shipping a
  magazine and hoping. The pivot signal in the exit conditions ("30일
  retention < 10%") is unreadable without this function existing.

Retention semantics: rolling retention.

  A user U in cohort C is **retained at D+N** iff `store` contains *any*
  activity event for U with timestamp `>= U.first_activity + N days`.

Why rolling retention rather than classic "active on day N exactly":

  - The monthly magazine publishes once per month with no fixed weekday and
    no fixed hour. A user might engage on day 28 (the magazine arrived
    early) or day 32 (they opened the push notification two days late).
    Classic retention with a 24h window-on-day-N penalises both — but each
    is a real retention success for the product.
  - Rolling retention is the standard consumer-app metric for monthly
    re-engagement. Investors and the team are reading the same definition
    that PostHog / Mixpanel call out in their dashboards by default.
  - It is monotonic: a user retained at D+30 is automatically retained at
    every D+k for k ≤ 30. That makes the metric easier to reason about and
    much harder to game with cherry-picked windows.

Empty-cohort policy:

  Returns `0.0`, not `NaN` and not an exception. Downstream dashboards and
  alert thresholds compare retention to a 25% bar; a NaN would silently
  break those comparisons (NaN compares False to everything). Resolving the
  ambiguity here, once, beats discovering it in every read site later.

Defensive policy on missing events:

  A cohort produced by `get_cohort` is derived from this same store, so
  every member is guaranteed to have at least one event. But callers may
  also pass cohorts assembled from a *different* source (a Postgres dump,
  a partial sync). A user_id in `cohort` with zero events in `store` is
  counted as **churned**, never raised — the metric stays robust under
  partial data, which is the whole point of having a metric.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Iterable

from .activity_tracker import ActivityStore

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def calculate_retention_rate(
    cohort: Iterable[str],
    day_offset: int = 30,
    *,
    store: ActivityStore,
) -> float:
    """Return the fraction of cohort users retained at D+`day_offset`.

    A user is retained iff `store` contains at least one event for them with
    a timestamp at or after their first-activity timestamp + `day_offset`
    days. See the module docstring for the rationale behind rolling
    retention and the empty-cohort policy.

    Args:
        cohort: The user_ids whose retention to measure. Typically the
            return value of `get_cohort`. Accepts any iterable of strings
            (set, frozenset, list, tuple). Duplicates are deduplicated, so
            a list with the same user twice does not double-count.
        day_offset: Days after first activity at which retention is measured.
            Must be a non-negative `int`. Default `30` — the Phase-1
            secondary north-star window (see Seed Contract).
        store: The `ActivityStore` holding the activity log. Keyword-only —
            no implicit module-global store.

    Returns:
        A Python `float` in `[0.0, 1.0]`:
          - `len(retained_users) / len(cohort)` for non-empty cohorts.
          - `0.0` for an empty cohort. Contract-defined so dashboards do
            not have to special-case division by zero.

    Raises:
        TypeError: if `cohort` is not an iterable of strings (bare `str` /
            `bytes` are explicitly rejected to prevent the
            iterable-of-characters foot-gun); or if `day_offset` is not an
            `int` (or is a `bool`, which is an `int` subclass — refused so
            `True` / `False` never silently mean 1 / 0 days).
        ValueError: if `day_offset` is negative; or if any cohort member is
            an empty / whitespace-only string.
    """
    _validate_day_offset(day_offset)
    cohort_set = _coerce_cohort(cohort)

    if not cohort_set:
        # Contract: empty cohort → 0.0, never NaN. See module docstring.
        return 0.0

    threshold = timedelta(days=day_offset)
    retained_count = sum(
        1 for user_id in cohort_set if _is_retained(user_id, threshold, store)
    )
    return retained_count / len(cohort_set)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _is_retained(
    user_id: str,
    threshold: timedelta,
    store: ActivityStore,
) -> bool:
    """Was `user_id` active at or after their first event + `threshold`?

    Returns False for a user with no events in the store (treated as
    churned, not as an error — see "Defensive policy" in the module
    docstring). We compute `first_activity` from `min(timestamps)` rather
    than insertion order so backfilled, out-of-order events still anchor
    the threshold correctly.
    """
    events = store.list_events_for_user(user_id)
    if not events:
        return False
    first_ts = min(event.timestamp for event in events)
    cutoff = first_ts + threshold
    return any(event.timestamp >= cutoff for event in events)


def _coerce_cohort(cohort: Iterable[str]) -> frozenset[str]:
    """Normalise `cohort` to a deduplicated, validated `frozenset[str]`.

    Accepts any iterable. Rejects bare `str` / `bytes` early — they are
    iterables of characters / ints, which is never what the caller meant
    when they passed "alice" instead of `{"alice"}`. Catching this once,
    here, beats discovering the bug as a baffling retention of 0.0 in
    production.
    """
    if isinstance(cohort, (str, bytes, bytearray)):
        raise TypeError(
            "cohort must be an iterable of user_id strings, "
            f"got bare {type(cohort).__name__}; did you mean "
            f"{{{cohort!r}}}?",
        )
    try:
        members = list(cohort)
    except TypeError as exc:
        raise TypeError(
            f"cohort must be iterable, got {type(cohort).__name__}",
        ) from exc

    for member in members:
        if not isinstance(member, str):
            raise TypeError(
                "cohort members must be str user_ids, got "
                f"{type(member).__name__} ({member!r})",
            )
        if not member.strip():
            raise ValueError(
                "cohort contains an empty / whitespace-only user_id",
            )
    return frozenset(members)


def _validate_day_offset(value: int) -> None:
    """Reject non-int / bool / negative `day_offset` at the boundary.

    `bool` is an `int` subclass in Python, so `isinstance(True, int)` is
    True. Rejecting `bool` explicitly mirrors the activity_tracker /
    tone_classifier discipline: no truthy-int boundary surprises.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(
            f"day_offset must be int, got {type(value).__name__}",
        )
    if value < 0:
        raise ValueError(
            f"day_offset must be >= 0, got {value}",
        )
