"""Unit tests for `get_cohort` (Sub-AC 7.2).

The contract under test:

    get_cohort(start, end, *, store, inclusive_end=False) returns the set of
    users whose *first* activity (smallest timestamp) lies in the window
    [start, end) — or [start, end] when inclusive_end=True.

Branch / boundary coverage targets:
  - Happy path: users whose first activity is inside the window are included
  - start_date is inclusive (event exactly at start → included)
  - end_date is exclusive by default (event exactly at end → excluded)
  - end_date is inclusive when inclusive_end=True (event exactly at end → included)
  - Users whose first activity is *before* the window are excluded even if
    they also have an event inside (cohort = first-seen, not last-seen)
  - Users whose first activity is *after* the window are excluded
  - First activity is computed by timestamp, not insertion order
    (backfilled out-of-order events still classify correctly)
  - Empty store → empty cohort
  - Contiguous cohorts tile without overlap or gap
  - Cross-timezone comparisons agree (KST 09:00 == UTC 00:00)
  - Returns an immutable frozenset
  - Input validation: naive datetimes, wrong types, start > end, bad inclusive_end
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from retention.activity_tracker import InMemoryActivityStore, track_user_activity
from retention.cohort import get_cohort

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


UTC = timezone.utc
KST = timezone(timedelta(hours=9))


@pytest.fixture
def store() -> InMemoryActivityStore:
    return InMemoryActivityStore()


@pytest.fixture
def window_start() -> datetime:
    # Jan 1 2026, midnight UTC — a clean cohort boundary.
    return datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture
def window_end() -> datetime:
    # Feb 1 2026, midnight UTC — the next cohort's start.
    return datetime(2026, 2, 1, 0, 0, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Sub-AC 7.2 core: happy path — users active in the window are included.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returns_users_with_first_activity_in_window(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    track_user_activity("alice", window_start + timedelta(days=1), store=store)
    track_user_activity("bob", window_start + timedelta(days=15), store=store)

    cohort = get_cohort(window_start, window_end, store=store)
    assert cohort == frozenset({"alice", "bob"})


@pytest.mark.unit
def test_empty_store_returns_empty_cohort(
    window_start: datetime,
    window_end: datetime,
) -> None:
    cohort = get_cohort(window_start, window_end, store=InMemoryActivityStore())
    assert cohort == frozenset()


@pytest.mark.unit
def test_users_outside_window_are_excluded(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    # Before the window
    track_user_activity("early", window_start - timedelta(days=1), store=store)
    # After the window
    track_user_activity("late", window_end + timedelta(days=1), store=store)
    # Inside the window
    track_user_activity("inside", window_start + timedelta(hours=12), store=store)

    cohort = get_cohort(window_start, window_end, store=store)
    assert cohort == frozenset({"inside"})


# ---------------------------------------------------------------------------
# Boundary: start_date is inclusive (always).
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_start_date_is_inclusive(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """An event at exactly start_date belongs to this cohort."""
    track_user_activity("on-boundary", window_start, store=store)

    cohort = get_cohort(window_start, window_end, store=store)
    assert "on-boundary" in cohort


@pytest.mark.unit
def test_just_before_start_date_is_excluded(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    one_microsecond_before = window_start - timedelta(microseconds=1)
    track_user_activity("almost", one_microsecond_before, store=store)

    cohort = get_cohort(window_start, window_end, store=store)
    assert "almost" not in cohort


# ---------------------------------------------------------------------------
# Boundary: end_date is exclusive by default, inclusive when asked.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_end_date_is_exclusive_by_default(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """An event at exactly end_date does NOT belong to this cohort by default.

    This is the convention that lets contiguous cohorts tile cleanly:
    [Jan 1, Feb 1) ∪ [Feb 1, Mar 1) covers every instant exactly once.
    """
    track_user_activity("on-end", window_end, store=store)

    cohort = get_cohort(window_start, window_end, store=store)
    assert "on-end" not in cohort


@pytest.mark.unit
def test_end_date_inclusive_when_flag_set(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """With inclusive_end=True, an event at end_date IS included."""
    track_user_activity("on-end", window_end, store=store)

    cohort = get_cohort(
        window_start,
        window_end,
        store=store,
        inclusive_end=True,
    )
    assert "on-end" in cohort


@pytest.mark.unit
def test_just_before_end_date_is_always_included(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    one_microsecond_before_end = window_end - timedelta(microseconds=1)
    track_user_activity("almost-end", one_microsecond_before_end, store=store)

    # Both modes include it — the boundary disagreement is only at end_date itself.
    cohort_excl = get_cohort(window_start, window_end, store=store)
    cohort_incl = get_cohort(
        window_start,
        window_end,
        store=store,
        inclusive_end=True,
    )
    assert "almost-end" in cohort_excl
    assert "almost-end" in cohort_incl


@pytest.mark.unit
def test_contiguous_cohorts_tile_without_overlap(
    store: InMemoryActivityStore,
) -> None:
    """A user at the seam (Feb 1 00:00:00) lands in exactly one cohort."""
    jan_start = datetime(2026, 1, 1, tzinfo=UTC)
    feb_start = datetime(2026, 2, 1, tzinfo=UTC)
    mar_start = datetime(2026, 3, 1, tzinfo=UTC)

    track_user_activity("seam-user", feb_start, store=store)

    jan_cohort = get_cohort(jan_start, feb_start, store=store)
    feb_cohort = get_cohort(feb_start, mar_start, store=store)

    # In feb cohort (start inclusive), NOT in jan cohort (end exclusive).
    assert "seam-user" not in jan_cohort
    assert "seam-user" in feb_cohort


# ---------------------------------------------------------------------------
# "First activity" semantics — earliest timestamp wins, NOT insertion order.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_first_activity_outside_window_excludes_user(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """User joined before the window; even if they're active inside it,
    they belong to an *earlier* cohort, not this one.
    """
    track_user_activity(
        "veteran",
        window_start - timedelta(days=30),
        store=store,
    )
    # Active inside the window too — but cohort is fixed by first activity.
    track_user_activity(
        "veteran",
        window_start + timedelta(days=5),
        store=store,
    )

    cohort = get_cohort(window_start, window_end, store=store)
    assert "veteran" not in cohort


@pytest.mark.unit
def test_first_activity_uses_timestamp_not_insertion_order(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """Backfilled out-of-order events must still classify correctly.

    Scenario: an offline-mode client uploads its event queue after
    reconnecting, so the *later-uploaded* event has an *earlier* timestamp.
    The user's cohort is determined by the earliest timestamp, not by
    upload luck.
    """
    in_window_ts = window_start + timedelta(days=5)
    before_window_ts = window_start - timedelta(days=10)

    # Insert "later" wall-clock event first, then the backfilled earlier one.
    track_user_activity("backfilled", in_window_ts, store=store)
    track_user_activity("backfilled", before_window_ts, store=store)

    # Their TRUE first activity is before the window → not in this cohort.
    cohort = get_cohort(window_start, window_end, store=store)
    assert "backfilled" not in cohort


@pytest.mark.unit
def test_multiple_events_within_window_user_included_once(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """A user with several in-window events still appears once (it's a set)."""
    for delta_days in (1, 2, 3, 4, 5):
        track_user_activity(
            "active-alice",
            window_start + timedelta(days=delta_days),
            store=store,
        )

    cohort = get_cohort(window_start, window_end, store=store)
    assert cohort == frozenset({"active-alice"})


# ---------------------------------------------------------------------------
# Cross-timezone equivalence: comparison is by UTC instant.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cross_timezone_comparison_uses_utc_instant(
    store: InMemoryActivityStore,
) -> None:
    """KST 09:00:00 == UTC 00:00:00 — same instant, same cohort decision."""
    window_start_utc = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
    window_end_utc = datetime(2026, 2, 1, 0, 0, 0, tzinfo=UTC)

    # KST 09:00:00 on Jan 1 == UTC 00:00:00 on Jan 1 → exactly the boundary.
    kst_boundary = datetime(2026, 1, 1, 9, 0, 0, tzinfo=KST)
    track_user_activity("kst-user", kst_boundary, store=store)

    cohort = get_cohort(window_start_utc, window_end_utc, store=store)
    assert "kst-user" in cohort  # start is inclusive


@pytest.mark.unit
def test_window_can_be_specified_in_kst(
    store: InMemoryActivityStore,
) -> None:
    """A Korean-market caller can pass KST-based windows; events recorded
    in UTC still match correctly."""
    window_start_kst = datetime(2026, 1, 1, 0, 0, 0, tzinfo=KST)  # 2025-12-31 15:00 UTC
    window_end_kst = datetime(2026, 1, 2, 0, 0, 0, tzinfo=KST)  # 2026-01-01 15:00 UTC

    # UTC 2026-01-01 00:00 = KST 2026-01-01 09:00 → inside the window
    in_window_utc = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
    # UTC 2026-01-01 15:00 = KST 2026-01-02 00:00 → on the (exclusive) end
    on_end_utc = datetime(2026, 1, 1, 15, 0, 0, tzinfo=UTC)

    track_user_activity("inside", in_window_utc, store=store)
    track_user_activity("on-end", on_end_utc, store=store)

    cohort = get_cohort(window_start_kst, window_end_kst, store=store)
    assert cohort == frozenset({"inside"})


# ---------------------------------------------------------------------------
# Immutability of the return value.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returned_cohort_is_a_frozenset(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    track_user_activity("alice", window_start + timedelta(days=1), store=store)

    cohort = get_cohort(window_start, window_end, store=store)
    assert isinstance(cohort, frozenset)
    # Defensive: frozensets have no `add` — calling it must raise.
    with pytest.raises(AttributeError):
        cohort.add("attacker")  # type: ignore[attr-defined]


@pytest.mark.unit
def test_repeated_calls_return_equal_sets(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """Idempotent — no internal state pollution between calls."""
    track_user_activity("alice", window_start + timedelta(days=1), store=store)
    track_user_activity("bob", window_start + timedelta(days=2), store=store)

    first = get_cohort(window_start, window_end, store=store)
    second = get_cohort(window_start, window_end, store=store)
    assert first == second == frozenset({"alice", "bob"})


# ---------------------------------------------------------------------------
# Zero-width window: start == end.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_zero_width_window_exclusive_end_is_empty(
    store: InMemoryActivityStore,
    window_start: datetime,
) -> None:
    """[t, t) is empty by definition — no instant satisfies t <= x < t."""
    track_user_activity("alice", window_start, store=store)

    cohort = get_cohort(window_start, window_start, store=store)
    assert cohort == frozenset()


@pytest.mark.unit
def test_zero_width_window_inclusive_end_matches_only_exact_instant(
    store: InMemoryActivityStore,
    window_start: datetime,
) -> None:
    """[t, t] contains exactly the instant t."""
    track_user_activity("exact", window_start, store=store)
    track_user_activity(
        "near",
        window_start + timedelta(microseconds=1),
        store=store,
    )

    cohort = get_cohort(
        window_start,
        window_start,
        store=store,
        inclusive_end=True,
    )
    assert cohort == frozenset({"exact"})


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad",
    [
        "2026-01-01",
        1735689600,
        1735689600.0,
        None,
        (2026, 1, 1),
    ],
)
def test_rejects_non_datetime_start(
    store: InMemoryActivityStore,
    window_end: datetime,
    bad: object,
) -> None:
    with pytest.raises(TypeError):
        get_cohort(bad, window_end, store=store)  # type: ignore[arg-type]


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad",
    [
        "2026-02-01",
        1738368000,
        None,
        (2026, 2, 1),
    ],
)
def test_rejects_non_datetime_end(
    store: InMemoryActivityStore,
    window_start: datetime,
    bad: object,
) -> None:
    with pytest.raises(TypeError):
        get_cohort(window_start, bad, store=store)  # type: ignore[arg-type]


@pytest.mark.unit
def test_rejects_naive_start(
    store: InMemoryActivityStore,
    window_end: datetime,
) -> None:
    naive_start = datetime(2026, 1, 1, 0, 0, 0)  # no tzinfo
    with pytest.raises(ValueError):
        get_cohort(naive_start, window_end, store=store)


@pytest.mark.unit
def test_rejects_naive_end(
    store: InMemoryActivityStore,
    window_start: datetime,
) -> None:
    naive_end = datetime(2026, 2, 1, 0, 0, 0)  # no tzinfo
    with pytest.raises(ValueError):
        get_cohort(window_start, naive_end, store=store)


@pytest.mark.unit
def test_rejects_inverted_window(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """start > end is a caller bug; refuse it instead of silently returning ∅."""
    with pytest.raises(ValueError):
        get_cohort(window_end, window_start, store=store)


@pytest.mark.unit
@pytest.mark.parametrize("bad", [1, 0, "yes", None, [True]])
def test_rejects_non_bool_inclusive_end(
    store: InMemoryActivityStore,
    window_start: datetime,
    window_end: datetime,
    bad: object,
) -> None:
    """1/0/'yes' silently flipping the boundary is a foot-gun — refuse it."""
    with pytest.raises(TypeError):
        get_cohort(
            window_start,
            window_end,
            store=store,
            inclusive_end=bad,  # type: ignore[arg-type]
        )
