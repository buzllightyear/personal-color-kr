"""Sole SQL access boundary for the ``events`` table (Phase 4.4).

This repository is the *only* module permitted to read from or write to
the ``events`` table. Two surfaces consume it:

    * ``POST /v1/events`` (``api.routers.events``) — authenticated single
      event ingest. Calls :func:`insert_event`.
    * ``GET /v1/metrics/retention`` (``api.routers.metrics``) —
      server-side cohort/active-set assembly. Calls
      :func:`fetch_cohort_user_ids` and :func:`fetch_active_user_ids`.

# Why a repository (vs. inline ORM in the routers)?

The Phase 4.2 :class:`api.db.models.event.Event` docstring pins the rule:
"Routers, schemas, and dependencies must consume :class:`Event` through a
future repository surface; never import this class into
``apps/api/src/api/routers/`` directly." This module is that surface. It
encapsulates:

    1. The single source of truth for the events SQL (insert + the two
       retention assembly reads), so a query-shape change lives in one
       file.
    2. The translation from ORM rows to the plain ``list[str]`` of user
       identifiers that the HTTP-ignorant core-python retention handler
       (``retention.api.get_retention_metrics``) expects — keeping the
       core module DB-ignorant.

# SQLAlchemy import boundary (AC11)

This file lives under ``apps/api/src/api/db/`` (inside the boundary) and
sources every SQL primitive (``select``) from the
:mod:`api.db.session` re-export surface rather than importing
``sqlalchemy`` directly. Writes go through the ORM
(``session.add(Event(...))``) so no statement builder is needed for the
insert path.

# Date-window semantics (retention assembly)

``occurred_at`` is a ``timestamptz`` (client wall clock). The retention
query params are calendar dates (``YYYY-MM-DD``). The repository receives
already-resolved ``datetime`` bounds from the metrics router and applies
them as half-open intervals ``[start, end)`` so the caller owns the
calendar-to-instant translation in exactly one place.

# Append-only + single-insert

The ``events`` table is append-only (Phase 4.2). :func:`insert_event`
performs exactly one INSERT per call; there is no batch path, no dedup,
and no idempotency key (all intentionally deferred). The row id and
``server_received_at`` are generated app-side (mirroring the auth
router's ``uuid.uuid4()`` pattern) so the returned :class:`Event` is
fully populated without a post-flush refresh round-trip.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from api.db.models.event import Event
from api.db.session import AsyncSession, select
from api.referrals.attribution_event import build_referral_attributed_event


async def insert_event(
    session: AsyncSession,
    *,
    anonymous_id: str,
    event_name: str,
    occurred_at: datetime,
    properties: dict[str, Any],
    user_id: uuid.UUID,
) -> Event:
    """Insert a single ``events`` row and return the populated ORM object.

    The caller (``POST /v1/events``) is responsible for committing the
    surrounding transaction; this function only ``add``s the row and
    ``flush``es so the INSERT is issued and any DB-side errors surface
    inside the caller's ``try`` scope.

    Parameters
    ----------
    session:
        The per-request :class:`AsyncSession` from
        :func:`api.db.session.get_session`.
    anonymous_id:
        PostHog ``distinct_id`` equivalent supplied by the client. Stored
        verbatim; not used for identification (``user_id`` is the
        authoritative identity, forced from the authenticated user).
    event_name:
        Snake_case event identifier (already validated against
        ``^[a-z_]+$`` by the request schema).
    occurred_at:
        Client-clock timestamp of when the user action happened.
    properties:
        Optional JSON metadata bag (defaults to ``{}`` at the schema
        layer).
    user_id:
        The authenticated user's id. The router forces this from
        ``current_user.id`` regardless of any client-supplied value, so a
        caller can never impersonate another user.

    Returns
    -------
    Event
        The inserted row with ``id`` and ``server_received_at`` populated
        app-side.
    """
    event = Event(
        id=uuid.uuid4(),
        anonymous_id=anonymous_id,
        event_name=event_name,
        occurred_at=occurred_at,
        properties=properties,
        user_id=user_id,
        server_received_at=datetime.now(timezone.utc),
    )
    session.add(event)
    await session.flush()
    return event


async def insert_referral_attributed_event(
    session: AsyncSession,
    *,
    referee_id: uuid.UUID,
    referrer_id: uuid.UUID,
    referral_code: str,
    occurred_at: datetime,
) -> Event:
    """Persist the ``referral_attributed`` event for an attribution link.

    Phase 4.5. When a fresh signup is attributed to the user who referred them
    (at Apple Sign In), exactly one ``referral_attributed`` row is appended to
    the ``events`` table recording the link. This is the single repository
    surface for that write: it composes the pure
    :func:`api.referrals.attribution_event.build_referral_attributed_event`
    builder (the one source of truth for the row's ``event_name`` +
    ``properties`` shape) with :func:`insert_event` (the single INSERT
    primitive), so the auth router never re-spells the event shape inline and
    the persisted-row contract has exactly one home.

    The referee is recorded on **both** identity columns — authoritative
    ``user_id`` and the PostHog-style ``anonymous_id`` — so the row is
    attributable to the new signup. The ``referrer_id`` + ``referral_code``
    ride in the JSON ``properties`` bag for the analytics surface to
    reconstruct the referral graph without a join.

    As with :func:`insert_event`, the caller owns the surrounding transaction;
    this function only ``add``s the row and ``flush``es so the INSERT is issued
    inside the caller's transactional / error-handling scope (the auth router
    commits the ``referrer_user_id`` link and this event together as one unit).

    Parameters
    ----------
    session:
        The per-request :class:`AsyncSession` from
        :func:`api.db.session.get_session`.
    referee_id:
        The ``users.id`` of the freshly attributed signup. Written to both
        ``user_id`` and ``anonymous_id``.
    referrer_id:
        The ``users.id`` of the user who referred ``referee_id``. Stored as a
        string in the ``properties`` bag.
    referral_code:
        The referrer's per-user fixed 8-char ``referral_code`` the referee
        arrived with. Stored in the ``properties`` bag.
    occurred_at:
        The instant the attribution happened (the sign-in completion time).

    Returns
    -------
    Event
        The inserted row with ``id`` and ``server_received_at`` populated
        app-side.

    Raises
    ------
    ValueError
        If ``referrer_id`` renders empty or ``referral_code`` is blank — the
        builder's fail-fast guard surfaces before any row is staged, so no
        malformed event reaches the table.
    """
    attribution_event = build_referral_attributed_event(
        referrer_id=str(referrer_id),
        referral_code=referral_code,
    )
    return await insert_event(
        session,
        anonymous_id=str(referee_id),
        event_name=attribution_event.event_name,
        occurred_at=occurred_at,
        properties=attribution_event.properties,
        user_id=referee_id,
    )


async def fetch_cohort_user_ids(
    session: AsyncSession,
    *,
    event_name: str,
    window_start: datetime,
    window_end: datetime,
) -> list[str]:
    """Return the distinct cohort user ids for the retention denominator.

    The cohort is every distinct (non-null) ``user_id`` that emitted
    ``event_name`` with ``window_start <= occurred_at < window_end``.

    Parameters
    ----------
    session:
        The per-request :class:`AsyncSession`.
    event_name:
        The cohort-defining event name (e.g. ``magazine_delivered``).
    window_start:
        Inclusive lower bound (instant) of the cohort window.
    window_end:
        Exclusive upper bound (instant) of the cohort window.

    Returns
    -------
    list[str]
        Distinct user ids rendered as strings, sorted for deterministic
        output. Empty when no row matches (a valid, non-error case the
        core retention handler treats as ``retention_rate=0.0``).
    """
    stmt = (
        select(Event.user_id)
        .where(Event.event_name == event_name)
        .where(Event.user_id.is_not(None))
        .where(Event.occurred_at >= window_start)
        .where(Event.occurred_at < window_end)
        .distinct()
    )
    result = await session.execute(stmt)
    return sorted(str(row) for row in result.scalars().all() if row is not None)


async def fetch_active_user_ids(
    session: AsyncSession,
    *,
    event_name: str,
    window_start: datetime,
    window_end: datetime,
    cohort_user_ids: list[str],
) -> list[str]:
    """Return the distinct active user ids for the retention numerator.

    The active set is every distinct (non-null) ``user_id`` that emitted
    ``event_name`` with ``window_start <= occurred_at < window_end`` AND
    is also a member of ``cohort_user_ids``. Restricting to cohort
    membership keeps ``active_size`` a true subset of ``cohort_size`` (per
    the rolling-retention definition) even though the core calculator
    would intersect the sets anyway.

    Parameters
    ----------
    session:
        The per-request :class:`AsyncSession`.
    event_name:
        The active-defining event name (e.g. ``magazine_viewed``).
    window_start:
        Inclusive lower bound (instant) of the active window.
    window_end:
        Exclusive upper bound (instant) of the active window.
    cohort_user_ids:
        The cohort membership set from :func:`fetch_cohort_user_ids`. An
        empty cohort short-circuits to an empty active set without a
        round-trip (an ``IN ()`` predicate is degenerate).

    Returns
    -------
    list[str]
        Distinct active user ids rendered as strings, sorted for
        deterministic output.
    """
    if not cohort_user_ids:
        return []
    cohort_uuids = [uuid.UUID(value) for value in cohort_user_ids]
    stmt = (
        select(Event.user_id)
        .where(Event.event_name == event_name)
        .where(Event.user_id.in_(cohort_uuids))
        .where(Event.occurred_at >= window_start)
        .where(Event.occurred_at < window_end)
        .distinct()
    )
    result = await session.execute(stmt)
    return sorted(str(row) for row in result.scalars().all() if row is not None)


__all__ = [
    "fetch_active_user_ids",
    "fetch_cohort_user_ids",
    "insert_event",
    "insert_referral_attributed_event",
]
