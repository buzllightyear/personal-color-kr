"""AC15: Payment funnel gates — stage 4 and stage 10 blocking.

Acceptance criteria verified
-----------------------------
AC15: stage 4(iOS 별점)와 stage 10(1명 추천)은 조건 미충족 시 다음 단계 차단.
      게이트 통과/차단 각 1케이스 테스트.
"""

from __future__ import annotations

import pytest

from api.payment.funnel import (
    GateBlockedError,
    PaymentFunnelStage,
    check_stage_10_referral_gate,
    check_stage_4_ios_rating_gate,
)


# ---------------------------------------------------------------------------
# AC15: Stage 4 (iOS rating) gate
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stage_4_gate_passes_when_rated() -> None:
    """Stage 4 gate passes when user has completed iOS rating."""
    # No exception = gate passes
    check_stage_4_ios_rating_gate(has_rated=True)


@pytest.mark.unit
def test_stage_4_gate_blocks_when_not_rated() -> None:
    """Stage 4 gate blocks when user has NOT completed iOS rating."""
    with pytest.raises(GateBlockedError) as exc_info:
        check_stage_4_ios_rating_gate(has_rated=False)

    assert exc_info.value.stage == PaymentFunnelStage.iOS_별점_게이트


# ---------------------------------------------------------------------------
# AC15: Stage 10 (1-friend referral) gate
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stage_10_gate_passes_when_referred_one_friend() -> None:
    """Stage 10 gate passes when user has referred at least 1 friend."""
    check_stage_10_referral_gate(referral_count=1)


@pytest.mark.unit
def test_stage_10_gate_passes_with_multiple_referrals() -> None:
    """Stage 10 gate passes with more than 1 referral."""
    check_stage_10_referral_gate(referral_count=3)


@pytest.mark.unit
def test_stage_10_gate_blocks_with_zero_referrals() -> None:
    """Stage 10 gate blocks when user has 0 referrals."""
    with pytest.raises(GateBlockedError) as exc_info:
        check_stage_10_referral_gate(referral_count=0)

    assert exc_info.value.stage == PaymentFunnelStage.추천_게이트


# ---------------------------------------------------------------------------
# GateBlockedError is an Exception subclass
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_gate_blocked_error_is_exception_subclass() -> None:
    """GateBlockedError inherits from Exception."""
    assert issubclass(GateBlockedError, Exception)


@pytest.mark.unit
def test_gate_blocked_error_has_stage_attribute() -> None:
    """GateBlockedError carries stage info for error handling."""
    err = GateBlockedError(PaymentFunnelStage.iOS_별점_게이트, "reason")
    assert err.stage == PaymentFunnelStage.iOS_별점_게이트
