"""AC9: Trend call log hit marking + accuracy rate computation.

Acceptance criteria verified
-----------------------------
AC9: hit_confirmed 사후 마킹 API + 적중률 집계 함수
     (preempt 태그 call_log 중 hit_confirmed=true 비율).
     call_log level 집계 (trend level 속성 아님).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from api.trend.model import (
    InMemoryTrendCallLogRepository,
    PreemptOrFollowTag,
    TrendCallLogCreateInput,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _input(
    tag: PreemptOrFollowTag = PreemptOrFollowTag.PREEMPT,
) -> TrendCallLogCreateInput:
    return TrendCallLogCreateInput(
        trend_desc="Test trend prediction",
        preempt_or_follow_tag=tag,
        predicted_at=datetime.now(timezone.utc),
        trend_id=None,
    )


# ---------------------------------------------------------------------------
# AC9: hit marking
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_mark_hit_confirmed_true() -> None:
    """mark_hit_confirmed sets hit_confirmed=True on the log entry."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input())
    assert log.hit_confirmed is False

    updated = repo.mark_hit_confirmed(log.log_id, confirmed=True)

    assert updated is not None
    assert updated.hit_confirmed is True
    assert repo.find_by_id(log.log_id).hit_confirmed is True


@pytest.mark.unit
def test_mark_hit_confirmed_false() -> None:
    """mark_hit_confirmed can set hit_confirmed=False (correction)."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input())
    repo.mark_hit_confirmed(log.log_id, confirmed=True)

    updated = repo.mark_hit_confirmed(log.log_id, confirmed=False)
    assert updated.hit_confirmed is False


@pytest.mark.unit
def test_mark_hit_confirmed_returns_none_for_unknown_id() -> None:
    """mark_hit_confirmed returns None when log_id not found."""
    repo = InMemoryTrendCallLogRepository()
    result = repo.mark_hit_confirmed(uuid.uuid4())
    assert result is None


# ---------------------------------------------------------------------------
# AC9: hit rate computation (north star metric)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_preempt_hit_rate_with_all_confirmed() -> None:
    """3 preempt logs all confirmed → hit rate = 1.0."""
    repo = InMemoryTrendCallLogRepository()
    for _ in range(3):
        log = repo.create(_input(tag=PreemptOrFollowTag.PREEMPT))
        repo.mark_hit_confirmed(log.log_id, confirmed=True)

    rate = repo.compute_preempt_hit_rate()
    assert rate == 1.0


@pytest.mark.unit
def test_preempt_hit_rate_partial() -> None:
    """2 preempt logs, 1 confirmed → hit rate = 0.5."""
    repo = InMemoryTrendCallLogRepository()
    log1 = repo.create(_input(tag=PreemptOrFollowTag.PREEMPT))
    log2 = repo.create(_input(tag=PreemptOrFollowTag.PREEMPT))
    repo.mark_hit_confirmed(log1.log_id, confirmed=True)
    # log2 stays hit_confirmed=False

    rate = repo.compute_preempt_hit_rate()
    assert rate == pytest.approx(0.5)


@pytest.mark.unit
def test_preempt_hit_rate_none_confirmed() -> None:
    """2 preempt logs, none confirmed → hit rate = 0.0."""
    repo = InMemoryTrendCallLogRepository()
    repo.create(_input(tag=PreemptOrFollowTag.PREEMPT))
    repo.create(_input(tag=PreemptOrFollowTag.PREEMPT))

    rate = repo.compute_preempt_hit_rate()
    assert rate == 0.0


@pytest.mark.unit
def test_preempt_hit_rate_ignores_follow_logs() -> None:
    """Follow-tagged logs are excluded from the preempt hit rate calculation."""
    repo = InMemoryTrendCallLogRepository()
    # 1 preempt confirmed
    preempt_log = repo.create(_input(tag=PreemptOrFollowTag.PREEMPT))
    repo.mark_hit_confirmed(preempt_log.log_id, confirmed=True)

    # 3 follow logs confirmed (should not affect preempt rate)
    for _ in range(3):
        follow_log = repo.create(_input(tag=PreemptOrFollowTag.FOLLOW))
        repo.mark_hit_confirmed(follow_log.log_id, confirmed=True)

    rate = repo.compute_preempt_hit_rate()
    assert rate == 1.0  # 1/1 preempt


@pytest.mark.unit
def test_preempt_hit_rate_returns_none_when_no_preempt_logs() -> None:
    """No preempt logs → hit rate is None (undefined, not 0)."""
    repo = InMemoryTrendCallLogRepository()
    # Only follow logs
    repo.create(_input(tag=PreemptOrFollowTag.FOLLOW))

    rate = repo.compute_preempt_hit_rate()
    assert rate is None


@pytest.mark.unit
def test_preempt_hit_rate_empty_repo() -> None:
    """Empty repo → hit rate is None."""
    repo = InMemoryTrendCallLogRepository()
    assert repo.compute_preempt_hit_rate() is None


@pytest.mark.unit
def test_hit_rate_is_computed_on_demand_not_stored() -> None:
    """Hit rate is computed on-demand each time (not a stored snapshot)."""
    repo = InMemoryTrendCallLogRepository()
    log = repo.create(_input(tag=PreemptOrFollowTag.PREEMPT))

    rate_before = repo.compute_preempt_hit_rate()
    assert rate_before == 0.0

    repo.mark_hit_confirmed(log.log_id, confirmed=True)
    rate_after = repo.compute_preempt_hit_rate()
    assert rate_after == 1.0

    # Each call reflects current state (not snapshot)
    assert rate_before != rate_after
