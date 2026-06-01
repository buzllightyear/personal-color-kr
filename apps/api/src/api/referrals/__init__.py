"""Referral domain package (Phase 4.5).

Hosts the server-side referral logic seams that sit between the auth /
referrals HTTP handlers and the persistence boundary:

    * :mod:`api.referrals.share_url` — assembles a user's shareable URL from
      the ``REFERRAL_BASE_URL`` env var and a per-user ``referral_code``. The
      server is the *single source of truth* for this string (Seed:
      single_source_of_truth); the mobile client never assembles it.

The package deliberately imports no SQLAlchemy at import time — the share-URL
builder is a pure string assembly with an env-config dependency only.
"""

from __future__ import annotations

__all__: list[str] = []
