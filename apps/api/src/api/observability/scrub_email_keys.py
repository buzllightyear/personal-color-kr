"""Recursive key-based email scrubbing for Sentry events (Phase 7.2, AC-7).

# Why this module exists

``send_default_pii=False`` already stops Sentry's SDK from attaching obvious PII
(client IPs, cookies, request bodies). This module is the *defense-in-depth*
layer the Phase 7.2 Seed mandates: even when an email address slips into an
event under a well-known field name — a breadcrumb ``data`` blob, an exception
``extra``, a tag value, a nested context dict — it must be redacted *before*
the event is transmitted.

This concern is intentionally narrow and orthogonal to the other ``before_send``
rules (email-in-string regex, auth tokens, referral codes, auth-path body
dropping), each of which lives in its own helper. The composing ``_scrub_event``
hook in :mod:`api.observability.sentry` calls :func:`scrub_email_keys` as one
step in the pipeline.

# Contract

:func:`scrub_email_keys` walks the event structure recursively and replaces the
*value* of any mapping key whose name matches a known email field
(case-insensitively) with :data:`REDACTED`, regardless of the value's type
(string, ``None``, nested dict, list, int, …). The match is on the *whole key
name* (normalized), never a substring — so ``email`` is scrubbed but
``email_verified`` / ``emails`` are left untouched (those are not PII-bearing
email-address fields and dropping them would corrupt the event shape).

The function is **pure**: it returns a new structure and never mutates its
input. It never raises and never returns ``None`` for a dict input — honoring
the Seed's "always return a scrubbed event, never drop" invariant.
"""

from __future__ import annotations

from typing import Any, Final

#: Replacement marker substituted for every matched email field value. Chosen
#: to be human-legible in the Sentry UI and unmistakably a redaction sentinel.
REDACTED: Final[str] = "[redacted]"

#: Canonical email field names the Seed enumerates for AC-7:
#: ``email`` / ``user_email`` / ``userEmail``. Stored pre-normalized (lowercased)
#: so the runtime match is a single case-insensitive membership test. Public so
#: ``_scrub_event`` and tests can reference the canonical set rather than
#: re-typing literals.
EMAIL_KEY_NAMES: Final[frozenset[str]] = frozenset(
    {
        "email",
        "user_email",
        "useremail",  # the normalized (lowercased) form of ``userEmail``
    }
)


def _is_email_key(key: Any) -> bool:
    """Return ``True`` when ``key`` is a known email field name.

    The comparison is case-insensitive and matches the *whole* key only — a
    non-string key (Sentry payloads are JSON-shaped, but be defensive) never
    matches.
    """
    return isinstance(key, str) and key.lower() in EMAIL_KEY_NAMES


def scrub_email_keys(value: Any) -> Any:
    """Return a copy of ``value`` with email-field values redacted.

    Recursively walks mappings and sequences:

        * For a ``dict``: every key matching :data:`EMAIL_KEY_NAMES`
          (case-insensitively) has its value replaced with :data:`REDACTED`;
          all other values are recursed into. A new ``dict`` is returned —
          the input is never mutated.
        * For a ``list`` / ``tuple``: each element is recursed into and a new
          ``list`` is returned (tuples are normalized to lists, matching how
          Sentry JSON-serializes sequences).
        * Any other value (``str``, ``int``, ``None``, …) is returned as-is.

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
            key: (REDACTED if _is_email_key(key) else scrub_email_keys(item))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [scrub_email_keys(item) for item in value]
    return value


__all__ = ["EMAIL_KEY_NAMES", "REDACTED", "scrub_email_keys"]
