"""Recursive regex-based JWT-shaped-string scrubbing for Sentry events (Phase 7.2).

# Why this module exists

``send_default_pii=False`` stops Sentry's SDK from attaching obvious PII, and
:mod:`api.observability.scrub_auth_keys` redacts auth secrets matched by their
*key name*. But a JSON Web Token frequently leaks **embedded inside a free-form
string value** where no key name betrays it — an ``Authorization: Bearer eyJ…``
header captured in an exception message, a token interpolated into a log line or
breadcrumb, a deep-link URL carrying ``?token=eyJ…`` copied into a tag value.

A JWT is a bearer credential: whoever holds it can impersonate the subject until
it expires. It must never reach Sentry. This module is the complementary
*value-content* scrubbing layer the Phase 7.2 Seed mandates for the JWT rule: it
walks the event structure and, for every **string value**, substitutes any
substring matching the JWT shape with :data:`REDACTED_JWT`. It is orthogonal to
the key-based auth rule — together they close both the "token under a known key"
and "token embedded in arbitrary text" gaps.

# Contract

:func:`scrub_jwt_strings` walks the event recursively and rewrites string values
only:

    * For a ``str``: every JWT-shaped substring is replaced with
      :data:`REDACTED_JWT` (all occurrences). A string with no JWT is returned
      unchanged.
    * For a ``dict``: values are recursed into and a new ``dict`` is returned.
      **Keys are left untouched** — keys are structural; the rule scopes to
      string *values*.
    * For a ``list`` / ``tuple``: each element is recursed into and a new
      ``list`` is returned (tuples normalize to lists, matching how Sentry
      JSON-serializes sequences).
    * Any other value (``int``, ``None``, ``bool``, …) is returned as-is.

The function is **pure**: it returns a new structure and never mutates its
input. It never raises and never returns ``None`` for a dict input — honoring
the Seed's "always return a scrubbed event, never drop" invariant.
"""

from __future__ import annotations

import re
from typing import Any, Final

#: Replacement marker substituted for every JWT-shaped substring. Deliberately
#: distinct from the generic ``[redacted]`` sentinel so a redacted Sentry event
#: makes explicit *which* rule fired — a JWT-shaped string was removed — aiding
#: incident triage without exposing the credential.
REDACTED_JWT: Final[str] = "[redacted-jwt]"

#: JWT-shape pattern: three base64url segments separated by dots, anchored on
#: the canonical ``eyJ`` header prefix.
#:
#: A JWS-compact JWT is ``header.payload.signature`` where each segment is
#: base64url (alphabet ``A-Za-z0-9_-``, no padding). The header is the
#: base64url encoding of a JSON object beginning ``{"`` — which is *always*
#: ``eyJ``. Anchoring on ``eyJ`` is what discriminates a real token from an
#: innocuous dotted triple such as ``a.b.c`` or a semantic version
#: ``1.2.3``, keeping the rule free of false positives while catching every
#: genuinely token-shaped string (no false negatives — the evaluation axis).
#:
#: Each segment requires one-or-more base64url characters, so unsigned
#: (``alg=none``) tokens with an empty signature are intentionally *not* matched
#: by this value-content rule; such strings carry no usable credential. The
#: match is greedy per-segment but base64url excludes whitespace and most
#: punctuation, so an embedded token terminates cleanly at its surrounding text.
JWT_REGEX: Final[re.Pattern[str]] = re.compile(
    r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"
)


def scrub_jwt_string(text: str) -> str:
    """Return ``text`` with every JWT-shaped substring replaced.

    The atomic, non-recursive primitive: applies :data:`JWT_REGEX` to a single
    string and substitutes :data:`REDACTED_JWT` for each match (all
    occurrences). A string containing no JWT is returned unchanged (the same
    object, since :meth:`re.Pattern.sub` returns the input when there is no
    match).
    """
    return JWT_REGEX.sub(REDACTED_JWT, text)


def scrub_jwt_strings(value: Any) -> Any:
    """Return a copy of ``value`` with JWT-shaped strings redacted.

    Recursively walks mappings and sequences, rewriting only ``str`` *values*:

        * ``str`` -> :func:`scrub_jwt_string` applied (regex substitution).
        * ``dict`` -> a new dict; keys preserved verbatim, values recursed.
        * ``list`` / ``tuple`` -> a new list with each element recursed.
        * anything else -> returned unchanged.

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
    if isinstance(value, str):
        return scrub_jwt_string(value)
    if isinstance(value, dict):
        return {key: scrub_jwt_strings(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub_jwt_strings(item) for item in value]
    return value


__all__ = [
    "JWT_REGEX",
    "REDACTED_JWT",
    "scrub_jwt_string",
    "scrub_jwt_strings",
]
