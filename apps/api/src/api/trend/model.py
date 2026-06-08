"""Trend entity — first-class domain concept (AC7, AC8, AC9).

Seed ontology: trend [object]
Fields: trend_id, name, status, status_transitions, created_at.
Status transitions: predicted → active (operator manual), active → expired (operator manual).
No automatic transitions.

FK connections:
- generation_recipe.trend_id → trend.trend_id
- trend_drop.trend_id → trend.trend_id
- trend_call_log.trend_id → trend.trend_id (nullable)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

# ---------------------------------------------------------------------------
# Trend status enum
# ---------------------------------------------------------------------------


class TrendStatus(str, Enum):
    """Allowed trend statuses. Transitions are operator-manual only."""

    PREDICTED = "predicted"
    ACTIVE = "active"
    EXPIRED = "expired"


# ---------------------------------------------------------------------------
# Status transition record
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StatusTransition:
    """Single status transition record on a trend entity.

    Attributes
    ----------
    from_status:
        Status before transition.
    to_status:
        Status after transition.
    transitioned_at:
        UTC timestamp of the transition.
    transitioned_by:
        Operator FK (always the singleton operator_id in v1).
    """

    from_status: TrendStatus
    to_status: TrendStatus
    transitioned_at: datetime
    transitioned_by: str


# ---------------------------------------------------------------------------
# Trend entity
# ---------------------------------------------------------------------------


@dataclass
class TrendRecord:
    """Mutable trend entity persisted in the in-memory repository.

    Attributes
    ----------
    trend_id:
        UUID4 auto-generated on creation.
    name:
        Human-readable trend name (e.g. "Y2K 글리터").
    status:
        Current status: predicted | active | expired.
    status_transitions:
        Ordered list of status transition events.
    created_at:
        UTC creation timestamp.
    """

    trend_id: uuid.UUID
    name: str
    status: TrendStatus
    status_transitions: list[StatusTransition]
    created_at: datetime


@dataclass(frozen=True)
class TrendCreateInput:
    """Input DTO for creating a new trend."""

    name: str
    initial_status: TrendStatus = TrendStatus.PREDICTED


# ---------------------------------------------------------------------------
# In-memory trend repository
# ---------------------------------------------------------------------------


class InMemoryTrendRepository:
    """In-memory store for :class:`TrendRecord` entities.

    Provides CRUD + status-transition operations for operator tooling.
    """

    def __init__(self) -> None:
        self._store: dict[uuid.UUID, TrendRecord] = {}

    def create(self, input_: TrendCreateInput) -> TrendRecord:
        """Create a new trend and return it with auto-generated id + timestamps."""
        now = datetime.now(timezone.utc)
        record = TrendRecord(
            trend_id=uuid.uuid4(),
            name=input_.name,
            status=input_.initial_status,
            status_transitions=[],
            created_at=now,
        )
        self._store[record.trend_id] = record
        return record

    def find_by_id(self, trend_id: uuid.UUID) -> TrendRecord | None:
        """Return the trend or None if not found."""
        return self._store.get(trend_id)

    def all(self) -> list[TrendRecord]:
        """Return all trends in insertion order."""
        return list(self._store.values())

    def update_name(self, trend_id: uuid.UUID, name: str) -> TrendRecord | None:
        """Update the trend name. Returns updated record or None if not found."""
        record = self._store.get(trend_id)
        if record is None:
            return None
        record.name = name
        return record

    def transition_status(
        self,
        trend_id: uuid.UUID,
        new_status: TrendStatus,
        operator_id: str,
    ) -> TrendRecord | None:
        """Operator-manual status transition. Validates allowed transitions.

        Allowed: predicted → active, active → expired.
        Returns updated record or None if trend not found.

        Raises
        ------
        ValueError
            If the transition is not in the allowed set.
        """
        allowed: dict[TrendStatus, TrendStatus] = {
            TrendStatus.PREDICTED: TrendStatus.ACTIVE,
            TrendStatus.ACTIVE: TrendStatus.EXPIRED,
        }
        record = self._store.get(trend_id)
        if record is None:
            return None

        if allowed.get(record.status) != new_status:
            raise ValueError(
                f"Invalid trend status transition: {record.status!r} → {new_status!r}. "
                f"Allowed: predicted→active, active→expired."
            )

        transition = StatusTransition(
            from_status=record.status,
            to_status=new_status,
            transitioned_at=datetime.now(timezone.utc),
            transitioned_by=operator_id,
        )
        record.status = new_status
        record.status_transitions.append(transition)
        return record

    def delete(self, trend_id: uuid.UUID) -> bool:
        """Delete trend. Returns True if deleted, False if not found."""
        if trend_id in self._store:
            del self._store[trend_id]
            return True
        return False

    def __len__(self) -> int:
        return len(self._store)


# ---------------------------------------------------------------------------
# Call log model (AC8, AC9)
# ---------------------------------------------------------------------------


class PreemptOrFollowTag(str, Enum):
    """Tag indicating whether a trend call was preemptive or following."""

    PREEMPT = "preempt"
    FOLLOW = "follow"


@dataclass
class TrendCallLogRecord:
    """Operator trend call log entry.

    trend_id is nullable — operator can log a call before the trend entity exists.
    Backfill API links trend_id after the fact.

    Attributes
    ----------
    log_id:
        UUID4 auto-generated.
    trend_desc:
        Free-text description of the predicted trend.
    preempt_or_follow_tag:
        Whether this was a preemptive call or following an existing trend.
    predicted_at:
        UTC timestamp of when the prediction was made.
    trend_id:
        Nullable FK to trend entity (backfilled after fact).
    hit_confirmed:
        Whether the prediction was confirmed as accurate (spost-hoc marking).
    backfilled_at:
        UTC timestamp when trend_id was backfilled (None until backfilled).
    """

    log_id: uuid.UUID
    trend_desc: str
    preempt_or_follow_tag: PreemptOrFollowTag
    predicted_at: datetime
    trend_id: uuid.UUID | None
    hit_confirmed: bool
    backfilled_at: datetime | None


@dataclass(frozen=True)
class TrendCallLogCreateInput:
    """Input DTO for creating a trend call log entry."""

    trend_desc: str
    preempt_or_follow_tag: PreemptOrFollowTag
    predicted_at: datetime
    trend_id: uuid.UUID | None = None  # nullable — may not exist yet


# ---------------------------------------------------------------------------
# In-memory call log repository
# ---------------------------------------------------------------------------


class InMemoryTrendCallLogRepository:
    """In-memory store for :class:`TrendCallLogRecord` entries."""

    def __init__(self) -> None:
        self._store: dict[uuid.UUID, TrendCallLogRecord] = {}

    def create(self, input_: TrendCallLogCreateInput) -> TrendCallLogRecord:
        """Create a new call log entry. trend_id may be None."""
        record = TrendCallLogRecord(
            log_id=uuid.uuid4(),
            trend_desc=input_.trend_desc,
            preempt_or_follow_tag=input_.preempt_or_follow_tag,
            predicted_at=input_.predicted_at,
            trend_id=input_.trend_id,
            hit_confirmed=False,
            backfilled_at=None,
        )
        self._store[record.log_id] = record
        return record

    def find_by_id(self, log_id: uuid.UUID) -> TrendCallLogRecord | None:
        """Return the call log or None if not found."""
        return self._store.get(log_id)

    def all(self) -> list[TrendCallLogRecord]:
        """Return all call logs in insertion order."""
        return list(self._store.values())

    def update_trend_desc(
        self, log_id: uuid.UUID, trend_desc: str
    ) -> TrendCallLogRecord | None:
        """Update trend description. Returns updated record or None."""
        record = self._store.get(log_id)
        if record is None:
            return None
        record.trend_desc = trend_desc
        return record

    def backfill_trend_id(
        self,
        log_id: uuid.UUID,
        trend_id: uuid.UUID,
    ) -> TrendCallLogRecord | None:
        """Spost-hoc backfill of trend_id after trend entity is created.

        Sets ``backfilled_at`` to now.
        Returns updated record or None if not found.
        """
        record = self._store.get(log_id)
        if record is None:
            return None
        record.trend_id = trend_id
        record.backfilled_at = datetime.now(timezone.utc)
        return record

    def mark_hit_confirmed(
        self, log_id: uuid.UUID, confirmed: bool = True
    ) -> TrendCallLogRecord | None:
        """Mark whether the prediction was confirmed. Returns record or None."""
        record = self._store.get(log_id)
        if record is None:
            return None
        record.hit_confirmed = confirmed
        return record

    def delete(self, log_id: uuid.UUID) -> bool:
        """Delete call log. Returns True if deleted, False if not found."""
        if log_id in self._store:
            del self._store[log_id]
            return True
        return False

    def compute_preempt_hit_rate(self) -> float | None:
        """Compute preempt call accuracy rate.

        Returns the fraction of preempt-tagged calls where hit_confirmed=True.
        Returns None if there are no preempt calls (undefined).

        This is the north star metric: trend_call_accuracy.
        Computed on-demand (not stored as a snapshot).
        """
        preempt_logs = [
            log
            for log in self._store.values()
            if log.preempt_or_follow_tag == PreemptOrFollowTag.PREEMPT
        ]
        if not preempt_logs:
            return None
        hits = sum(1 for log in preempt_logs if log.hit_confirmed)
        return hits / len(preempt_logs)

    def __len__(self) -> int:
        return len(self._store)


__all__ = [
    "TrendStatus",
    "StatusTransition",
    "TrendRecord",
    "TrendCreateInput",
    "InMemoryTrendRepository",
    "PreemptOrFollowTag",
    "TrendCallLogRecord",
    "TrendCallLogCreateInput",
    "InMemoryTrendCallLogRepository",
]
