"""Unit tests for the ``referral_attributed`` persistence helper (Phase 4.5).

Pins the contract of
:func:`api.db.repositories.events_repository.insert_referral_attributed_event` —
the single repository method that persists a ``referral_attributed`` row into
the append-only ``events`` table when a fresh signup is attributed to the user
who referred them.

The method composes the pure
:func:`api.referrals.attribution_event.build_referral_attributed_event` builder
(single source of truth for the row's ``event_name`` + ``properties`` shape)
with the repository's :func:`insert_event` primitive, so the auth router no
longer has to re-spell the event shape inline. These tests drive the helper
with an in-memory ``AsyncSession`` double (no real Postgres) and assert the
staged row exists with:

    * ``event_name`` == the canonical ``"referral_attributed"`` literal,
    * ``properties`` == exactly ``{"referrer_id": ..., "referral_code": ...}``,
    * ``user_id`` / ``anonymous_id`` linked to the referee,
    * ``occurred_at`` preserved verbatim,
    * exactly one row staged and flushed (the INSERT issued once).

A blank ``referral_code`` (a programming error) propagates the builder's
``ValueError`` and stages nothing — no malformed event ever reaches the table.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

from api.db.models.event import Event
from api.db.repositories.events_repository import insert_referral_attributed_event
from api.referrals.attribution_event import REFERRAL_ATTRIBUTED_EVENT_NAME


class _RecordingSession:
    """Minimal ``AsyncSession`` double capturing ``add`` / ``flush``.

    :func:`insert_event` (which the helper delegates to) stages the row via
    ``session.add(event)`` and issues the INSERT via ``await session.flush()``.
    This double records both so the test can assert the persisted row's shape
    without a real database round-trip.
    """

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.flushes = 0

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        self.flushes += 1

    @property
    def events(self) -> list[Event]:
        return [obj for obj in self.added if isinstance(obj, Event)]


@pytest.mark.unit
async def test_inserts_single_referral_attributed_row_with_correct_shape() -> None:
    """The helper stages exactly one row with the canonical name + properties."""
    referee_id = uuid.uuid4()
    referrer_id = uuid.uuid4()
    occurred_at = datetime(2026, 3, 15, 8, 30, 45, tzinfo=timezone.utc)
    session = _RecordingSession()

    event = await insert_referral_attributed_event(
        session,  # type: ignore[arg-type]
        referee_id=referee_id,
        referrer_id=referrer_id,
        referral_code="aB3dEf7h",
        occurred_at=occurred_at,
    )

    # Exactly one row staged and flushed once (the INSERT issued exactly once).
    assert len(session.events) == 1
    assert session.flushes == 1
    # The returned object is the staged row (populated app-side).
    assert session.events[0] is event

    # Correct event name (both the constant and the literal it resolves to).
    assert event.event_name == REFERRAL_ATTRIBUTED_EVENT_NAME
    assert event.event_name == "referral_attributed"

    # The two-key analytics-graph properties bag, nothing more.
    assert event.properties == {
        "referrer_id": str(referrer_id),
        "referral_code": "aB3dEf7h",
    }
    assert set(event.properties) == {"referrer_id", "referral_code"}

    # Linked to the referee on both identity columns.
    assert event.user_id == referee_id
    assert event.anonymous_id == str(referee_id)

    # occurred_at preserved verbatim; id generated app-side.
    assert event.occurred_at == occurred_at
    assert isinstance(event.id, uuid.UUID)


@pytest.mark.unit
async def test_blank_referral_code_raises_and_stages_nothing() -> None:
    """A blank referral_code surfaces the builder's ValueError; no row staged."""
    session = _RecordingSession()

    with pytest.raises(ValueError):
        await insert_referral_attributed_event(
            session,  # type: ignore[arg-type]
            referee_id=uuid.uuid4(),
            referrer_id=uuid.uuid4(),
            referral_code="   ",
            occurred_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
        )

    # The fail-fast guard runs before any DB interaction — nothing persisted.
    assert session.events == []
    assert session.flushes == 0
