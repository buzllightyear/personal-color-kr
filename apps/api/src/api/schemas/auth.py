"""Pydantic v2 request/response schemas for the Apple Sign In boundary (Phase 4.3).

This module owns the wire-format models that bracket the
``POST /v1/auth/sign-in-with-apple`` endpoint. It is the *single* validation
seam between the mobile client's JSON body and the handler's typed
parameters — the handler never reads from the raw request body.

Seed contract (Phase 4.3):
    - ``SignInWithAppleRequest`` is what the mobile client POSTs:
        * ``identity_token``: required ``str`` — the Apple ID token (JWT)
          the mobile client received from Sign In with Apple. Token
          validation (JWKS lookup, signature, ``aud``/``iss``/``exp``
          checks) is performed by the Apple verifier seam, *not* this
          model — Pydantic only enforces the wire *shape*.
        * ``full_name``: ``Optional[str]`` — present only on the *first*
          authorization per Apple's UX contract. Re-auth requests omit it.
          The handler must not overwrite an existing non-null
          ``users.display_name`` with ``NULL`` or an empty string on
          re-auth (Seed: "display_name MUST NOT be overwritten with NULL
          or empty string on re-auth").
        * ``email``: ``Optional[str]`` — present only on the first
          authorization (or when the user opts to share it). The handler
          cross-validates this body value against the ``email`` claim
          decoded from ``identity_token`` and raises HTTP 400 on
          mismatch. The schema does *not* perform that cross-check; it
          only enforces the type.
        * ``referral_code``: ``Optional[str]`` — the referrer's 8-char
          URL-safe referral code, forwarded by the mobile client from
          its AsyncStorage stash. Optional: organic sign-ups omit it.
          The handler performs the referee → referrer attribution
          (validity, self-referral, already-attributed guards); the
          schema only enforces the optional-string shape.

Design notes:
    - ``identity_token`` is typed as a plain ``str``. The Seed pins JWT
      shape validation to the Apple verifier seam — pushing it into
      Pydantic would split the validation surface and tempt callers to
      bypass the verifier. The schema-level invariant is "it is a string
      and it is present."
    - ``full_name`` and ``email`` default to ``None`` (not the empty
      string) so the handler can distinguish "the client omitted the
      field" from "the client sent an empty value." The display_name
      preservation invariant on re-auth depends on this distinction.
    - This module imports no SQLAlchemy, no httpx, no PyJWT — the schema
      is a pure validation surface with no I/O dependencies.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserPublic(BaseModel):
    """Public, PII-aware projection of a :class:`api.db.models.user.User` row.

    Returned by the sign-in endpoint inline (``response.user``) so the
    mobile client can render the welcome state without a follow-up
    ``GET /v1/me`` round-trip. The same schema will back ``GET /v1/me``
    when it lands in Phase 4.4+, so changes here ripple into both
    surfaces — keep the field set minimal.

    Fields (Seed-pinned):

    * ``id``: the backend ``users.id`` UUID (serialized as a string).
    * ``email``: the user's email or ``None`` if Apple omitted it.
    * ``display_name``: the user's display name or ``None``.
    * ``created_at``: ISO-8601 timestamp of first sign-in.

    Note that ``apple_sub`` is deliberately absent — leaking Apple's
    opaque identifier to the client surface would let an attacker who
    breaches the mobile-side storage correlate users across apps.
    ``email_verified`` is also absent: the UI does not branch on it in
    Phase 4.3, and exposing it would tempt callers to use the boolean
    as a security signal (it is not — Apple only asserts the flag at
    sign-up).
    """

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    email: str | None
    display_name: str | None
    created_at: datetime


class SignInWithAppleResponse(BaseModel):
    """JSON response body for ``POST /v1/auth/sign-in-with-apple``.

    Carries the backend-issued HS256 access token plus the inline
    :class:`UserPublic` projection. The shape mirrors the OAuth2 access
    token spec (RFC 6749 §5.1) so future tooling can interop without
    rename gymnastics.

    Fields (Seed-pinned):

    * ``access_token``: the HS256 backend JWT.
    * ``token_type``: always the literal string ``"bearer"``.
    * ``expires_in``: TTL in seconds (86_400 = 24h in Phase 4.3).
    * ``user``: inline :class:`UserPublic` projection.
    """

    model_config = ConfigDict(extra="forbid")

    access_token: str
    token_type: str
    expires_in: int
    user: UserPublic


class SignInWithAppleRequest(BaseModel):
    """JSON request body for ``POST /v1/auth/sign-in-with-apple``.

    The model declares exactly three fields — ``identity_token`` (required
    string) plus ``full_name`` and ``email`` (both ``Optional[str]``,
    defaulting to ``None``). All further validation — Apple JWKS signature
    verification, ``aud``/``iss``/``exp`` claim checks, body-vs-token email
    cross-validation — lives in the handler / Apple verifier seam.

    Attributes
    ----------
    identity_token:
        The Apple ID token (JWT) that the mobile client received from
        Sign In with Apple. Required on every request, including re-auth.
        Treated as an opaque string at this validation seam; signature
        verification is performed by the Apple JWKS verifier.
    full_name:
        The user's display name. Apple supplies this *only* on the first
        authorization; subsequent re-auth requests omit it. When present,
        the handler persists it to ``users.display_name``. When absent or
        ``None``, the handler MUST NOT overwrite an existing non-null
        ``display_name`` (Seed: re-auth preservation invariant).
    email:
        The user's email. Apple supplies this only on the first
        authorization (or when shared). The handler cross-validates this
        value against the ``email`` claim in ``identity_token`` and
        raises HTTP 400 on mismatch. ``None`` means the client omitted
        the field — the handler then trusts the token claim.
    referral_code:
        The referrer's 8-char URL-safe referral code, supplied by the
        mobile client from its AsyncStorage stash (deep-link
        ``/r/:code`` capture, last-wins, no TTL). Optional — organic
        sign-ups omit it, and re-auth requests after attribution omit it
        too. ``None`` means "no referral to attribute." The schema only
        enforces the wire *shape* (an optional string); the referee →
        referrer attribution logic (validity lookup, self-referral and
        already-attributed guards, atomic events write) lives in the
        handler / repository seam, never in this Pydantic boundary.
        Attribution failure here is silently skipped so sign-in always
        succeeds (Seed: silent_degradation).
    """

    identity_token: str
    full_name: str | None = None
    email: str | None = None
    referral_code: str | None = None


__all__ = [
    "SignInWithAppleRequest",
    "SignInWithAppleResponse",
    "UserPublic",
]
