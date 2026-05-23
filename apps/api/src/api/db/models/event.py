"""Append-only analytics ``events`` table (Phase 4.2, first persistence model).

The :class:`Event` declarative model owns the six-column ``events`` table
defined by the Phase 4.2 Seed. The shape is deliberately PostHog-aligned
so the Phase 4.4 cohort-sync layer can be a thin column-name mapper:

    PostHog field          ↔ ``events`` column
    ─────────────────────────────────────────────
    distinct_id            ↔ anonymous_id
    event                  ↔ event_name
    properties             ↔ properties (jsonb)
    timestamp              ↔ occurred_at (client clock)
    (server receive time)  ↔ server_received_at  ← clock-drift protection

# Schema (matches the Phase 4.2 AC verbatim)

    Column              Type           Nullable  Default
    -----------------------------------------------------------------
    id                  uuid (pk)      NOT NULL  (app-side uuid4)
    anonymous_id        text           NOT NULL  -
    event_name          text           NOT NULL  -
    properties          jsonb          NOT NULL  '{}'::jsonb
    occurred_at         timestamptz    NOT NULL  -
    server_received_at  timestamptz    NOT NULL  now()

# Indexes

    ix_events_anonymous_id        (anonymous_id)
    ix_events_event_name_occurred ((event_name, occurred_at))

The composite ``(event_name, occurred_at)`` index supports the dominant
read pattern ("most recent occurrences of event X") without pulling in a
full per-event-name partition.

# Append-only invariant

This module does not declare an ``updated_at`` column, an ``ON UPDATE``
trigger, or a soft-delete flag. The Phase 4.2 Seed pins the table as
append-only: writes are exclusively :sql:`INSERT`; PostHog cohort sync
and retention enforcement (Phase 4.4) work against immutable rows.

# UUID generation

``id`` is generated **app-side** via :func:`uuid.uuid4` (see ``default``
below). This avoids depending on a Postgres ``uuid-ossp`` /
``pgcrypto`` extension — the Phase 4.2 Seed explicitly defers extension
management to a later phase. ``server_default`` is intentionally NOT set
for ``id`` so the DDL inspector confirms the column ships without a
server-side default.

# Boundary contract

Living inside ``apps/api/src/api/db/models/`` keeps every
``sqlalchemy*`` import line under the Phase 4.1 AC11 single-import
boundary. Routers, schemas, and dependencies must consume :class:`Event`
through a future repository surface (Phase 4.4); never import this class
into ``apps/api/src/api/routers/`` directly.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.db.models.base import Base

# Constants pulled out of the class body so the migration file (and any
# future repository layer) can reference the same string literals without
# importing the ORM class. Single source of truth for the table name +
# index identifiers.
EVENTS_TABLE_NAME: str = "events"
INDEX_ANONYMOUS_ID: str = "ix_events_anonymous_id"
INDEX_EVENT_NAME_OCCURRED_AT: str = "ix_events_event_name_occurred_at"


class Event(Base):
    """Append-only analytics event row (Phase 4.2 first persistence table).

    # PostHog column mapping

    This model is intentionally PostHog-shaped so the Phase 4.4 cohort
    sync layer is a thin column-name mapper. The three required field
    aliases are pinned here so they live next to the column definitions
    they describe:

        * ``anonymous_id``       ↔ PostHog ``distinct_id``
        * ``event_name``         ↔ PostHog ``event``
        * ``occurred_at``        ↔ PostHog ``timestamp`` (client clock)

    Two supporting columns round out the PostHog-aligned shape:

        * ``properties``         ↔ PostHog ``properties`` (jsonb bag)
        * ``server_received_at`` ↔ server receive time (clock-drift
          protection; PostHog has no first-class equivalent)

    See the module docstring for the full schema contract and DDL
    introspection rules. Every column below maps 1:1 to a row in the
    Phase 4.2 Seed AC; deviating types or defaults breaks the
    integration test that introspects ``information_schema.columns``.
    """

    __tablename__ = EVENTS_TABLE_NAME

    # ----- id: uuid primary key, generated app-side via uuid4 -----
    # ``as_uuid=True`` makes the driver hand back ``uuid.UUID`` objects
    # instead of strings, which keeps the round-trip test honest about
    # type fidelity. No ``server_default`` on purpose — the Seed pins
    # UUID generation to the application (uuid4) so the schema stays
    # extension-free.
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )

    # ----- anonymous_id: PostHog ``distinct_id`` equivalent -----
    # PostHog alias: ``anonymous_id`` ↔ ``distinct_id``.
    # Stored as ``text`` (PostgreSQL ``TEXT`` has no length cap and the
    # planner treats it identically to ``VARCHAR`` without a length
    # constraint). Indexed via the ``Index(...)`` definition in
    # ``__table_args__`` below to support per-user lookup in Phase 4.4.
    anonymous_id: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ----- event_name: PostHog ``event`` equivalent -----
    # PostHog alias: ``event_name`` ↔ ``event``.
    # Same ``text`` rationale as ``anonymous_id``. Composite-indexed
    # with ``occurred_at`` to support "most recent occurrences of event
    # X" lookups, which is the dominant analytics read pattern.
    event_name: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # ----- properties: PostHog properties bag (jsonb) -----
    # ``server_default=text("'{}'::jsonb")`` is set so the column has a
    # database-side default matching the AC contract ("default '{}'");
    # ``default=dict`` makes the ORM-side INSERT statement carry the same
    # empty-object value when callers omit ``properties`` from the
    # constructor. Both spellings are required for the integration test:
    # the DDL inspector reads the server default, the ORM round-trip
    # uses the Python-side default when ``properties`` is omitted.
    properties: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    # ----- occurred_at: client-clock timestamptz, no default -----
    # PostHog alias: ``occurred_at`` ↔ ``timestamp``.
    # The Seed pins this to the client's wall clock (PostHog ``timestamp``
    # equivalent). No default — clients MUST supply a value, which the
    # POST /v1/events endpoint (deferred to a later phase) will validate.
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # ----- server_received_at: server-clock timestamptz, default now() -----
    # ``func.now()`` resolves to PostgreSQL ``NOW()`` (a.k.a.
    # ``CURRENT_TIMESTAMP``), which returns the transaction start time
    # in the session's timezone. Storing the server clock alongside the
    # client clock gives the analytics pipeline a clock-drift signal
    # without re-doing the receive-time tracking at the application
    # layer.
    server_received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        # Single-column index for "all events from anonymous_id X" lookups.
        Index(INDEX_ANONYMOUS_ID, "anonymous_id"),
        # Composite index for "most recent occurrences of event X".
        # Leading column is ``event_name`` because the query pattern
        # filters on event name first, then sorts by ``occurred_at``.
        Index(INDEX_EVENT_NAME_OCCURRED_AT, "event_name", "occurred_at"),
    )

    def __repr__(self) -> str:
        """Render an Event without leaking ``properties`` payload contents.

        The ``properties`` JSONB bag may contain user-supplied values that
        should not appear in logs verbatim. Showing only the key count
        keeps the repr useful for debugging without becoming a PII vector.
        """
        prop_count = len(self.properties) if self.properties is not None else 0
        return (
            f"Event(id={self.id!r}, anonymous_id={self.anonymous_id!r}, "
            f"event_name={self.event_name!r}, properties_keys={prop_count}, "
            f"occurred_at={self.occurred_at!r}, "
            f"server_received_at={self.server_received_at!r})"
        )
