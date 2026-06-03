"""Recursive key-based auth-secret scrubbing for Sentry events (Phase 7.2).

# Why this module exists

``send_default_pii=False`` already stops Sentry's SDK from attaching obvious PII
(client IPs, cookies, request bodies). This module is part of the
*defense-in-depth* scrubbing layer the Phase 7.2 Seed mandates: even when an
authentication secret slips into an event under a recognizable field name — an
``Authorization`` header captured in a context dict, an ``access_token`` in an
exception ``extra``, a ``password`` in a breadcrumb ``data`` blob — its value
must be redacted *before* the event is transmitted.

This concern is intentionally narrow and orthogonal to the other ``before_send``
rules (email key/regex scrubbing, JWT-shaped string regex, referral codes,
auth-path body dropping), each of which lives in its own helper. The composing
``_scrub_event`` hook in :mod:`api.observability.sentry` calls
:func:`scrub_auth_keys` as one step in the pipeline.

# Contract

:func:`scrub_auth_keys` walks the event structure recursively and replaces the
*value* of any mapping key whose (case-insensitively normalized) name *contains*
one of the :data:`AUTH_KEY_PATTERNS` substrings with :data:`REDACTED`,
regardless of the value's type (string, ``None``, nested dict, list, int, …).

Unlike the email scrubber — which matches the *whole* key name — auth secrets
appear under a wide family of decorated field names (``access_token``,
``refresh_token``, ``X-Authorization``, ``jwt_payload``, ``db_password``,
``stripe_secret``, ``bearer_header`` …). Matching on a *substring* is therefore
the correct, more aggressive strategy here: over-redaction of an auth-shaped
field is safe, under-redaction leaks a credential.

The function is **pure**: it returns a new structure and never mutates its
input. It never raises and never returns ``None`` for a dict input — honoring
the Seed's "always return a scrubbed event, never drop" invariant.
"""

from __future__ import annotations

from typing import Any, Final

#: Replacement marker substituted for every matched auth field value. Shared
#: spelling with the email scrubber so the Sentry UI shows one consistent
#: redaction sentinel.
REDACTED: Final[str] = "[redacted]"

#: Case-insensitive key *substrings* that mark an auth-sensitive field. The
#: Seed enumerates these for the auth-token scrubbing rule. Stored pre-normalized
#: (lowercased) so the runtime match is a substring test against the lowercased
#: key. Public so ``_scrub_event`` and tests can reference the canonical set
#: rather than re-typing literals.
AUTH_KEY_PATTERNS: Final[tuple[str, ...]] = (
    "token",
    "jwt",
    "bearer",
    "authorization",
    "secret",
    "password",
    "api_key",
)


def _is_auth_key(key: Any) -> bool:
    """Return ``True`` when ``key`` contains an auth-sensitive substring.

    The comparison is case-insensitive and matches on a *substring* of the key
    name — a non-string key (Sentry payloads are JSON-shaped, but be defensive)
    never matches.
    """
    if not isinstance(key, str):
        return False
    lowered = key.lower()
    return any(pattern in lowered for pattern in AUTH_KEY_PATTERNS)


def scrub_auth_keys(value: Any) -> Any:
    """Return a copy of ``value`` with auth-secret field values redacted.

    Recursively walks mappings and sequences:

        * For a ``dict``: every key whose lowercased name contains an
          :data:`AUTH_KEY_PATTERNS` substring has its value replaced with
          :data:`REDACTED`; all other values are recursed into. A new ``dict``
          is returned — the input is never mutated.
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
            key: (REDACTED if _is_auth_key(key) else scrub_auth_keys(item))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [scrub_auth_keys(item) for item in value]
    return value


__all__ = ["AUTH_KEY_PATTERNS", "REDACTED", "scrub_auth_keys"]
