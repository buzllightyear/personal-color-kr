"""Recursive regex-based email scrubbing for Sentry events (Phase 7.2, AC-8).

# Why this module exists

``send_default_pii=False`` stops Sentry's SDK from attaching obvious PII, and
:mod:`api.observability.scrub_email_keys` (AC-7) redacts email *fields* matched
by their key name. But an email address frequently leaks **embedded inside a
free-form string value** where no key name betrays it — the most common case
being an exception message such as ``"User alice@example.com not found"`` or a
breadcrumb / log line interpolated with an address.

This module is the complementary *value-content* scrubbing layer the Phase 7.2
Seed mandates for AC-8: it walks the event structure and, for every **string
value**, substitutes any substring matching a standard email pattern with
:data:`REDACTED`. It is orthogonal to the key-based rule — together they close
both the "PII under a known key" and "PII embedded in arbitrary text" gaps.

# Contract

:func:`scrub_email_strings` walks the event recursively and rewrites string
values only:

    * For a ``str``: every email-shaped substring is replaced with
      :data:`REDACTED` (all occurrences, case-insensitively). A string with no
      email is returned unchanged.
    * For a ``dict``: values are recursed into and a new ``dict`` is returned.
      **Keys are left untouched** — keys are structural (``"message"``,
      ``"exception"``); rewriting them would corrupt the event shape, and the
      Seed scopes this rule to string *values*.
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

#: Replacement marker substituted for every email-shaped substring. Matches the
#: sentinel used by the sibling key-based scrubber so a redacted Sentry event
#: reads consistently regardless of which rule fired.
REDACTED: Final[str] = "[redacted]"

#: Standard, pragmatic email pattern (deliberately *not* full RFC 5322 — that
#: grammar over-matches and is unmaintainable). It matches a local part
#: (alphanumerics plus ``. _ % + -``), an ``@``, a domain of one-or-more
#: dot-separated labels, and a 2+ letter TLD. Case is handled by
#: :data:`re.IGNORECASE` so ``ALICE@EXAMPLE.COM`` is caught too.
#:
#: It is intentionally conservative on the "no false negatives" axis the
#: evaluation pins: plus-addressing (``a+tag@x.io``), dotted local parts, and
#: multi-label domains (``a@mail.corp.example.co.uk``) all match, while strings
#: lacking a dotted TLD (``@handle``, ``a@b``) are left alone.
EMAIL_REGEX: Final[re.Pattern[str]] = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}",
    re.IGNORECASE,
)


def scrub_email_string(text: str) -> str:
    """Return ``text`` with every email-shaped substring replaced.

    The atomic, non-recursive primitive: applies :data:`EMAIL_REGEX` to a
    single string and substitutes :data:`REDACTED` for each match (all
    occurrences). A string containing no email is returned unchanged (the
    same object, since :meth:`re.Pattern.sub` returns the input when there is
    no match).
    """
    return EMAIL_REGEX.sub(REDACTED, text)


def scrub_email_strings(value: Any) -> Any:
    """Return a copy of ``value`` with emails in string values redacted.

    Recursively walks mappings and sequences, rewriting only ``str`` *values*:

        * ``str`` -> :func:`scrub_email_string` applied (regex substitution).
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
        return scrub_email_string(value)
    if isinstance(value, dict):
        return {key: scrub_email_strings(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub_email_strings(item) for item in value]
    return value


__all__ = [
    "EMAIL_REGEX",
    "REDACTED",
    "scrub_email_string",
    "scrub_email_strings",
]
