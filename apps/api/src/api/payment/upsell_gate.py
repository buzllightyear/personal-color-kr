"""업셀 수락 게이트 — Glam Up 결제 깔때기 upsell step gate (Sub-AC 3-3).

Pure, side-effect-free function that accepts an upsell offer response
status and returns whether the current funnel step can be passed.

Three response states
---------------------
- ACCEPTED    (수락):   user accepted the upsell offer → step gate PASSES
- REJECTED    (거절):   user explicitly declined       → step gate PASSES
                        (Korean market: avoid pressure; rejection = informed
                        decision → user may proceed to base plan)
- NO_RESPONSE (미응답): user has not responded yet     → step gate BLOCKS

Design rationale
----------------
The gate is intentionally permissive for both ACCEPTED and REJECTED
(double-pass gate), because the Seed's Korean market constraint
explicitly forbids coercive funnel mechanics.  A user who says "no" to
the annual-plan upsell has made an active, deliberate choice and must
not be trapped in an unanswered screen.

NO_RESPONSE is the only blocking state — the user has simply not yet
engaged with the offer.  Blocking here prompts them to react (accept or
reject) rather than allowing a silent scroll-past, which is a gentle
nudge without being coercive.

Seed constraints honored
------------------------
- "강제 메커니즘 거부감 회피" — rejection is allowed through; no dark
  pattern that traps users on the upsell screen forever.
- Conversion guardrail: rate is a *floor*, not a target.  This gate
  does not maximize conversion; it simply blocks non-response.
- Pure function: no I/O, no state mutation, no side effects.
  Suitable for deterministic unit testing without any fixtures.
"""

from __future__ import annotations

from enum import Enum

# ---------------------------------------------------------------------------
# Response state enum
# ---------------------------------------------------------------------------


class UpsellResponseStatus(str, Enum):
    """The three possible states for an upsell offer response.

    Inheriting from ``str`` makes the values JSON-serialisable and allows
    the enum to be used directly as a Pydantic field type without a custom
    validator.

    Values
    ------
    ACCEPTED   : "accepted"
    REJECTED   : "rejected"
    NO_RESPONSE: "no_response"
    """

    ACCEPTED = "accepted"
    """User accepted the upsell offer (e.g. upgraded to annual plan)."""

    REJECTED = "rejected"
    """User explicitly declined the upsell offer (active choice)."""

    NO_RESPONSE = "no_response"
    """User has not responded to the upsell offer yet (passive / timeout)."""


# ---------------------------------------------------------------------------
# Gate function
# ---------------------------------------------------------------------------


def can_pass_upsell_gate(status: UpsellResponseStatus) -> bool:
    """Return whether the upsell gate step can be passed.

    This is a **pure function**: given the same ``status`` it always returns
    the same ``bool`` with no observable side effects.

    Parameters
    ----------
    status:
        The user's response to the upsell offer.  Must be a valid
        :class:`UpsellResponseStatus` member.

    Returns
    -------
    bool
        ``True``  — ACCEPTED or REJECTED (both allow proceeding to the
                    next funnel step).
        ``False`` — NO_RESPONSE (user must actively respond first; the
                    funnel step is blocked until they engage).

    Raises
    ------
    TypeError
        If ``status`` is not a :class:`UpsellResponseStatus` member.

    Examples
    --------
    >>> can_pass_upsell_gate(UpsellResponseStatus.ACCEPTED)
    True
    >>> can_pass_upsell_gate(UpsellResponseStatus.REJECTED)
    True
    >>> can_pass_upsell_gate(UpsellResponseStatus.NO_RESPONSE)
    False
    """
    if not isinstance(status, UpsellResponseStatus):
        raise TypeError(
            f"status must be a UpsellResponseStatus member, "
            f"got {type(status).__name__!r}: {status!r}"
        )
    return status in (UpsellResponseStatus.ACCEPTED, UpsellResponseStatus.REJECTED)


__all__ = ["UpsellResponseStatus", "can_pass_upsell_gate"]
