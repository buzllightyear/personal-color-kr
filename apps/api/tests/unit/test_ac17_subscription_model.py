"""AC17: Subscription model state transitions.

Acceptance criteria verified
-----------------------------
AC17: $12/월 구독 생성, $59/연 구독 생성,
      연결제 7일+30일 무료체험(총 37일) 타이머,
      구독 만료·갱신 전이 테스트.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from api.payment.subscription import (
    ANNUAL_TRIAL_DAYS,
    SubscriptionPlan,
    SubscriptionStatus,
    activate_subscription,
    create_annual_subscription,
    create_monthly_subscription,
    expire_subscription,
    is_trial_active,
    renew_subscription,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _user_id() -> uuid.UUID:
    return uuid.uuid4()


# ---------------------------------------------------------------------------
# AC17: Monthly subscription creation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_monthly_subscription() -> None:
    """$12/월 monthly subscription is created in ACTIVE status (no trial)."""
    now = _now()
    sub = create_monthly_subscription(_user_id(), now=now)

    assert sub.plan == SubscriptionPlan.MONTHLY
    assert sub.status == SubscriptionStatus.ACTIVE
    assert sub.trial_ends_at is None
    assert sub.current_period_ends_at == now + timedelta(days=30)


@pytest.mark.unit
def test_monthly_subscription_has_no_trial() -> None:
    """Monthly subscription has no trial period (trial_ends_at is None)."""
    sub = create_monthly_subscription(_user_id())
    assert sub.trial_ends_at is None


# ---------------------------------------------------------------------------
# AC17: Annual subscription creation with 37-day trial
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_annual_subscription() -> None:
    """$59/연 annual subscription is created in TRIAL status."""
    now = _now()
    sub = create_annual_subscription(_user_id(), now=now)

    assert sub.plan == SubscriptionPlan.ANNUAL
    assert sub.status == SubscriptionStatus.TRIAL
    assert sub.trial_ends_at is not None


@pytest.mark.unit
def test_annual_subscription_trial_is_37_days() -> None:
    """Annual subscription trial period is exactly 37 days (7 + 30)."""
    now = _now()
    sub = create_annual_subscription(_user_id(), now=now)

    assert ANNUAL_TRIAL_DAYS == 37
    expected_trial_end = now + timedelta(days=37)
    # Allow 1 second tolerance for test timing
    assert abs((sub.trial_ends_at - expected_trial_end).total_seconds()) < 1


@pytest.mark.unit
def test_trial_active_during_trial_period() -> None:
    """is_trial_active returns True while within trial period."""
    now = _now()
    sub = create_annual_subscription(_user_id(), now=now)

    # 1 day into trial
    one_day_later = now + timedelta(days=1)
    assert is_trial_active(sub, now=one_day_later) is True


@pytest.mark.unit
def test_trial_not_active_after_trial_ends() -> None:
    """is_trial_active returns False after trial period ends."""
    now = _now()
    sub = create_annual_subscription(_user_id(), now=now)

    # 38 days later (trial expired)
    after_trial = now + timedelta(days=38)
    assert is_trial_active(sub, now=after_trial) is False


# ---------------------------------------------------------------------------
# AC17: Subscription state transitions (expire and renew)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_expire_subscription() -> None:
    """Subscription transitions to EXPIRED status."""
    sub = create_monthly_subscription(_user_id())
    expired = expire_subscription(sub)

    assert expired.status == SubscriptionStatus.EXPIRED


@pytest.mark.unit
def test_activate_subscription_from_trial() -> None:
    """Annual subscription can be activated from TRIAL status."""
    sub = create_annual_subscription(_user_id())
    assert sub.status == SubscriptionStatus.TRIAL

    activated = activate_subscription(sub)
    assert activated.status == SubscriptionStatus.ACTIVE


@pytest.mark.unit
def test_renew_expired_subscription() -> None:
    """Expired subscription can be renewed."""
    now = _now()
    sub = create_monthly_subscription(_user_id(), now=now)
    expire_subscription(sub)
    assert sub.status == SubscriptionStatus.EXPIRED

    renewed = renew_subscription(sub, now=now)
    assert renewed.status == SubscriptionStatus.ACTIVE


@pytest.mark.unit
def test_renew_extends_period_by_plan_duration() -> None:
    """Renewal extends current_period_ends_at by plan period."""
    now = _now()
    sub = create_monthly_subscription(_user_id(), now=now)
    original_end = sub.current_period_ends_at

    renew_subscription(sub, now=now)
    # Should extend from the original end date
    expected_end = original_end + timedelta(days=30)
    assert abs((sub.current_period_ends_at - expected_end).total_seconds()) < 1
