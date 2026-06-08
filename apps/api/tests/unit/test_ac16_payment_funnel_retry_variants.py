"""AC16: Payment funnel retry + variants — stage 11 and stage 12.

Acceptance criteria verified
-----------------------------
AC16: stage 11: 미결제 유저 재진입 로직 동작.
      stage 12: $12/월과 $59/연 선택지 제시.
"""

from __future__ import annotations

import pytest

from api.payment.funnel import (
    ANNUAL_PLAN,
    MONTHLY_PLAN,
    Stage11ReentryResult,
    check_stage_11_reentry,
    get_stage_12_options,
)


# ---------------------------------------------------------------------------
# AC16: Stage 11 re-entry for unpaid users
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stage_11_reentry_for_unpaid_user() -> None:
    """Stage 11: unpaid user gets re-entry with retry=True."""
    result = check_stage_11_reentry(has_paid=False)

    assert isinstance(result, Stage11ReentryResult)
    assert result.should_retry is True
    assert result.message  # non-empty retry message


@pytest.mark.unit
def test_stage_11_no_reentry_for_paid_user() -> None:
    """Stage 11: paid user does not get re-entry."""
    result = check_stage_11_reentry(has_paid=True)

    assert result.should_retry is False


@pytest.mark.unit
def test_stage_11_reentry_message_mentions_annual_offer() -> None:
    """Stage 11 re-entry message mentions the annual trial offer."""
    result = check_stage_11_reentry(has_paid=False)
    # Should mention the free trial offer
    assert "37" in result.message or "free" in result.message.lower() or "trial" in result.message.lower()


# ---------------------------------------------------------------------------
# AC16: Stage 12 — $12/월 and $59/연 options
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stage_12_returns_two_options() -> None:
    """Stage 12 presents exactly two payment options."""
    options = get_stage_12_options()
    assert len(options) == 2


@pytest.mark.unit
def test_stage_12_has_monthly_plan() -> None:
    """Stage 12 includes the $12/월 monthly plan option."""
    options = get_stage_12_options()
    plans = {opt.plan for opt in options}
    assert "monthly" in plans


@pytest.mark.unit
def test_stage_12_has_annual_plan() -> None:
    """Stage 12 includes the $59/연 annual plan option."""
    options = get_stage_12_options()
    plans = {opt.plan for opt in options}
    assert "annual" in plans


@pytest.mark.unit
def test_monthly_plan_price() -> None:
    """Monthly plan is $12 USD."""
    assert MONTHLY_PLAN.price_usd == 12.0
    assert MONTHLY_PLAN.plan == "monthly"


@pytest.mark.unit
def test_annual_plan_price_and_trial() -> None:
    """Annual plan is $59 USD with 37-day free trial."""
    assert ANNUAL_PLAN.price_usd == 59.0
    assert ANNUAL_PLAN.trial_days == 37
    assert ANNUAL_PLAN.plan == "annual"
