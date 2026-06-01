"""Builder for the ``referral_attributed`` analytics event (Phase 4.5).

# Why this module exists

When a fresh signup is attributed to the user who referred them (at Apple Sign
In), the auth flow appends exactly one row to the append-only ``events`` table
recording the link. The Seed's ``referral_attributed_event`` concept pins that
row's shape:

    * ``event_name`` is the literal ``"referral_attributed"`` (matching the
      ``^[a-z_]+$`` shape the events schema enforces),
    * ``properties`` is a JSON bag carrying exactly ``referrer_id`` and
      ``referral_code`` so the Phase 4.4+ analytics surface can reconstruct the
      referral graph without a join.

This module is the *one* place that assembles that record. Keeping it a pure,
DB-ignorant function (no SQLAlchemy, no session) lets the auth router build the
event in a single source of truth and lets the unit tests pin the contract
directly — the record can never drift between the builder and a hand-rolled
``insert_event`` call site.

# Boundary contract

    * :func:`build_referral_attributed_event` is a pure, side-effect-free
      assembly. It returns an immutable :class:`ReferralAttributedEvent` whose
      ``event_name`` / ``properties`` feed straight into the events repository's
      :func:`api.db.repositories.events_repository.insert_event`.
    * A blank ``referrer_id`` or ``referral_code`` raises :class:`ValueError`
      rather than emitting a malformed event — both are load-bearing identifiers
      on the referral graph, so a blank one is a programming error worth
      surfacing (mirrors the ``build_share_url`` fail-fast posture).
    * No SQLAlchemy, no httpx — a pure function with no I/O dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

# The ``event_name`` written to the append-only ``events`` table whenever a
# fresh signup is successfully attributed to the user who referred them. The
# name matches the ``^[a-z_]+$`` shape the events schema enforces. This is the
# canonical home for the constant; the auth router re-exports it.
REFERRAL_ATTRIBUTED_EVENT_NAME: Final[str] = "referral_attributed"

# The two ``properties`` JSONB keys the analytics surface reads to reconstruct
# the referral graph. Named constants keep the builder, the auth router, and the
# tests in lockstep on the exact key spelling.
REFERRAL_ATTRIBUTED_PROP_REFERRER_ID: Final[str] = "referrer_id"
REFERRAL_ATTRIBUTED_PROP_REFERRAL_CODE: Final[str] = "referral_code"


@dataclass(frozen=True)
class ReferralAttributedEvent:
    """Immutable description of a ``referral_attributed`` event row.

    Carries only the two fields the caller needs to hand to
    :func:`api.db.repositories.events_repository.insert_event`:

        * ``event_name`` — always :data:`REFERRAL_ATTRIBUTED_EVENT_NAME`,
        * ``properties`` — ``{"referrer_id": ..., "referral_code": ...}``.

    ``frozen=True`` prevents the record itself from being rebound after
    construction (the ``properties`` dict is freshly built per call, so no two
    records share a bag).
    """

    event_name: str
    properties: dict[str, str]


def build_referral_attributed_event(
    *, referrer_id: str, referral_code: str
) -> ReferralAttributedEvent:
    """Assemble the ``referral_attributed`` event record for a referral link.

    Parameters
    ----------
    referrer_id:
        The ``users.id`` of the user who referred the new signup, rendered as a
        string (the JSON ``properties`` bag holds string values). Must be
        non-empty.
    referral_code:
        The referrer's per-user fixed 8-char URL-safe ``referral_code`` that the
        referee arrived with. Must be non-empty.

    Returns
    -------
    ReferralAttributedEvent
        An immutable record whose ``event_name`` is
        :data:`REFERRAL_ATTRIBUTED_EVENT_NAME` and whose ``properties`` is a
        fresh ``{"referrer_id": referrer_id, "referral_code": referral_code}``
        dict.

    Raises
    ------
    ValueError
        If ``referrer_id`` or ``referral_code`` is empty or whitespace-only.
    """
    if not referrer_id or not referrer_id.strip():
        raise ValueError(
            "referrer_id must be a non-empty string to build a "
            "referral_attributed event."
        )
    if not referral_code or not referral_code.strip():
        raise ValueError(
            "referral_code must be a non-empty string to build a "
            "referral_attributed event."
        )

    return ReferralAttributedEvent(
        event_name=REFERRAL_ATTRIBUTED_EVENT_NAME,
        properties={
            REFERRAL_ATTRIBUTED_PROP_REFERRER_ID: referrer_id,
            REFERRAL_ATTRIBUTED_PROP_REFERRAL_CODE: referral_code,
        },
    )


__all__ = [
    "REFERRAL_ATTRIBUTED_EVENT_NAME",
    "REFERRAL_ATTRIBUTED_PROP_REFERRAL_CODE",
    "REFERRAL_ATTRIBUTED_PROP_REFERRER_ID",
    "ReferralAttributedEvent",
    "build_referral_attributed_event",
]
