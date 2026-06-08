"""AC7: Trend entity CRUD + FK connections.

Acceptance criteria verified
-----------------------------
AC7: trend 독립 entity CRUD. recipe와 drop이 trend_id FK로 연결.
     call_log의 trend_id는 nullable (사후 backfill API 동작 검증).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from api.trend.model import (
    InMemoryTrendCallLogRepository,
    InMemoryTrendRepository,
    PreemptOrFollowTag,
    TrendCallLogCreateInput,
    TrendCreateInput,
    TrendRecord,
    TrendStatus,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_trend_input(name: str = "Y2K 글리터") -> TrendCreateInput:
    return TrendCreateInput(name=name)


def _make_call_log_input(
    trend_id: uuid.UUID | None = None,
) -> TrendCallLogCreateInput:
    return TrendCallLogCreateInput(
        trend_desc="Y2K 글리터가 곧 뜰 것 같다",
        preempt_or_follow_tag=PreemptOrFollowTag.PREEMPT,
        predicted_at=datetime.now(timezone.utc),
        trend_id=trend_id,
    )


# ---------------------------------------------------------------------------
# AC7: Trend CRUD
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_trend_returns_record_with_id() -> None:
    """CREATE trend returns a record with non-None UUID trend_id."""
    repo = InMemoryTrendRepository()
    record = repo.create(_make_trend_input("Y2K 글리터"))

    assert record.trend_id is not None
    assert isinstance(record.trend_id, uuid.UUID)
    assert record.name == "Y2K 글리터"
    assert record.status == TrendStatus.PREDICTED


@pytest.mark.unit
def test_read_trend_by_id() -> None:
    """READ trend by trend_id returns the created record."""
    repo = InMemoryTrendRepository()
    created = repo.create(_make_trend_input())

    fetched = repo.find_by_id(created.trend_id)

    assert fetched is not None
    assert fetched.trend_id == created.trend_id
    assert fetched.name == created.name


@pytest.mark.unit
def test_read_nonexistent_trend_returns_none() -> None:
    """READ with unknown ID returns None."""
    repo = InMemoryTrendRepository()
    result = repo.find_by_id(uuid.uuid4())
    assert result is None


@pytest.mark.unit
def test_update_trend_name() -> None:
    """UPDATE trend name changes the record."""
    repo = InMemoryTrendRepository()
    created = repo.create(_make_trend_input("original name"))

    updated = repo.update_name(created.trend_id, "updated name")

    assert updated is not None
    assert updated.name == "updated name"
    assert repo.find_by_id(created.trend_id).name == "updated name"


@pytest.mark.unit
def test_delete_trend_removes_record() -> None:
    """DELETE removes trend and subsequent read returns None."""
    repo = InMemoryTrendRepository()
    created = repo.create(_make_trend_input())

    deleted = repo.delete(created.trend_id)

    assert deleted is True
    assert repo.find_by_id(created.trend_id) is None


@pytest.mark.unit
def test_delete_nonexistent_trend_returns_false() -> None:
    """DELETE of unknown ID returns False (idempotent)."""
    repo = InMemoryTrendRepository()
    result = repo.delete(uuid.uuid4())
    assert result is False


# ---------------------------------------------------------------------------
# AC7: trend status transitions (operator manual)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_transition_predicted_to_active() -> None:
    """Operator can transition trend from predicted → active."""
    repo = InMemoryTrendRepository()
    trend = repo.create(_make_trend_input())
    assert trend.status == TrendStatus.PREDICTED

    updated = repo.transition_status(trend.trend_id, TrendStatus.ACTIVE, "operator_singleton")

    assert updated is not None
    assert updated.status == TrendStatus.ACTIVE
    assert len(updated.status_transitions) == 1
    assert updated.status_transitions[0].from_status == TrendStatus.PREDICTED
    assert updated.status_transitions[0].to_status == TrendStatus.ACTIVE


@pytest.mark.unit
def test_transition_active_to_expired() -> None:
    """Operator can transition trend from active → expired."""
    repo = InMemoryTrendRepository()
    trend = repo.create(_make_trend_input())
    repo.transition_status(trend.trend_id, TrendStatus.ACTIVE, "operator_singleton")
    updated = repo.transition_status(trend.trend_id, TrendStatus.EXPIRED, "operator_singleton")

    assert updated.status == TrendStatus.EXPIRED
    assert len(updated.status_transitions) == 2


@pytest.mark.unit
def test_invalid_transition_raises_value_error() -> None:
    """Invalid transition (predicted → expired) raises ValueError."""
    repo = InMemoryTrendRepository()
    trend = repo.create(_make_trend_input())

    with pytest.raises(ValueError, match="Invalid trend status transition"):
        repo.transition_status(trend.trend_id, TrendStatus.EXPIRED, "operator_singleton")


# ---------------------------------------------------------------------------
# AC7: FK connections — call_log trend_id nullable + backfill
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_call_log_can_be_created_with_null_trend_id() -> None:
    """trend_call_log can be created with trend_id=None (pre-trend prediction)."""
    call_log_repo = InMemoryTrendCallLogRepository()
    log = call_log_repo.create(_make_call_log_input(trend_id=None))

    assert log.trend_id is None
    assert log.log_id is not None


@pytest.mark.unit
def test_backfill_trend_id_on_call_log() -> None:
    """Backfill API links trend_id to a call log after trend entity is created."""
    trend_repo = InMemoryTrendRepository()
    call_log_repo = InMemoryTrendCallLogRepository()

    # Create call log without trend
    log = call_log_repo.create(_make_call_log_input(trend_id=None))
    assert log.trend_id is None

    # Create trend
    trend = trend_repo.create(_make_trend_input())

    # Backfill
    updated = call_log_repo.backfill_trend_id(log.log_id, trend.trend_id)

    assert updated is not None
    assert updated.trend_id == trend.trend_id
    assert updated.backfilled_at is not None


@pytest.mark.unit
def test_call_log_can_be_created_with_trend_id() -> None:
    """trend_call_log can reference an existing trend_id directly."""
    trend_repo = InMemoryTrendRepository()
    call_log_repo = InMemoryTrendCallLogRepository()

    trend = trend_repo.create(_make_trend_input())
    log = call_log_repo.create(_make_call_log_input(trend_id=trend.trend_id))

    assert log.trend_id == trend.trend_id
