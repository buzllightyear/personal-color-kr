"""Unit tests for `track_user_activity` (Sub-AC 7.1).

The contract under test:

    track_user_activity(user_id, timestamp, *, store) records a user-activity
    event into `store`, and on retrieval the stored event has *exactly* the
    user_id and timestamp that were passed in.

Branch coverage targets:
  - happy path persistence (the AC-required check)
  - multiple events for one user, preserved in order
  - events for distinct users, separable by user_id query
  - user_id input validation (type + emptiness)
  - timestamp input validation (type + tz-awareness)
  - the returned event matches the stored event
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from retention.activity_tracker import (
    ActivityEvent,
    InMemoryActivityStore,
    track_user_activity,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def store() -> InMemoryActivityStore:
    return InMemoryActivityStore()


@pytest.fixture
def ts() -> datetime:
    # A specific, reproducible, tz-aware timestamp.
    return datetime(2026, 5, 16, 12, 30, 45, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Sub-AC 7.1 core: user_id and timestamp are persisted *exactly*.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_persists_user_id_and_timestamp_exactly(
    store: InMemoryActivityStore,
    ts: datetime,
) -> None:
    track_user_activity("user-123", ts, store=store)

    events = store.list_events()
    assert len(events) == 1
    assert events[0].user_id == "user-123"
    assert events[0].timestamp == ts
    # Identity-level check on timestamp: same instant, same tzinfo.
    assert events[0].timestamp.tzinfo is ts.tzinfo


@pytest.mark.unit
def test_returns_persisted_event(
    store: InMemoryActivityStore,
    ts: datetime,
) -> None:
    returned = track_user_activity("user-123", ts, store=store)

    assert isinstance(returned, ActivityEvent)
    # The returned event is equal-by-value to what the store holds.
    assert store.list_events() == (returned,)
    assert returned.user_id == "user-123"
    assert returned.timestamp == ts


@pytest.mark.unit
def test_event_is_immutable(
    store: InMemoryActivityStore,
    ts: datetime,
) -> None:
    event = track_user_activity("user-123", ts, store=store)
    # Frozen dataclass — mutating user_id must raise.
    with pytest.raises(
        Exception
    ):  # FrozenInstanceError is a subclass of AttributeError
        event.user_id = "evil"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Multiple events for one user — order is preserved.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_multiple_events_preserved_in_insertion_order(
    store: InMemoryActivityStore,
) -> None:
    t0 = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)
    t1 = t0 + timedelta(minutes=5)
    t2 = t0 + timedelta(minutes=10)

    track_user_activity("user-123", t0, store=store)
    track_user_activity("user-123", t1, store=store)
    track_user_activity("user-123", t2, store=store)

    events = store.list_events()
    assert [e.timestamp for e in events] == [t0, t1, t2]
    assert all(e.user_id == "user-123" for e in events)


@pytest.mark.unit
def test_list_events_for_user_returns_only_that_users_events(
    store: InMemoryActivityStore,
    ts: datetime,
) -> None:
    track_user_activity("alice", ts, store=store)
    track_user_activity("bob", ts + timedelta(seconds=1), store=store)
    track_user_activity("alice", ts + timedelta(seconds=2), store=store)
    track_user_activity("carol", ts + timedelta(seconds=3), store=store)

    alice_events = store.list_events_for_user("alice")
    assert len(alice_events) == 2
    assert all(e.user_id == "alice" for e in alice_events)
    assert [e.timestamp for e in alice_events] == [
        ts,
        ts + timedelta(seconds=2),
    ]

    bob_events = store.list_events_for_user("bob")
    assert len(bob_events) == 1
    assert bob_events[0].user_id == "bob"

    # Unknown user → empty.
    assert store.list_events_for_user("nobody") == ()


@pytest.mark.unit
def test_store_isolation_between_instances(ts: datetime) -> None:
    """Two stores must not share state — preserves test isolation."""
    store_a = InMemoryActivityStore()
    store_b = InMemoryActivityStore()
    track_user_activity("user-a", ts, store=store_a)
    assert len(store_a.list_events()) == 1
    assert len(store_b.list_events()) == 0


# ---------------------------------------------------------------------------
# Timezone-awareness: same wall-clock different zone → distinct UTC instants.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_timezone_preserved_in_stored_event(
    store: InMemoryActivityStore,
) -> None:
    kst = timezone(timedelta(hours=9))
    kst_ts = datetime(2026, 5, 16, 21, 30, 45, tzinfo=kst)
    track_user_activity("user-kst", kst_ts, store=store)

    [event] = store.list_events()
    assert event.timestamp == kst_ts
    # Stored timestamp converts to the *same* UTC instant.
    assert event.timestamp.astimezone(timezone.utc) == datetime(
        2026,
        5,
        16,
        12,
        30,
        45,
        tzinfo=timezone.utc,
    )


# ---------------------------------------------------------------------------
# user_id input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad_user_id",
    [123, 12.5, None, b"user-bytes", ["user"], {"id": "x"}],
)
def test_rejects_non_string_user_id(
    store: InMemoryActivityStore,
    ts: datetime,
    bad_user_id: object,
) -> None:
    with pytest.raises(TypeError):
        track_user_activity(bad_user_id, ts, store=store)  # type: ignore[arg-type]
    assert store.list_events() == ()


@pytest.mark.unit
@pytest.mark.parametrize("empty_user_id", ["", " ", "\t\n", "   "])
def test_rejects_empty_user_id(
    store: InMemoryActivityStore,
    ts: datetime,
    empty_user_id: str,
) -> None:
    with pytest.raises(ValueError):
        track_user_activity(empty_user_id, ts, store=store)
    assert store.list_events() == ()


# ---------------------------------------------------------------------------
# timestamp input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad_timestamp",
    [
        1747405845,  # unix int — must use datetime
        1747405845.0,  # unix float
        "2026-05-16T12:30:45",  # ISO string — must be parsed by caller
        None,
        (2026, 5, 16),
    ],
)
def test_rejects_non_datetime_timestamp(
    store: InMemoryActivityStore,
    bad_timestamp: object,
) -> None:
    with pytest.raises(TypeError):
        track_user_activity("user-1", bad_timestamp, store=store)  # type: ignore[arg-type]
    assert store.list_events() == ()


@pytest.mark.unit
def test_rejects_naive_datetime() -> None:
    """Naive datetimes silently corrupt the retention cohort window — reject."""
    store = InMemoryActivityStore()
    naive = datetime(2026, 5, 16, 12, 30, 45)  # no tzinfo
    with pytest.raises(ValueError):
        track_user_activity("user-1", naive, store=store)
    assert store.list_events() == ()


# ---------------------------------------------------------------------------
# Store contract — append rejects non-events to keep the store honest.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_in_memory_store_rejects_non_event_append() -> None:
    store = InMemoryActivityStore()
    with pytest.raises(TypeError):
        store.append(("user-1", datetime.now(timezone.utc)))  # type: ignore[arg-type]
    assert store.list_events() == ()
