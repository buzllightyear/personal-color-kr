"""Pydantic v2 response schema for ``GET /v1/referrals/me`` (Phase 4.5).

This module owns the wire-format response model that the referrals
endpoint projects for an authenticated user. It is the *single*
serialization seam between the handler's typed values (the user's fixed
referral code, the server-assembled share URL, and the live friend-used
count) and the JSON body returned to the mobile client.

Seed contract (Phase 4.5):
    - ``referral_code``: ``str`` — the authenticated user's per-user fixed
      8-char URL-safe referral code (``users.referral_code``). Issued at
      sign-in upsert and never rotated.
    - ``share_url``: ``str`` — the *server-assembled* full share URL,
      combining the ``REFERRAL_BASE_URL`` env var with the user's
      ``referral_code``. The server is the single source of truth for this
      string — the mobile client carries no ``REFERRAL_BASE_URL`` constant
      and never assembles the URL itself (Seed: single_source_of_truth).
    - ``friend_used_count``: ``int`` — the count of users whose
      ``referrer_user_id`` equals the current user's id, i.e. how many
      friends signed in through this user's referral. No reward/entitlement
      mechanics ride on this number in Phase 4.5; it is a display value.

Design notes:
    - ``model_config = ConfigDict(extra="forbid")`` guards against silent
      field drift between the handler payload and this wire contract — an
      accidental extra key surfaces as a validation error in tests rather
      than leaking through.
    - This module imports no SQLAlchemy, no httpx — a pure validation
      surface with no I/O dependencies, mirroring the other schema modules
      in :mod:`api.schemas`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ReferralMeResponse(BaseModel):
    """HTTP 200 body for ``GET /v1/referrals/me``.

    Carries the authenticated user's fixed referral code, the
    server-assembled share URL, and the live friend-used count.

    Fields (Seed-pinned):

    * ``referral_code``: the user's per-user fixed 8-char URL-safe code.
    * ``share_url``: the server-assembled ``REFERRAL_BASE_URL`` + code URL
      (single source of truth lives server-side).
    * ``friend_used_count``: number of users referred by this user.
    """

    model_config = ConfigDict(extra="forbid")

    referral_code: str
    share_url: str
    friend_used_count: int


__all__ = ["ReferralMeResponse"]
