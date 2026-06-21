"""User-activity tracking (Sub-AC 7.1).

Foundation for the retention layer (AC 7). The 30-day retention metric — a
secondary north-star alongside the payment-conversion north star — needs a
durable, queryable record of *when each user was active*. Without that, the
month-by-month retention rate is uncomputable and the monthly-magazine loop
has no measurement substrate.

Why a dedicated tracker rather than reusing the 12-step funnel analytics
(`src/funnel/analytics.ts`):

  - The funnel analytics module is a TypeScript event bus optimised for the
    pre-payment Glam Up sequence (step_view / step_cta_click / step_drop).
    Retention activity is post-payment + cross-session and needs a Python-
    side store the diagnosis/orchestrator and the magazine publishing job
    can both write into.
  - Retention activity is conceptually flat (user_id + when), while the
    funnel events carry a step number, CTA id, and Korean-variant context.
    Conflating them would force every retention reader to filter funnel
    noise.
  - The store is swappable. Tests and Phase-0 single-process MVP use
    `InMemoryActivityStore`; Phase-1 production will swap in a Postgres /
    PostHog adapter conforming to the same `ActivityStore` protocol with
    zero call-site changes.

Design notes:

  - `ActivityEvent` is a frozen dataclass — events are immutable records of
    "this happened at this time". Mutation post-recording is a bug class we
    refuse to enable.
  - Timestamps must be timezone-aware. Naive datetimes are a known retention
    bug source (server timezone drift silently shifts which 24h window an
    event lands in, corrupting the 30-day cohort window). Reject at the
    boundary, not later in the pipeline.
  - The store is injected, not module-global. Module-global state makes
    unit tests order-dependent and forbids parallel test execution.
  - `track_user_activity` returns the persisted event so callers can chain
    on it (e.g. enqueue a magazine-eligibility check) without re-querying
    the store.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

# ---------------------------------------------------------------------------
# Event record
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ActivityEvent:
    """A single user-activity occurrence.

    Attributes:
        user_id: Stable user identifier (matches `user.id` in the ontology).
        timestamp: When the activity happened. Must be timezone-aware.
    """

    user_id: str
    timestamp: datetime


# ---------------------------------------------------------------------------
# Store contract
# ---------------------------------------------------------------------------


class ActivityStore(Protocol):
    """Append-only store of `ActivityEvent`s.

    Implementations only need to satisfy append + read; ordering of
    `list_events` must preserve insertion order so retention windows can
    rely on the sequence being a faithful event log.
    """

    def append(self, event: ActivityEvent) -> None:
        """Record `event`. Implementations must not mutate `event`."""
        ...

    def list_events(self) -> tuple[ActivityEvent, ...]:
        """Return every recorded event, in insertion order."""
        ...

    def list_events_for_user(self, user_id: str) -> tuple[ActivityEvent, ...]:
        """Return the events for `user_id`, in insertion order."""
        ...


class InMemoryActivityStore:
    """In-process append-only store.

    Used by unit tests and the Phase-0 MVP. Not thread-safe — retention is
    written from a single async worker; cross-process durability is the
    Postgres adapter's job, not this class's.
    """

    def __init__(self) -> None:
        self._events: list[ActivityEvent] = []

    def append(self, event: ActivityEvent) -> None:
        # Defensive type check — protects downstream readers from a caller
        # who bypassed `track_user_activity` and pushed a raw tuple.
        if not isinstance(event, ActivityEvent):
            raise TypeError(
                f"event must be an ActivityEvent, got {type(event).__name__}",
            )
        self._events.append(event)

    def list_events(self) -> tuple[ActivityEvent, ...]:
        return tuple(self._events)

    def list_events_for_user(self, user_id: str) -> tuple[ActivityEvent, ...]:
        return tuple(e for e in self._events if e.user_id == user_id)

    def __len__(self) -> int:  # convenience for tests/diagnostics
        return len(self._events)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def track_user_activity(
    user_id: str,
    timestamp: datetime,
    *,
    store: ActivityStore,
) -> ActivityEvent:
    """Record a single user-activity event in `store`.

    Args:
        user_id: Non-empty user identifier.
        timestamp: Timezone-aware datetime of the activity.
        store: The `ActivityStore` to append the event into. Keyword-only
            to force callers to be explicit — there is no implicit global.

    Returns:
        The `ActivityEvent` that was appended. Identical (by value) to what
        the store now holds for this call.

    Raises:
        TypeError: if `user_id` is not a str, or `timestamp` is not a
            datetime.
        ValueError: if `user_id` is empty/whitespace, or `timestamp` is
            naive (no tzinfo).
    """
    _validate_user_id(user_id)
    _validate_timestamp(timestamp)
    event = ActivityEvent(user_id=user_id, timestamp=timestamp)
    store.append(event)
    return event


# ---------------------------------------------------------------------------
# Internal validators
# ---------------------------------------------------------------------------


def _validate_user_id(value: str) -> None:
    if not isinstance(value, str):
        raise TypeError(
            f"user_id must be str, got {type(value).__name__}",
        )
    if not value.strip():
        raise ValueError("user_id must be a non-empty string")


def _validate_timestamp(value: datetime) -> None:
    # Reject bools first — bool is an int subclass and `isinstance(True, datetime)`
    # is False anyway, but we mirror the tone_classifier pattern of being explicit
    # about what we accept and what we don't.
    if not isinstance(value, datetime):
        raise TypeError(
            f"timestamp must be datetime, got {type(value).__name__}",
        )
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(
            "timestamp must be timezone-aware (use datetime.now(timezone.utc) "
            "or similar); naive datetimes corrupt the 30-day retention cohort "
            "window",
        )
