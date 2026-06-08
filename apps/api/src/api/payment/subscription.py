"""Subscription model state transitions (AC17).

Seed constraints honored here
------------------------------
- $12/월 monthly, $59/연 annual.
- Annual: 7-day standard trial + 30-day bonus = 37 total free trial days.
- States: trial → active → expired | renewed.
- No automatic renewal logic — state transitions are explicit.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

# ---------------------------------------------------------------------------
# Subscription status enum
# ---------------------------------------------------------------------------


class SubscriptionStatus(str, Enum):
    """Subscription lifecycle states."""

    TRIAL = "trial"
    ACTIVE = "active"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


# ---------------------------------------------------------------------------
# Subscription plan enum
# ---------------------------------------------------------------------------


class SubscriptionPlan(str, Enum):
    """Available subscription plans."""

    MONTHLY = "monthly"
    ANNUAL = "annual"


# ---------------------------------------------------------------------------
# Subscription record
# ---------------------------------------------------------------------------


@dataclass
class SubscriptionRecord:
    """User subscription entity.

    Attributes
    ----------
    subscription_id:
        UUID4 auto-generated.
    user_id:
        FK to the user.
    plan:
        monthly | annual.
    status:
        trial | active | expired | cancelled.
    trial_ends_at:
        UTC datetime when trial period ends (None for monthly plans).
    current_period_ends_at:
        UTC datetime when current paid period ends.
    created_at:
        UTC creation timestamp.
    """

    subscription_id: uuid.UUID
    user_id: uuid.UUID
    plan: SubscriptionPlan
    status: SubscriptionStatus
    trial_ends_at: datetime | None
    current_period_ends_at: datetime
    created_at: datetime


# ---------------------------------------------------------------------------
# Trial duration constants
# ---------------------------------------------------------------------------

#: Annual plan free trial: 7 standard + 30 bonus = 37 days
ANNUAL_TRIAL_DAYS: int = 37

#: Annual subscription period: 365 days
ANNUAL_PERIOD_DAYS: int = 365

#: Monthly subscription period: 30 days
MONTHLY_PERIOD_DAYS: int = 30


# ---------------------------------------------------------------------------
# Subscription factory functions
# ---------------------------------------------------------------------------


def create_monthly_subscription(
    user_id: uuid.UUID,
    now: datetime | None = None,
) -> SubscriptionRecord:
    """Create a monthly subscription ($12/월, no trial).

    Parameters
    ----------
    user_id:
        User's UUID.
    now:
        Optional current time (for testing). Defaults to UTC now.

    Returns
    -------
    SubscriptionRecord
        Monthly subscription starting immediately (no trial).
    """
    if now is None:
        now = datetime.now(timezone.utc)

    return SubscriptionRecord(
        subscription_id=uuid.uuid4(),
        user_id=user_id,
        plan=SubscriptionPlan.MONTHLY,
        status=SubscriptionStatus.ACTIVE,
        trial_ends_at=None,
        current_period_ends_at=now + timedelta(days=MONTHLY_PERIOD_DAYS),
        created_at=now,
    )


def create_annual_subscription(
    user_id: uuid.UUID,
    now: datetime | None = None,
) -> SubscriptionRecord:
    """Create an annual subscription ($59/연) with 37-day free trial.

    The annual plan starts with 37 days of free trial (7 + 30 days),
    then transitions to active paid period.

    Parameters
    ----------
    user_id:
        User's UUID.
    now:
        Optional current time (for testing). Defaults to UTC now.

    Returns
    -------
    SubscriptionRecord
        Annual subscription in TRIAL status with trial_ends_at set to
        now + 37 days.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    trial_end = now + timedelta(days=ANNUAL_TRIAL_DAYS)
    period_end = now + timedelta(days=ANNUAL_TRIAL_DAYS + ANNUAL_PERIOD_DAYS)

    return SubscriptionRecord(
        subscription_id=uuid.uuid4(),
        user_id=user_id,
        plan=SubscriptionPlan.ANNUAL,
        status=SubscriptionStatus.TRIAL,
        trial_ends_at=trial_end,
        current_period_ends_at=period_end,
        created_at=now,
    )


# ---------------------------------------------------------------------------
# State transition functions
# ---------------------------------------------------------------------------


def expire_subscription(sub: SubscriptionRecord) -> SubscriptionRecord:
    """Transition subscription to EXPIRED status.

    Returns a new record (immutable update pattern).
    """
    sub.status = SubscriptionStatus.EXPIRED
    return sub


def activate_subscription(sub: SubscriptionRecord) -> SubscriptionRecord:
    """Transition subscription from TRIAL to ACTIVE status.

    Called when the trial period ends and payment is confirmed.
    Returns the updated record.
    """
    if sub.status not in (SubscriptionStatus.TRIAL, SubscriptionStatus.EXPIRED):
        raise ValueError(
            f"Cannot activate subscription in status {sub.status!r}. "
            "Only TRIAL or EXPIRED subscriptions can be activated."
        )
    sub.status = SubscriptionStatus.ACTIVE
    return sub


def renew_subscription(
    sub: SubscriptionRecord,
    now: datetime | None = None,
) -> SubscriptionRecord:
    """Renew an active or expired subscription for another period.

    Extends current_period_ends_at by the plan period.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    days = (
        MONTHLY_PERIOD_DAYS
        if sub.plan == SubscriptionPlan.MONTHLY
        else ANNUAL_PERIOD_DAYS
    )
    base = max(sub.current_period_ends_at, now)
    sub.current_period_ends_at = base + timedelta(days=days)
    sub.status = SubscriptionStatus.ACTIVE
    return sub


def is_trial_active(sub: SubscriptionRecord, now: datetime | None = None) -> bool:
    """Return True if the subscription is in active trial period."""
    if now is None:
        now = datetime.now(timezone.utc)
    return sub.status == SubscriptionStatus.TRIAL and (
        sub.trial_ends_at is not None and now < sub.trial_ends_at
    )


__all__ = [
    "SubscriptionStatus",
    "SubscriptionPlan",
    "SubscriptionRecord",
    "ANNUAL_TRIAL_DAYS",
    "ANNUAL_PERIOD_DAYS",
    "MONTHLY_PERIOD_DAYS",
    "create_monthly_subscription",
    "create_annual_subscription",
    "expire_subscription",
    "activate_subscription",
    "renew_subscription",
    "is_trial_active",
]
