"""Pydantic v2 request/response schemas for ``POST /v1/events`` (Phase 4.4).

This module owns the wire-format models bracketing the authenticated
single-event ingest endpoint. It is the single validation seam between
the client's JSON body and the handler's typed parameters.

Seed contract (Phase 4.4):

    * ``EventIngestRequest`` is what an authenticated client POSTs:
        * ``anonymous_id``: required ``str`` — PostHog ``distinct_id``
          equivalent. Stored verbatim; never used for identification.
        * ``event_name``: required ``str`` matching ``^[a-z_]+$`` — the
          snake_case event identifier (e.g. ``magazine_delivered``).
        * ``occurred_at``: required ``datetime`` — client wall-clock time
          of the action.
        * ``properties``: optional JSON object, defaults to ``{}``.

      The request model deliberately does **NOT** declare a ``user_id``
      field. Pydantic v2 ignores unknown keys by default (``extra``
      unset), so a client that sends ``user_id`` in the body has it
      silently dropped — the handler always forces ``user_id`` from the
      authenticated user (``current_user.id``), preventing impersonation.

    * ``EventIngestResponse`` is the HTTP 201 body echoing the persisted
      row's server-authoritative fields (``event_id``, the forced
      ``user_id``, and ``server_received_at``) so the client can confirm
      what was stored without a follow-up read.

Design notes:
    * This module imports no SQLAlchemy, no httpx — it is a pure
      validation surface with no I/O dependencies.
    * ``event_name`` validation lives here (regex) rather than in the
      repository so a malformed name is rejected with HTTP 422 at the
      boundary before any DB work.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

#: Snake_case event-name contract: lowercase ASCII letters and underscores
#: only. Pinned here as the single source of truth so the schema and any
#: documentation reference the same pattern.
EVENT_NAME_PATTERN: str = r"^[a-z_]+$"


class EventIngestRequest(BaseModel):
    """JSON request body for ``POST /v1/events``.

    Declares exactly four fields. ``user_id`` is intentionally absent: the
    handler forces it from the authenticated user, and Pydantic's default
    "ignore unknown keys" behavior means a client-supplied ``user_id`` is
    dropped rather than rejected (the Seed pins "ignore client-supplied
    user_id", not "reject requests carrying user_id").
    """

    anonymous_id: str = Field(
        min_length=1,
        description=(
            "PostHog distinct_id equivalent. Stored verbatim; not used "
            "for identification."
        ),
    )
    event_name: str = Field(
        pattern=EVENT_NAME_PATTERN,
        description=(
            "Snake_case event identifier matching ^[a-z_]+$ "
            "(e.g. magazine_delivered)."
        ),
    )
    occurred_at: datetime = Field(
        description="Client wall-clock timestamp of when the action happened.",
    )
    properties: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional JSON metadata bag attached to the event.",
    )


class EventIngestResponse(BaseModel):
    """JSON response body (HTTP 201) for ``POST /v1/events``.

    Echoes the server-authoritative fields of the persisted row so the
    client can confirm the ingest without a follow-up read. ``user_id`` is
    the value forced from the authenticated user — surfacing it here makes
    the impersonation-prevention contract observable end-to-end.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    user_id: uuid.UUID
    event_name: str
    occurred_at: datetime
    server_received_at: datetime


__all__ = [
    "EVENT_NAME_PATTERN",
    "EventIngestRequest",
    "EventIngestResponse",
]
