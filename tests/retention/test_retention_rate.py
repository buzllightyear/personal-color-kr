"""Unit tests for `calculate_retention_rate` (Sub-AC 7.3).

The contract under test:

    calculate_retention_rate(cohort, day_offset=30, *, store) returns the
    fraction (0.0–1.0) of cohort users who have at least one activity event
    at or after their first-activity timestamp + day_offset days.

AC-required edge cases (the "빈 코호트 / 전원 이탈 / 전원 잔존" trio):
  - Empty cohort                              → 0.0
  - Whole cohort churned (no return events)   → 0.0
  - Whole cohort retained (everyone returns)  → 1.0

Branch / boundary coverage targets:
  - Mixed retention rate (partial fractions like 0.5)
  - An activity exactly at first_activity + day_offset IS retained (>= threshold)
  - An activity just before first_activity + day_offset is NOT retained
  - day_offset=0 → every cohort member with any event is retained
  - User in cohort but with zero events in store → counted as churned, not as error
  - Backfilled out-of-order activity: first_activity computed by min(timestamp),
    not by insertion order
  - Custom day_offset (e.g. 7) is honoured
  - Cohort container types: frozenset, set, list, tuple all accepted
  - Returns a Python float in [0.0, 1.0]
  - Idempotent (no internal state pollution)
  - Input validation: cohort types/members, day_offset types/values
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from retention.activity_tracker import InMemoryActivityStore, track_user_activity
from retention.retention_rate import calculate_retention_rate


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


UTC = timezone.utc
KST = timezone(timedelta(hours=9))
JOIN_TS = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture
def store() -> InMemoryActivityStore:
    return InMemoryActivityStore()


def _join(store: InMemoryActivityStore, user_id: str, when: datetime) -> None:
    track_user_activity(user_id, when, store=store)


def _revisit(
    store: InMemoryActivityStore, user_id: str, when: datetime,
) -> None:
    track_user_activity(user_id, when, store=store)


# ---------------------------------------------------------------------------
# Sub-AC 7.3 core: the three required edge cases.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_empty_cohort_returns_zero(store: InMemoryActivityStore) -> None:
    """빈 코호트 케이스 — 0/0 is contract-defined to be 0.0 (not NaN, not an error).

    Downstream dashboards compare retention to a 25% bar; NaN would silently
    break those comparisons. The empty-cohort case is resolved here, once.
    """
    assert calculate_retention_rate(frozenset(), store=store) == 0.0
    # Also verify with default day_offset works on empty.
    assert calculate_retention_rate(frozenset(), day_offset=30, store=store) == 0.0


@pytest.mark.unit
def test_whole_cohort_churned_returns_zero(
    store: InMemoryActivityStore,
) -> None:
    """전원 이탈 — no user returned at or after D+30."""
    # Three users joined, each touched the app a few times within the first
    # week, then never returned.
    for user_id in ("alice", "bob", "carol"):
        _join(store, user_id, JOIN_TS)
        _revisit(store, user_id, JOIN_TS + timedelta(days=1))
        _revisit(store, user_id, JOIN_TS + timedelta(days=5))

    cohort = frozenset({"alice", "bob", "carol"})
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 0.0


@pytest.mark.unit
def test_whole_cohort_retained_returns_one(
    store: InMemoryActivityStore,
) -> None:
    """전원 잔존 — every user returned at or after D+30."""
    for user_id in ("alice", "bob", "carol"):
        _join(store, user_id, JOIN_TS)
        # Each user came back at D+31 (a magazine push hit).
        _revisit(store, user_id, JOIN_TS + timedelta(days=31))

    cohort = frozenset({"alice", "bob", "carol"})
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 1.0


# ---------------------------------------------------------------------------
# Mixed retention — the realistic case.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_partial_retention_returns_fraction(
    store: InMemoryActivityStore,
) -> None:
    """50% retention — 2 out of 4 users come back at D+30+."""
    for user_id in ("alice", "bob", "carol", "dave"):
        _join(store, user_id, JOIN_TS)

    # Two users return after the 30-day threshold.
    _revisit(store, "alice", JOIN_TS + timedelta(days=30))
    _revisit(store, "bob", JOIN_TS + timedelta(days=45))
    # Two users churn (no return events past D+30).
    _revisit(store, "carol", JOIN_TS + timedelta(days=2))
    # dave joined but never returned at all.

    cohort = frozenset({"alice", "bob", "carol", "dave"})
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 0.5


@pytest.mark.unit
def test_one_third_retention(store: InMemoryActivityStore) -> None:
    """A non-trivial fraction (1/3) — verify no floor/ceiling rounding."""
    for user_id in ("u1", "u2", "u3"):
        _join(store, user_id, JOIN_TS)
    _revisit(store, "u1", JOIN_TS + timedelta(days=40))

    cohort = frozenset({"u1", "u2", "u3"})
    rate = calculate_retention_rate(cohort, day_offset=30, store=store)
    assert rate == pytest.approx(1.0 / 3.0)


# ---------------------------------------------------------------------------
# Threshold boundary: D+N is "at or after", not "strictly after".
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_activity_exactly_at_threshold_is_retained(
    store: InMemoryActivityStore,
) -> None:
    """An event at exactly first_activity + day_offset counts as retained."""
    _join(store, "alice", JOIN_TS)
    _revisit(store, "alice", JOIN_TS + timedelta(days=30))  # exactly on D+30

    cohort = frozenset({"alice"})
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 1.0


@pytest.mark.unit
def test_activity_just_before_threshold_is_not_retained(
    store: InMemoryActivityStore,
) -> None:
    """One microsecond shy of D+30 means the user churned by this metric."""
    _join(store, "alice", JOIN_TS)
    _revisit(
        store,
        "alice",
        JOIN_TS + timedelta(days=30) - timedelta(microseconds=1),
    )

    cohort = frozenset({"alice"})
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 0.0


@pytest.mark.unit
def test_only_join_event_is_not_retention(
    store: InMemoryActivityStore,
) -> None:
    """The first activity itself is not a 'return' — pure new-user signups
    with no follow-up are churned at every D+N where N > 0."""
    _join(store, "alice", JOIN_TS)

    cohort = frozenset({"alice"})
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 0.0
    assert calculate_retention_rate(cohort, day_offset=1, store=store) == 0.0


# ---------------------------------------------------------------------------
# day_offset variations.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_day_offset_zero_counts_every_user_with_any_event(
    store: InMemoryActivityStore,
) -> None:
    """At D+0 the first activity itself satisfies `>= first_activity + 0d`."""
    for user_id in ("alice", "bob"):
        _join(store, user_id, JOIN_TS)
    cohort = frozenset({"alice", "bob"})
    assert calculate_retention_rate(cohort, day_offset=0, store=store) == 1.0


@pytest.mark.unit
def test_default_day_offset_is_thirty(
    store: InMemoryActivityStore,
) -> None:
    """The Seed Contract pins the secondary north-star window at 30 days."""
    _join(store, "alice", JOIN_TS)
    _revisit(store, "alice", JOIN_TS + timedelta(days=29))  # < 30, churn

    _join(store, "bob", JOIN_TS)
    _revisit(store, "bob", JOIN_TS + timedelta(days=30))  # exactly D+30, retain

    cohort = frozenset({"alice", "bob"})
    # Omitting day_offset must behave identically to passing 30.
    rate_default = calculate_retention_rate(cohort, store=store)
    rate_explicit = calculate_retention_rate(cohort, day_offset=30, store=store)
    assert rate_default == rate_explicit == 0.5


@pytest.mark.unit
def test_custom_day_offset_seven(store: InMemoryActivityStore) -> None:
    """A 7-day weekly retention check works the same way."""
    _join(store, "weekly", JOIN_TS)
    _revisit(store, "weekly", JOIN_TS + timedelta(days=8))

    cohort = frozenset({"weekly"})
    assert calculate_retention_rate(cohort, day_offset=7, store=store) == 1.0
    # The same user is *not* retained at D+30.
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 0.0


@pytest.mark.unit
def test_very_large_day_offset_returns_zero(
    store: InMemoryActivityStore,
) -> None:
    """A day_offset beyond any recorded event → zero retention, not crash."""
    _join(store, "alice", JOIN_TS)
    _revisit(store, "alice", JOIN_TS + timedelta(days=10))

    cohort = frozenset({"alice"})
    assert calculate_retention_rate(cohort, day_offset=365, store=store) == 0.0


# ---------------------------------------------------------------------------
# First-activity semantics — earliest timestamp, not insertion order.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_first_activity_uses_min_timestamp_not_insertion_order(
    store: InMemoryActivityStore,
) -> None:
    """Backfilled events with earlier timestamps still anchor D+30 correctly.

    Scenario: an offline-mode client uploaded its event queue after
    reconnecting, so a *later-uploaded* event has an *earlier* timestamp.
    The D+30 threshold must be measured from the true earliest event.
    """
    # Insert a later wall-clock event first, then a backfilled earlier one.
    later_ts = JOIN_TS + timedelta(days=10)
    earlier_ts = JOIN_TS - timedelta(days=5)
    _revisit(store, "backfilled", later_ts)
    _revisit(store, "backfilled", earlier_ts)

    cohort = frozenset({"backfilled"})
    # True first activity is JOIN_TS - 5d, so D+30 cutoff is JOIN_TS + 25d.
    # later_ts = JOIN_TS + 10d, which is BEFORE the cutoff → not retained.
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 0.0

    # But at D+15 (cutoff = JOIN_TS + 10d), later_ts ≥ cutoff → retained.
    assert calculate_retention_rate(cohort, day_offset=15, store=store) == 1.0


# ---------------------------------------------------------------------------
# Defensive: cohort member with no events in the store.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cohort_user_with_no_events_counted_as_churned(
    store: InMemoryActivityStore,
) -> None:
    """A cohort built from an external system may include user_ids with no
    events in *this* store (e.g. tracking gap, partial sync). Treat them as
    churned — never raise — so the metric stays robust under partial data."""
    _join(store, "alice", JOIN_TS)
    _revisit(store, "alice", JOIN_TS + timedelta(days=31))

    # 'ghost' is in the cohort but has zero events in the store.
    cohort = frozenset({"alice", "ghost"})
    rate = calculate_retention_rate(cohort, day_offset=30, store=store)
    assert rate == 0.5


# ---------------------------------------------------------------------------
# Cross-timezone correctness — comparison is by UTC instant.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cross_timezone_threshold_uses_utc_instant(
    store: InMemoryActivityStore,
) -> None:
    """First activity in KST, return event in UTC — D+30 still correct."""
    kst_join = datetime(2026, 1, 1, 9, 0, 0, tzinfo=KST)  # == UTC 2026-01-01 00:00
    _join(store, "kst-user", kst_join)
    # 30 days later in UTC.
    utc_return = datetime(2026, 1, 31, 0, 0, 0, tzinfo=UTC)
    _revisit(store, "kst-user", utc_return)

    cohort = frozenset({"kst-user"})
    assert calculate_retention_rate(cohort, day_offset=30, store=store) == 1.0


# ---------------------------------------------------------------------------
# Cohort container flexibility.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "container",
    [
        frozenset({"alice", "bob"}),
        {"alice", "bob"},
        ["alice", "bob"],
        ("alice", "bob"),
        # Duplicates in a list must not double-count.
        ["alice", "alice", "bob"],
    ],
)
def test_accepts_various_cohort_container_types(
    store: InMemoryActivityStore, container: object,
) -> None:
    _join(store, "alice", JOIN_TS)
    _revisit(store, "alice", JOIN_TS + timedelta(days=31))
    _join(store, "bob", JOIN_TS)
    # bob churns

    rate = calculate_retention_rate(container, day_offset=30, store=store)  # type: ignore[arg-type]
    assert rate == 0.5


# ---------------------------------------------------------------------------
# Return type and idempotency.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returns_python_float(store: InMemoryActivityStore) -> None:
    _join(store, "alice", JOIN_TS)
    _revisit(store, "alice", JOIN_TS + timedelta(days=31))
    rate = calculate_retention_rate(frozenset({"alice"}), store=store)
    assert isinstance(rate, float)
    assert 0.0 <= rate <= 1.0


@pytest.mark.unit
def test_repeated_calls_return_equal_results(
    store: InMemoryActivityStore,
) -> None:
    """Idempotent — no internal mutation between calls."""
    _join(store, "alice", JOIN_TS)
    _revisit(store, "alice", JOIN_TS + timedelta(days=31))
    _join(store, "bob", JOIN_TS)

    cohort = frozenset({"alice", "bob"})
    first = calculate_retention_rate(cohort, day_offset=30, store=store)
    second = calculate_retention_rate(cohort, day_offset=30, store=store)
    third = calculate_retention_rate(cohort, day_offset=30, store=store)
    assert first == second == third == 0.5


# ---------------------------------------------------------------------------
# Input validation: day_offset
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad",
    [
        30.0,        # float — must be int (timedelta-days are integer for clarity)
        "30",        # string
        None,
        [30],
        (30,),
    ],
)
def test_rejects_non_int_day_offset(
    store: InMemoryActivityStore, bad: object,
) -> None:
    with pytest.raises(TypeError):
        calculate_retention_rate(
            frozenset({"alice"}), day_offset=bad, store=store,  # type: ignore[arg-type]
        )


@pytest.mark.unit
@pytest.mark.parametrize("bad", [True, False])
def test_rejects_bool_day_offset(
    store: InMemoryActivityStore, bad: bool,
) -> None:
    """bool is an int subclass — True/False must not silently mean 1/0 days."""
    with pytest.raises(TypeError):
        calculate_retention_rate(
            frozenset({"alice"}), day_offset=bad, store=store,  # type: ignore[arg-type]
        )


@pytest.mark.unit
@pytest.mark.parametrize("bad", [-1, -30, -100])
def test_rejects_negative_day_offset(
    store: InMemoryActivityStore, bad: int,
) -> None:
    with pytest.raises(ValueError):
        calculate_retention_rate(
            frozenset({"alice"}), day_offset=bad, store=store,
        )


# ---------------------------------------------------------------------------
# Input validation: cohort
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rejects_bare_string_cohort(store: InMemoryActivityStore) -> None:
    """A bare str is iterable-of-chars — never what the caller meant."""
    with pytest.raises(TypeError):
        calculate_retention_rate("alice", store=store)  # type: ignore[arg-type]


@pytest.mark.unit
def test_rejects_bytes_cohort(store: InMemoryActivityStore) -> None:
    with pytest.raises(TypeError):
        calculate_retention_rate(b"alice", store=store)  # type: ignore[arg-type]


@pytest.mark.unit
@pytest.mark.parametrize("bad", [123, 1.5, None])
def test_rejects_non_iterable_cohort(
    store: InMemoryActivityStore, bad: object,
) -> None:
    with pytest.raises(TypeError):
        calculate_retention_rate(bad, store=store)  # type: ignore[arg-type]


@pytest.mark.unit
def test_rejects_cohort_with_non_string_member(
    store: InMemoryActivityStore,
) -> None:
    with pytest.raises(TypeError):
        calculate_retention_rate(
            ["alice", 123, "bob"], store=store,  # type: ignore[list-item]
        )


@pytest.mark.unit
@pytest.mark.parametrize("empty", ["", " ", "\t\n"])
def test_rejects_cohort_with_empty_user_id(
    store: InMemoryActivityStore, empty: str,
) -> None:
    with pytest.raises(ValueError):
        calculate_retention_rate({"alice", empty}, store=store)
