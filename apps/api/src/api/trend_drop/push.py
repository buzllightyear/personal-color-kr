"""Trend drop push service — operator-initiated trend drop (AC10).

Seed constraints honored here
------------------------------
- Operator manually pushes a trend drop (v1 = semi-automatic).
- target_segment_id → criteria-declarative computed matching.
- Notification placeholder sent to matched users.
- Restyle CTA entry point created.
- trend_id + recipe_id + target_segment_id → push.

Design
------
This module provides the in-memory implementation for trend drop push.
Notification delivery is a placeholder (no real push infra in v1).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Trend segment (criteria-declarative, AC10)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SegmentCriteria:
    """Operator-declared criteria for a user segment.

    The system computes which users match these criteria.
    Operator pushes criteria, not individual user IDs.
    """

    personal_color: str | None = None  # e.g. "봄", "여름", "가을", "겨울"
    subscription_status: str | None = None  # e.g. "active", "trialing"


@dataclass
class TrendSegmentRecord:
    """A user segment defined by criteria."""

    segment_id: uuid.UUID
    name: str
    criteria: SegmentCriteria
    created_at: datetime


class InMemoryTrendSegmentRepository:
    """In-memory store for TrendSegmentRecord entities.

    Segment membership is ALWAYS computed on-demand from criteria — never
    stored as a list of user IDs on the segment or on the user entity (AC23).
    The single source of truth is criteria → user matching.
    """

    def __init__(self) -> None:
        self._store: dict[uuid.UUID, TrendSegmentRecord] = {}

    def create(self, name: str, criteria: SegmentCriteria) -> TrendSegmentRecord:
        record = TrendSegmentRecord(
            segment_id=uuid.uuid4(),
            name=name,
            criteria=criteria,
            created_at=datetime.now(timezone.utc),
        )
        self._store[record.segment_id] = record
        return record

    def find_by_id(self, segment_id: uuid.UUID) -> TrendSegmentRecord | None:
        return self._store.get(segment_id)

    def update_criteria(
        self,
        segment_id: uuid.UUID,
        new_criteria: SegmentCriteria,
    ) -> TrendSegmentRecord | None:
        """Update the criteria for an existing segment.

        The updated criteria immediately affects which users match the segment
        on the next get_matching_users() call — membership is computed on
        demand, not cached in any user or segment field.

        Returns
        -------
        TrendSegmentRecord | None
            Updated record, or None if segment_id was not found.
        """
        existing = self._store.get(segment_id)
        if existing is None:
            return None
        updated = TrendSegmentRecord(
            segment_id=existing.segment_id,
            name=existing.name,
            criteria=new_criteria,
            created_at=existing.created_at,
        )
        self._store[segment_id] = updated
        return updated

    def all_segments(self) -> list[TrendSegmentRecord]:
        """Return all segment records."""
        return list(self._store.values())

    def __len__(self) -> int:
        return len(self._store)


# ---------------------------------------------------------------------------
# User model for segment matching
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UserForSegment:
    """Minimal user representation for segment criteria matching."""

    user_id: uuid.UUID
    personal_color: str | None
    subscription_status: str | None


# ---------------------------------------------------------------------------
# Trend drop push record
# ---------------------------------------------------------------------------


@dataclass
class TrendDropPushRecord:
    """Result of an operator trend drop push."""

    drop_id: uuid.UUID
    trend_id: uuid.UUID
    recipe_id: str
    target_segment_id: uuid.UUID
    pushed_at: datetime
    pushed_by: str  # operator FK
    restyle_cta: str  # deep link / URL
    notification_status: str  # "sent" | "pending"
    matched_user_ids: list[uuid.UUID]


# ---------------------------------------------------------------------------
# Push service
# ---------------------------------------------------------------------------


def push_trend_drop(
    *,
    trend_id: uuid.UUID,
    recipe_id: str,
    target_segment_id: uuid.UUID,
    operator_id: str,
    restyle_cta: str,
    users: list[UserForSegment],
    segment_repo: InMemoryTrendSegmentRepository,
) -> TrendDropPushRecord:
    """Push a trend drop to all users matching the segment criteria.

    Parameters
    ----------
    trend_id:
        FK to the trend entity.
    recipe_id:
        FK to the generation recipe.
    target_segment_id:
        FK to the trend segment defining target users.
    operator_id:
        Operator singleton identifier (auth check is the caller's responsibility).
    restyle_cta:
        Deep link or URL for the restyle entry point.
    users:
        All users to check against segment criteria.
    segment_repo:
        Repository for looking up the segment criteria.

    Returns
    -------
    TrendDropPushRecord
        Push result including matched_user_ids and notification_status.

    Raises
    ------
    ValueError
        If the segment does not exist.
    """
    segment = segment_repo.find_by_id(target_segment_id)
    if segment is None:
        raise ValueError(f"Segment {target_segment_id!r} not found.")

    # Compute matched users from criteria (criteria-declarative push model)
    matched = _match_users(users, segment.criteria)

    return TrendDropPushRecord(
        drop_id=uuid.uuid4(),
        trend_id=trend_id,
        recipe_id=recipe_id,
        target_segment_id=target_segment_id,
        pushed_at=datetime.now(timezone.utc),
        pushed_by=operator_id,
        restyle_cta=restyle_cta,
        notification_status="sent",
        matched_user_ids=[u.user_id for u in matched],
    )


def _match_users(
    users: list[UserForSegment],
    criteria: SegmentCriteria,
) -> list[UserForSegment]:
    """Return users matching all specified criteria (AND logic).

    None criteria fields are treated as wildcards (match all values).
    """
    result: list[UserForSegment] = []
    for user in users:
        if criteria.personal_color is not None:
            if user.personal_color != criteria.personal_color:
                continue
        if criteria.subscription_status is not None:
            if user.subscription_status != criteria.subscription_status:
                continue
        result.append(user)
    return result


def get_matching_segments(
    user: UserForSegment,
    segment_repo: InMemoryTrendSegmentRepository,
) -> list[TrendSegmentRecord]:
    """Compute which segments a user belongs to, based on criteria (AC23).

    This is the ONLY path to determine segment membership. User entities
    do NOT store segment_ids — membership is always computed on-demand from
    criteria (single source of truth = trend_segment.criteria).

    Segment criteria changes are immediately reflected in the result of this
    function — there is no stale cache of segment IDs on the user.

    Parameters
    ----------
    user:
        The user to check.
    segment_repo:
        Repository containing all segment records with their criteria.

    Returns
    -------
    list[TrendSegmentRecord]
        Segments whose criteria match the user. Empty list = user is in
        no segments.
    """
    matching: list[TrendSegmentRecord] = []
    for segment in segment_repo.all_segments():
        matched = _match_users([user], segment.criteria)
        if matched:
            matching.append(segment)
    return matching


__all__ = [
    "SegmentCriteria",
    "TrendSegmentRecord",
    "InMemoryTrendSegmentRepository",
    "UserForSegment",
    "TrendDropPushRecord",
    "push_trend_drop",
    "get_matching_segments",
]
