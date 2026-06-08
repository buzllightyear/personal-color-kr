"""AC8: Trend call log CRUD.

Acceptance criteria verified
-----------------------------
AC8: operator가 예측 기록(trend_desc, preempt_or_follow_tag, predicted_at)
     생성·조회·수정·삭제. trend_id null 상태로 생성 가능.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from api.trend.model import (
    InMemoryTrendCallLogRepository,
    PreemptOrFollowTag,
    TrendCallLogCreateInput,
    TrendCallLogRecord,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _input(
    desc: str = "Y2K 글리터 예측",
    tag: PreemptOrFollowTag = PreemptOrFollowTag.PREEMPT,
    trend_id: uuid.UUID | None = None,
) -> TrendCallLogCreateInput:
    return TrendCallLogCreateInput(
        trend_desc=desc,
        preempt_or_follow_tag=tag,
        predicted_at=datetime.now(timezone.utc),
        trend_id=trend_id,
    )


# ---------------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_call_log_returns_record_with_id() -> None:
    """CREATE returns TrendCallLogRecord with auto-generated log_id."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input())

    assert log.log_id is not None
    assert isinstance(log.log_id, uuid.UUID)
    assert log.trend_desc == "Y2K 글리터 예측"
    assert log.preempt_or_follow_tag == PreemptOrFollowTag.PREEMPT
    assert log.trend_id is None
    assert log.hit_confirmed is False


@pytest.mark.unit
def test_create_call_log_with_null_trend_id() -> None:
    """CREATE with trend_id=None is valid (pre-trend call)."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input(trend_id=None))
    assert log.trend_id is None


@pytest.mark.unit
def test_create_call_log_with_follow_tag() -> None:
    """CREATE with preempt_or_follow_tag=FOLLOW."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input(tag=PreemptOrFollowTag.FOLLOW))
    assert log.preempt_or_follow_tag == PreemptOrFollowTag.FOLLOW


# ---------------------------------------------------------------------------
# READ
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_read_call_log_by_id() -> None:
    """READ by log_id returns the created record."""
    repo = InMemoryTrendCallLogRepository()
    created = repo.create(_input())
    fetched = repo.find_by_id(created.log_id)

    assert fetched is not None
    assert fetched.log_id == created.log_id
    assert fetched.trend_desc == created.trend_desc


@pytest.mark.unit
def test_read_all_call_logs() -> None:
    """READ all returns all created logs."""
    repo = InMemoryTrendCallLogRepository()
    repo.create(_input("prediction 1"))
    repo.create(_input("prediction 2"))
    all_logs = repo.all()
    assert len(all_logs) == 2


@pytest.mark.unit
def test_read_nonexistent_log_returns_none() -> None:
    """READ with unknown ID returns None."""
    repo = InMemoryTrendCallLogRepository()
    result = repo.find_by_id(uuid.uuid4())
    assert result is None


# ---------------------------------------------------------------------------
# UPDATE
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_update_trend_desc() -> None:
    """UPDATE trend_desc modifies the stored record."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input("original desc"))

    updated = repo.update_trend_desc(log.log_id, "updated desc")

    assert updated is not None
    assert updated.trend_desc == "updated desc"
    assert repo.find_by_id(log.log_id).trend_desc == "updated desc"


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_delete_call_log() -> None:
    """DELETE removes the log and subsequent read returns None."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input())

    deleted = repo.delete(log.log_id)

    assert deleted is True
    assert repo.find_by_id(log.log_id) is None


@pytest.mark.unit
def test_delete_nonexistent_log_returns_false() -> None:
    """DELETE of unknown ID is idempotent."""
    repo = InMemoryTrendCallLogRepository()
    assert repo.delete(uuid.uuid4()) is False
