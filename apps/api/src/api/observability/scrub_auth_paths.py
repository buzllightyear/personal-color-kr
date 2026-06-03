"""Auth-path request-body dropping for Sentry events (Phase 7.2, AC-11).

# Why this module exists

``send_default_pii=False`` already stops Sentry's SDK from attaching obvious PII
(client IPs, cookies, request bodies). This module is part of the
*defense-in-depth* scrubbing layer the Phase 7.2 Seed mandates, and it closes a
gap the key/value scrubbers cannot: the request bodies posted to the
authentication endpoints (``/v1/auth/...``) carry the most sensitive payloads in
the whole API — Apple identity tokens, authorization codes, and freshly-minted
backend JWTs. Those bodies have no single recognizable key shape (the token is
the *value* of an opaque field, sometimes a raw string body), so the safest rule
is categorical: if an event originated from an auth route, drop its captured
request **body** wholesale before the event is transmitted.

This concern is intentionally narrow and orthogonal to the other ``before_send``
rules (email key/regex scrubbing, JWT/auth-token key scrubbing, referral-code
key scrubbing), each of which lives in its own helper. The composing
``_scrub_event`` hook in :mod:`api.observability.sentry` calls
:func:`scrub_auth_path_request_body` as one step in the pipeline.

# Contract

:func:`scrub_auth_path_request_body` inspects the event's top-level ``request``
section. When that section is a mapping whose ``url`` value (a string) matches
:data:`AUTH_PATH_PATTERN` (``/v1/auth/`` appearing anywhere in the URL — a bare
path like ``/v1/auth/apple`` or an absolute ``https://api.example.com/v1/auth/refresh``
both match, case-insensitively), the request ``data`` (the captured body) is set
to ``None`` in the returned event. Every other field — including the request
``url``, ``method``, ``headers`` and ``query_string`` — is preserved so the event
remains useful for incident triage; only the body is dropped.

Unlike the recursive key/value scrubbers, this rule is deliberately *not*
recursive: a Sentry event has exactly one top-level ``request`` section, so the
function operates on that section alone and leaves all nested structures to the
sibling scrubbers.

The function is **pure**: it returns a new structure and never mutates its
input. It never raises and never returns ``None`` for a dict input — honoring
the Seed's "always return a scrubbed event, never drop" invariant. (Dropping the
request *body* is distinct from dropping the *event*: the event is always kept.)
"""

from __future__ import annotations

import re
from typing import Any, Final

#: Regex matching the auth URL family. The auth router is mounted under the
#: single ``/v1`` prefix (see ``main.create_app``), so every authentication
#: endpoint is reachable at ``/v1/auth/<action>``. A substring search for
#: ``/v1/auth/`` therefore matches whether Sentry captured a bare request path
#: (``/v1/auth/apple``) or an absolute URL
#: (``https://api.example.com/v1/auth/refresh?x=1``). Case-insensitive for
#: defensiveness against host-casing oddities. Public so ``_scrub_event`` and
#: tests can reference the canonical pattern rather than re-typing the literal.
AUTH_PATH_PATTERN: Final[re.Pattern[str]] = re.compile(r"/v1/auth/", re.IGNORECASE)


def _url_is_auth_path(url: Any) -> bool:
    """Return ``True`` when ``url`` is a string matching :data:`AUTH_PATH_PATTERN`.

    A non-string ``url`` (Sentry payloads are JSON-shaped, but be defensive —
    a missing or malformed ``url`` must not raise) never matches.
    """
    return isinstance(url, str) and AUTH_PATH_PATTERN.search(url) is not None


def scrub_auth_path_request_body(value: Any) -> Any:
    """Return a copy of ``value`` with the auth-route request body dropped.

    Operates on the event's top-level ``request`` section only:

        * For a ``dict`` whose ``request`` value is itself a mapping with a
          ``url`` matching :data:`AUTH_PATH_PATTERN`, a new event is returned in
          which ``request["data"]`` is ``None``. All other request fields
          (``url``, ``method``, ``headers``, ``query_string`` …) and all other
          top-level event fields are preserved verbatim (shallow-copied).
        * For any other ``dict`` (no ``request``, a non-mapping ``request``, or a
          ``request`` whose ``url`` is absent / not an auth path), a shallow copy
          is returned unchanged in content.
        * Any non-``dict`` value (``str``, ``list``, ``None``, …) is returned
          as-is — only a whole event carries a ``request`` section.

    Parameters
    ----------
    value:
        A Sentry event dict, or any value (handled defensively). Callers pass
        the whole event.

    Returns
    -------
    Any
        A scrubbed copy. Never ``None`` for a dict input, never raises. The
        event itself is always kept — only the auth request *body* is dropped.
    """
    if not isinstance(value, dict):
        return value

    request = value.get("request")
    if not isinstance(request, dict) or not _url_is_auth_path(request.get("url")):
        # Not an auth-route event: return a defensive shallow copy unchanged.
        return dict(value)

    # Auth route: copy the event and its request section, dropping the body.
    scrubbed_request = {**request, "data": None}
    return {**value, "request": scrubbed_request}


__all__ = ["AUTH_PATH_PATTERN", "scrub_auth_path_request_body"]
