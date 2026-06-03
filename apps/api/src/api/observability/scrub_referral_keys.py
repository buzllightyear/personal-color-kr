"""Recursive key-based referral-code scrubbing for Sentry events (Phase 7.2, AC-10).

# Why this module exists

``send_default_pii=False`` already stops Sentry's SDK from attaching obvious PII
(client IPs, cookies, request bodies). This module is part of the
*defense-in-depth* scrubbing layer the Phase 7.2 Seed mandates: a referral code
is a low-sensitivity but still user-correlatable identifier that links an event
back to a specific inviter/invitee relationship. When one slips into an event
under a recognizable field name — a ``referral_code`` in an exception ``extra``,
a ``referralCode`` in a breadcrumb ``data`` blob, a nested context dict — its
value must be redacted *before* the event is transmitted.

This concern is intentionally narrow and orthogonal to the other ``before_send``
rules (email key/regex scrubbing, JWT/auth-token scrubbing, auth-path body
dropping), each of which lives in its own helper. The composing ``_scrub_event``
hook in :mod:`api.observability.sentry` calls :func:`scrub_referral_keys` as one
step in the pipeline.

# Contract

:func:`scrub_referral_keys` walks the event structure recursively and replaces
the *value* of any mapping key whose name matches a known referral-code field
(case-insensitively) with :data:`REDACTED`, regardless of the value's type
(string, ``None``, nested dict, list, int, …).

The match is on the *whole key name* (normalized), never a substring and — per
the Seed's explicit AC-10 constraint — **never a value-pattern regex**. Referral
codes have no distinctive value shape (they look like ordinary short tokens), so
a value regex would be both unreliable (false negatives) and over-aggressive
(false positives on innocuous tokens). Keying on the field name is the correct,
precise strategy: ``referral_code`` / ``referralCode`` are scrubbed, while
unrelated keys such as ``code`` (an error code), ``referral_count``, or
``referrer_id`` are left untouched.

The function is **pure**: it returns a new structure and never mutates its
input. It never raises and never returns ``None`` for a dict input — honoring
the Seed's "always return a scrubbed event, never drop" invariant.
"""

from __future__ import annotations

from typing import Any, Final

#: Replacement marker substituted for every matched referral-code field value.
#: Shared spelling with the sibling scrubbers so a redacted Sentry event reads
#: consistently regardless of which rule fired.
REDACTED: Final[str] = "[redacted]"

#: Canonical referral-code field names the Seed enumerates for AC-10:
#: ``referral_code`` / ``referralCode``. Stored pre-normalized (lowercased) so
#: the runtime match is a single case-insensitive membership test. Public so
#: ``_scrub_event`` and tests can reference the canonical set rather than
#: re-typing literals.
REFERRAL_CODE_KEY_NAMES: Final[frozenset[str]] = frozenset(
    {
        "referral_code",
        "referralcode",  # the normalized (lowercased) form of ``referralCode``
    }
)


def _is_referral_code_key(key: Any) -> bool:
    """Return ``True`` when ``key`` is a known referral-code field name.

    The comparison is case-insensitive and matches the *whole* key only — a
    non-string key (Sentry payloads are JSON-shaped, but be defensive) never
    matches.
    """
    return isinstance(key, str) and key.lower() in REFERRAL_CODE_KEY_NAMES


def scrub_referral_keys(value: Any) -> Any:
    """Return a copy of ``value`` with referral-code field values redacted.

    Recursively walks mappings and sequences:

        * For a ``dict``: every key matching :data:`REFERRAL_CODE_KEY_NAMES`
          (case-insensitively) has its value replaced with :data:`REDACTED`;
          all other values are recursed into. A new ``dict`` is returned —
          the input is never mutated.
        * For a ``list`` / ``tuple``: each element is recursed into and a new
          ``list`` is returned (tuples are normalized to lists, matching how
          Sentry JSON-serializes sequences).
        * Any other value (``str``, ``int``, ``None``, …) is returned as-is.

    No value-pattern regex is applied — redaction is keyed entirely on the field
    name, per the AC-10 constraint.

    Parameters
    ----------
    value:
        A Sentry event dict, or any sub-structure of one. Callers pass the
        whole event; recursion supplies the nested fragments.

    Returns
    -------
    Any
        A scrubbed copy mirroring the input's shape. Never ``None`` for a dict
        input, never raises.
    """
    if isinstance(value, dict):
        return {
            key: (REDACTED if _is_referral_code_key(key) else scrub_referral_keys(item))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [scrub_referral_keys(item) for item in value]
    return value


__all__ = ["REDACTED", "REFERRAL_CODE_KEY_NAMES", "scrub_referral_keys"]
