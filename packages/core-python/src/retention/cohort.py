"""Cohort assignment from the activity log (Sub-AC 7.2).

Building on `track_user_activity` (Sub-AC 7.1), this module answers the next
retention question: **which users joined in a given period?** That set — the
*cohort* — is the denominator for every retention rate the magazine loop
needs to track. Day-N retention is meaningless without a stable definition
of "who joined on day 0".

Why this lives next to the activity tracker (and not in an analytics layer):

  - The cohort definition has to agree exactly with how activity is recorded
    (same timezone semantics, same notion of "first activity"). Splitting
    them across modules invites silent drift. They share a file directory
    so a change to one forces inspection of the other.
  - It depends only on `ActivityStore`. No magazine, payment, or PostHog
    awareness — those layers compose this primitive, not the other way
    around.

Cohort definition (deliberately strict):

  A user U is a member of cohort [start, end) iff the *first* activity
  recorded for U in `store` has a timestamp T such that
  `start <= T < end` (or `<= end` when `inclusive_end=True`).

  - "First" = smallest timestamp seen for U across all events in the store.
    Insertion order is *not* used — events may be backfilled out of order
    (e.g. an offline-mode app uploads its event queue after reconnecting),
    and a user's cohort cannot depend on upload luck.
  - A user with no events is not in any cohort (trivially).
  - A user whose first activity is *before* `start` is in an earlier
    cohort, *never* this one — even if they were also active during
    [start, end). This is the standard cohort-analysis convention and
    matches how PostHog / Mixpanel compute "new user cohorts".

Boundary semantics (the AC's "포함/제외" requirement):

  - `start_date`: **inclusive** (always). A first-activity timestamp equal
    to `start_date` lands in this cohort. This is the universal convention.
  - `end_date`: **exclusive by default** (`inclusive_end=False`), so
    contiguous cohorts tile without overlap or gap:
        [Jan 1, Feb 1)  ∪  [Feb 1, Mar 1)  ∪  ...
    Pass `inclusive_end=True` for the [start, end] form (useful for
    closed-form day cohorts where `end_date` *is* the last second of the
    day, not midnight of the next day).

Returns a `frozenset[str]` — immutable on purpose. Cohorts get fanned out to
multiple downstream callers (magazine eligibility, retention rate, churn
scoring) and a mutable result invites action-at-a-distance bugs.
"""

from __future__ import annotations

from datetime import datetime

from .activity_tracker import ActivityEvent, ActivityStore


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_cohort(
    start_date: datetime,
    end_date: datetime,
    *,
    store: ActivityStore,
    inclusive_end: bool = False,
) -> frozenset[str]:
    """Return the set of users whose *first* activity falls in the window.

    A user's first activity is the event with the smallest timestamp in
    `store` for that user. See module docstring for the full definition and
    rationale.

    Args:
        start_date: Window start (timezone-aware). **Inclusive.**
        end_date: Window end (timezone-aware). Exclusive by default; pass
            `inclusive_end=True` to include events exactly at `end_date`.
        store: The `ActivityStore` to read events from. Keyword-only — no
            implicit module-global store, ever.
        inclusive_end: If True, treat the window as the closed interval
            [start_date, end_date]. Default False, i.e. [start_date, end_date).

    Returns:
        Immutable set of `user_id`s whose first activity lies in the window.
        Empty if no users qualify.

    Raises:
        TypeError: if `start_date` / `end_date` are not `datetime`, or
            `inclusive_end` is not a bool.
        ValueError: if either timestamp is naive (no tzinfo), or
            `start_date > end_date`.
    """
    _validate_boundary(start_date, "start_date")
    _validate_boundary(end_date, "end_date")
    _validate_inclusive_end(inclusive_end)
    if start_date > end_date:
        raise ValueError(
            f"start_date ({start_date.isoformat()}) must be <= end_date "
            f"({end_date.isoformat()})",
        )

    first_by_user = _first_activity_per_user(store.list_events())

    members: set[str] = set()
    for user_id, first_ts in first_by_user.items():
        if _in_window(first_ts, start_date, end_date, inclusive_end):
            members.add(user_id)
    return frozenset(members)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _first_activity_per_user(
    events: tuple[ActivityEvent, ...],
) -> dict[str, datetime]:
    """Map each user to their earliest event timestamp.

    Independent of insertion order — we explicitly compare timestamps, so a
    backfilled event with an earlier timestamp correctly *replaces* the
    previously-recorded first.
    """
    first: dict[str, datetime] = {}
    for event in events:
        current = first.get(event.user_id)
        if current is None or event.timestamp < current:
            first[event.user_id] = event.timestamp
    return first


def _in_window(
    ts: datetime,
    start: datetime,
    end: datetime,
    inclusive_end: bool,
) -> bool:
    """Half-open `[start, end)` or closed `[start, end]` membership test.

    Comparing tz-aware datetimes across zones is well-defined in Python
    (it compares the absolute UTC instants), so we do not need to convert.
    """
    if ts < start:
        return False
    if inclusive_end:
        return ts <= end
    return ts < end


def _validate_boundary(value: datetime, name: str) -> None:
    if not isinstance(value, datetime):
        raise TypeError(
            f"{name} must be datetime, got {type(value).__name__}",
        )
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(
            f"{name} must be timezone-aware; naive datetimes silently shift "
            "the cohort window when the server timezone differs from the "
            "intended one",
        )


def _validate_inclusive_end(value: bool) -> None:
    # `bool` is the only acceptable type — we don't want truthy strings or
    # 1/0 ints flipping the boundary semantics by accident.
    if not isinstance(value, bool):
        raise TypeError(
            f"inclusive_end must be bool, got {type(value).__name__}",
        )
