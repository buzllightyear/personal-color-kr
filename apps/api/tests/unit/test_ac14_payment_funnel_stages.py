"""AC14: Payment funnel stage enum + entry/completion event logging.

Acceptance criteria verified
-----------------------------
AC14: payment_funnel_stage enum(12단계) 존재.
      유저 stage N→N+1 진행 시 entry·completion 이벤트가
      payment_funnel_event에 로깅.
      임의 stage 진입·완료 이벤트 쌍 검증.
"""

from __future__ import annotations

import uuid

import pytest

from api.payment.funnel import (
    InMemoryFunnelEventLog,
    PaymentFunnelStage,
)

# ---------------------------------------------------------------------------
# AC14: 12-stage enum exists
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_payment_funnel_has_12_stages() -> None:
    """PaymentFunnelStage enum has exactly 12 stages."""
    stages = list(PaymentFunnelStage)
    assert len(stages) == 12


@pytest.mark.unit
def test_all_12_stages_have_correct_values() -> None:
    """All 12 stages map to integer values 1-12."""
    expected_values = set(range(1, 13))
    actual_values = {stage.value for stage in PaymentFunnelStage}
    assert actual_values == expected_values


@pytest.mark.unit
def test_stage_names_match_korean_market_spec() -> None:
    """Stage names match the Korean market funnel specification."""
    assert PaymentFunnelStage.가치_제시.value == 1
    assert PaymentFunnelStage.결과_프리뷰.value == 2
    assert PaymentFunnelStage.사회적_증거.value == 3
    assert PaymentFunnelStage.iOS_별점_게이트.value == 4
    assert PaymentFunnelStage.긴급성_희소성.value == 5
    assert PaymentFunnelStage.기능_비교.value == 6
    assert PaymentFunnelStage.가격_앵커링.value == 7
    assert PaymentFunnelStage.리스크_역전.value == 8
    assert PaymentFunnelStage.보너스_스택.value == 9
    assert PaymentFunnelStage.추천_게이트.value == 10
    assert PaymentFunnelStage.단계_진화.value == 11
    assert PaymentFunnelStage.결제_모델_변형.value == 12


# ---------------------------------------------------------------------------
# AC14: event logging
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stage_entry_event_logged() -> None:
    """Entering a stage logs an 'entry' event."""
    log = InMemoryFunnelEventLog()
    user_id = uuid.uuid4()

    event = log.log_entry(user_id, PaymentFunnelStage.가치_제시)

    assert event.event_type == "entry"
    assert event.stage == PaymentFunnelStage.가치_제시
    assert event.user_id == user_id
    assert event.event_id is not None
    assert event.occurred_at is not None


@pytest.mark.unit
def test_stage_completion_event_logged() -> None:
    """Completing a stage logs a 'completion' event."""
    log = InMemoryFunnelEventLog()
    user_id = uuid.uuid4()

    event = log.log_completion(user_id, PaymentFunnelStage.가치_제시)

    assert event.event_type == "completion"
    assert event.stage == PaymentFunnelStage.가치_제시
    assert event.user_id == user_id


@pytest.mark.unit
def test_stage_entry_and_completion_pair_logged() -> None:
    """A full stage: entry event + completion event pair is logged."""
    log = InMemoryFunnelEventLog()
    user_id = uuid.uuid4()

    log.log_entry(user_id, PaymentFunnelStage.결과_프리뷰)
    log.log_completion(user_id, PaymentFunnelStage.결과_프리뷰)

    user_events = log.events_for_user(user_id)
    assert len(user_events) == 2

    types = {e.event_type for e in user_events}
    assert types == {"entry", "completion"}

    stages = {e.stage for e in user_events}
    assert stages == {PaymentFunnelStage.결과_프리뷰}


@pytest.mark.unit
def test_multiple_stages_logged_for_user() -> None:
    """User progressing through 3 stages creates 6 events (3 entry + 3 completion)."""
    log = InMemoryFunnelEventLog()
    user_id = uuid.uuid4()

    for stage in [
        PaymentFunnelStage.가치_제시,
        PaymentFunnelStage.결과_프리뷰,
        PaymentFunnelStage.사회적_증거,
    ]:
        log.log_entry(user_id, stage)
        log.log_completion(user_id, stage)

    user_events = log.events_for_user(user_id)
    assert len(user_events) == 6


@pytest.mark.unit
def test_events_from_different_users_are_isolated() -> None:
    """Events from different users don't mix in per-user queries."""
    log = InMemoryFunnelEventLog()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    log.log_entry(user_a, PaymentFunnelStage.가치_제시)
    log.log_entry(user_b, PaymentFunnelStage.결과_프리뷰)

    assert len(log.events_for_user(user_a)) == 1
    assert len(log.events_for_user(user_b)) == 1
    assert log.events_for_user(user_a)[0].stage == PaymentFunnelStage.가치_제시
    assert log.events_for_user(user_b)[0].stage == PaymentFunnelStage.결과_프리뷰
