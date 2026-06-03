"""API observability package (Phase 7.2).

Hosts the Sentry SDK integration layer for the API: environment-aware
initialization (``sentry.py``) and the per-concern PII scrubbing helpers that
the ``before_send`` hook composes before any event leaves the process.

Each scrubbing concern lives in its own small, pure module so the rules can be
authored, tested, and composed independently:

    * :mod:`api.observability.scrub_email_keys` — recursive, key-based email
      field redaction (``email`` / ``user_email`` / ``userEmail``).
    * :mod:`api.observability.scrub_email_strings` — recursive, regex-based
      redaction of email addresses embedded in arbitrary string *values*
      (e.g. an exception message ``"User alice@example.com not found"``).

The composing ``_scrub_event`` hook in ``sentry.py`` calls each helper in turn
and always returns a scrubbed event (never ``None`` — no event dropping).
"""

from __future__ import annotations
