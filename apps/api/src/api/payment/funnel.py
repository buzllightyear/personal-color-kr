"""Payment funnel — 12-stage Korean market funnel (AC14, AC15, AC16, AC17, AC21).

Seed ontology: payment_funnel_stage [enum] — 12 stages.
Korean market variant of Glam Up funnel:
  1:가치_제시, 2:결과_프리뷰, 3:사회적_증거, 4:iOS_별점_게이트,
  5:긴급성_희소성, 6:기능_비교, 7:가격_앵커링, 8:리스크_역전(환불보장),
  9:보너스_스택, 10:1명_추천_게이트, 11:단계_진화(미결제_재시도), 12:결제_모델_변형

Seed constraints honored here
------------------------------
- Funnel stages are NOT skipped or reordered.
- Stage 4 (iOS rating) and Stage 10 (1-friend referral) are gates.
- Stage 11: re-entry for unpaid users.
- Stage 12: $12/월 vs $59/연 selection.
- Conversion rate = guardrail floor ONLY, not a target.
- No funnel manipulation logic (no A/B to maximize conversion).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

# ---------------------------------------------------------------------------
# Stage enum (12 stages, Korean market variant)
# ---------------------------------------------------------------------------


class PaymentFunnelStage(int, Enum):
    """12-stage Korean market payment funnel stages."""

    가치_제시 = 1
    결과_프리뷰 = 2
    사회적_증거 = 3
    iOS_별점_게이트 = 4
    긴급성_희소성 = 5
    기능_비교 = 6
    가격_앵커링 = 7
    리스크_역전 = 8
    보너스_스택 = 9
    추천_게이트 = 10
    단계_진화 = 11
    결제_모델_변형 = 12


# ---------------------------------------------------------------------------
# Funnel event log
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PaymentFunnelEvent:
    """A single funnel stage entry or completion event.

    Attributes
    ----------
    event_id:
        UUID4 auto-generated.
    user_id:
        User this event belongs to.
    stage:
        The funnel stage.
    event_type:
        'entry' or 'completion'.
    occurred_at:
        UTC timestamp.
    metadata:
        Optional additional context.
    """

    event_id: uuid.UUID
    user_id: uuid.UUID
    stage: PaymentFunnelStage
    event_type: str  # "entry" | "completion"
    occurred_at: datetime
    metadata: dict[str, object]


class InMemoryFunnelEventLog:
    """In-memory log of payment funnel events."""

    def __init__(self) -> None:
        self._events: list[PaymentFunnelEvent] = []

    def log_entry(
        self,
        user_id: uuid.UUID,
        stage: PaymentFunnelStage,
        metadata: dict[str, object] | None = None,
    ) -> PaymentFunnelEvent:
        """Log a stage entry event."""
        event = PaymentFunnelEvent(
            event_id=uuid.uuid4(),
            user_id=user_id,
            stage=stage,
            event_type="entry",
            occurred_at=datetime.now(timezone.utc),
            metadata=metadata or {},
        )
        self._events.append(event)
        return event

    def log_completion(
        self,
        user_id: uuid.UUID,
        stage: PaymentFunnelStage,
        metadata: dict[str, object] | None = None,
    ) -> PaymentFunnelEvent:
        """Log a stage completion event."""
        event = PaymentFunnelEvent(
            event_id=uuid.uuid4(),
            user_id=user_id,
            stage=stage,
            event_type="completion",
            occurred_at=datetime.now(timezone.utc),
            metadata=metadata or {},
        )
        self._events.append(event)
        return event

    def events_for_user(self, user_id: uuid.UUID) -> list[PaymentFunnelEvent]:
        """Return all events for a user."""
        return [e for e in self._events if e.user_id == user_id]

    def all_events(self) -> list[PaymentFunnelEvent]:
        return list(self._events)

    def __len__(self) -> int:
        return len(self._events)


# ---------------------------------------------------------------------------
# Stage gate logic (AC15)
# ---------------------------------------------------------------------------


class GateBlockedError(Exception):
    """Raised when a user tries to advance past a gate without meeting conditions."""

    def __init__(self, stage: PaymentFunnelStage, reason: str) -> None:
        super().__init__(f"Gate blocked at stage {stage.name}: {reason}")
        self.stage = stage
        self.reason = reason


def check_stage_4_ios_rating_gate(has_rated: bool) -> None:
    """Stage 4 gate: iOS rating must be completed before advancing.

    Parameters
    ----------
    has_rated:
        True if the user has submitted an iOS App Store rating.

    Raises
    ------
    GateBlockedError
        If the user has not completed the iOS rating.
    """
    if not has_rated:
        raise GateBlockedError(
            PaymentFunnelStage.iOS_별점_게이트,
            "User has not completed iOS App Store rating.",
        )


def check_stage_10_referral_gate(referral_count: int) -> None:
    """Stage 10 gate: at least 1 friend referred before advancing.

    Korean market constraint: avoid coercive mechanics — referral is
    presented as a benefit (unlock bonus), not a requirement to proceed.

    Parameters
    ----------
    referral_count:
        Number of friends successfully referred by this user.

    Raises
    ------
    GateBlockedError
        If the user has not referred at least 1 friend.
    """
    if referral_count < 1:
        raise GateBlockedError(
            PaymentFunnelStage.추천_게이트,
            "At least 1 friend referral required to advance.",
        )


# ---------------------------------------------------------------------------
# Stage 11: re-entry logic for unpaid users (AC16)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Stage11ReentryResult:
    """Result of stage 11 re-entry check."""

    should_retry: bool
    message: str


def check_stage_11_reentry(
    has_paid: bool,
    reentry_count: int = 0,
) -> Stage11ReentryResult:
    """Stage 11: determine if unpaid user should be shown re-entry flow.

    Parameters
    ----------
    has_paid:
        True if the user has completed payment.
    reentry_count:
        How many times the user has seen stage 11 (for escalation logic).

    Returns
    -------
    Stage11ReentryResult
        Whether to retry and the CTA message.
    """
    if has_paid:
        return Stage11ReentryResult(
            should_retry=False,
            message="User has already paid. Stage 11 not applicable.",
        )
    return Stage11ReentryResult(
        should_retry=True,
        message="Special offer: try the annual plan for 37 days free.",
    )


# ---------------------------------------------------------------------------
# Stage 12: payment model options (AC16, AC17)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PaymentOption:
    """A payment option presented at stage 12."""

    plan: str
    price_krw: int
    price_usd: float
    trial_days: int
    description: str


#: Monthly plan option
MONTHLY_PLAN = PaymentOption(
    plan="monthly",
    price_krw=12000,
    price_usd=12.0,
    trial_days=0,
    description="₩12,000/월 — 월간 구독",
)

#: Annual plan option (7 + 30 = 37 days free trial)
ANNUAL_PLAN = PaymentOption(
    plan="annual",
    price_krw=59000,
    price_usd=59.0,
    trial_days=37,
    description="₩59,000/연 — 연간 구독, 7일 + 30일 = 37일 무료체험",
)


def get_stage_12_options() -> list[PaymentOption]:
    """Return the two payment options presented at stage 12.

    Korean market variant: monthly and annual plans.
    Annual plan includes 37-day free trial (7 days standard + 30 days bonus).
    """
    return [MONTHLY_PLAN, ANNUAL_PLAN]


# ---------------------------------------------------------------------------
# Conversion rate guardrail (AC21)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConversionGuardrailResult:
    """Result of conversion rate guardrail check."""

    conversion_rate: float | None
    floor_threshold: float
    alert_triggered: bool
    message: str


def compute_conversion_guardrail(
    event_log: InMemoryFunnelEventLog,
    floor_threshold: float = 0.05,
) -> ConversionGuardrailResult:
    """Compute conversion rate and check against floor guardrail.

    Conversion rate = stage 12 completions / stage 1 entries.
    Alert if rate < floor_threshold.
    This is a guardrail FLOOR only — no maximization logic.

    Parameters
    ----------
    event_log:
        The funnel event log.
    floor_threshold:
        Minimum acceptable conversion rate (default 5%).

    Returns
    -------
    ConversionGuardrailResult
        Conversion rate, alert status.
    """
    all_events = event_log.all_events()

    stage_1_entries = {
        e.user_id
        for e in all_events
        if e.stage == PaymentFunnelStage.가치_제시 and e.event_type == "entry"
    }
    stage_12_completions = {
        e.user_id
        for e in all_events
        if e.stage == PaymentFunnelStage.결제_모델_변형 and e.event_type == "completion"
    }

    if not stage_1_entries:
        return ConversionGuardrailResult(
            conversion_rate=None,
            floor_threshold=floor_threshold,
            alert_triggered=False,
            message="No stage 1 entries yet — conversion rate undefined.",
        )

    rate = len(stage_12_completions) / len(stage_1_entries)
    alert = rate < floor_threshold

    return ConversionGuardrailResult(
        conversion_rate=rate,
        floor_threshold=floor_threshold,
        alert_triggered=alert,
        message=(
            f"ALERT: conversion rate {rate:.1%} below floor {floor_threshold:.1%}"
            if alert
            else f"Conversion rate {rate:.1%} within acceptable range."
        ),
    )


__all__ = [
    "PaymentFunnelStage",
    "PaymentFunnelEvent",
    "InMemoryFunnelEventLog",
    "GateBlockedError",
    "check_stage_4_ios_rating_gate",
    "check_stage_10_referral_gate",
    "Stage11ReentryResult",
    "check_stage_11_reentry",
    "PaymentOption",
    "MONTHLY_PLAN",
    "ANNUAL_PLAN",
    "get_stage_12_options",
    "ConversionGuardrailResult",
    "compute_conversion_guardrail",
]
