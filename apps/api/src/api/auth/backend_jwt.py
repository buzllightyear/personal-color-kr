"""Backend-issued HS256 JWT sign + verify (Phase 4.3).

The backend issues stateless HS256 access tokens to the mobile client on
successful Apple Sign In. The token carries the user's ``users.id`` UUID
in the ``sub`` claim, is signed with the ``JWT_SECRET`` env var, and is
verified on every authenticated request via the ``require_current_user``
FastAPI dependency.

Seed-pinned design:

* Algorithm: HS256 (symmetric, single secret). RS256 migration is a
  Phase 5+ concern when a separate verifier service exists.
* TTL: 24h (86_400 seconds). Refresh tokens are deferred to Phase 5+,
  so the 24h TTL is the explicit one-re-auth-per-day budget.
* Claims (exactly 6): ``sub`` (users.id as UUID string), ``iss``
  (``personal-color-kr``), ``aud`` (``apps/api``), ``iat``, ``exp``,
  ``jti`` (uuid4 — reserved for the Phase 5+ revocation list, harmless
  in 4.3).
* No PII claims: ``email``, ``display_name``, ``apple_sub`` never appear
  in the backend JWT. The token sits in client-side storage and may
  appear in logs / error reports; keeping PII out of it minimizes the
  blast radius of accidental disclosure.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import jwt

#: Backend JWT signing algorithm. Symmetric so the single FastAPI app can
#: both sign and verify with one secret. Migrate to RS256 in Phase 5+
#: when a separate verifier service exists.
BACKEND_JWT_ALGORITHM: str = "HS256"

#: Access token TTL in seconds. 86_400 = 24h. Refresh tokens (Phase 5+)
#: will reduce this to 3600s once silent refresh is available.
JWT_ACCESS_TTL_SECONDS: int = 86_400

#: ``iss`` claim baked into every backend JWT. Verified on every
#: ``require_current_user`` call so a token forged by a sibling service
#: cannot pass our verification.
BACKEND_JWT_ISSUER: str = "personal-color-kr"

#: ``aud`` claim baked into every backend JWT. Verified on every
#: ``require_current_user`` call so the mobile client cannot replay an
#: Apple ID token (whose ``aud`` is the iOS bundle id) into our auth path.
BACKEND_JWT_AUDIENCE: str = "apps/api"

#: Clock skew tolerance (seconds) for ``exp`` validation. ±60s absorbs
#: small NTP drift between the mobile client and the server without
#: weakening the TTL boundary.
BACKEND_JWT_LEEWAY_SECONDS: int = 60


class BackendJwtError(Exception):
    """Raised when a backend JWT fails verification.

    The exception's :attr:`code` attribute is a short, stable string that
    the ``require_current_user`` dependency uses to differentiate failure
    modes for logging — the HTTP response itself stays a generic 401 so
    we do not leak validation hints to an attacker.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class BackendJwtClaims:
    """Decoded backend JWT claims (the subset the app actually uses).

    Frozen so callers cannot mutate decoded claims and accidentally leak
    a tampered value into a downstream query.
    """

    sub: uuid.UUID
    iss: str
    aud: str
    iat: int
    exp: int
    jti: str


def issue_backend_jwt(
    *,
    user_id: uuid.UUID,
    jwt_secret: str,
    ttl_seconds: int = JWT_ACCESS_TTL_SECONDS,
    now: datetime | None = None,
) -> str:
    """Sign and return a backend JWT for ``user_id``.

    Parameters
    ----------
    user_id:
        The ``users.id`` UUID to embed in the ``sub`` claim.
    jwt_secret:
        The symmetric signing secret (read from the ``JWT_SECRET`` env
        var at the call site so tests can inject a deterministic value).
    ttl_seconds:
        Access-token lifetime in seconds. Defaults to
        :data:`JWT_ACCESS_TTL_SECONDS` (24h).
    now:
        Optional injection seam for ``datetime`` so tests can produce
        deterministic ``iat``/``exp`` values. ``None`` (the default)
        uses the current UTC clock.

    Returns
    -------
    str
        The compact-serialized HS256 JWT, ready for the
        ``Authorization: Bearer ...`` header on the mobile side.
    """
    current = now if now is not None else datetime.now(timezone.utc)
    iat = int(current.timestamp())
    exp = iat + ttl_seconds
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "iss": BACKEND_JWT_ISSUER,
        "aud": BACKEND_JWT_AUDIENCE,
        "iat": iat,
        "exp": exp,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, jwt_secret, algorithm=BACKEND_JWT_ALGORITHM)


def verify_backend_jwt(
    *,
    token: str,
    jwt_secret: str,
) -> BackendJwtClaims:
    """Verify ``token`` and return its decoded claims, or raise.

    Validates the HS256 signature against ``jwt_secret`` and enforces
    the ``iss``/``aud``/``exp`` claims with a ±60s leeway. Returns the
    decoded :class:`BackendJwtClaims` on success; raises
    :class:`BackendJwtError` with a stable :attr:`code` on any failure.

    Raises
    ------
    BackendJwtError
        With ``code="expired"`` on TTL violation, ``code="invalid_audience"``
        / ``code="invalid_issuer"`` on claim mismatch, ``code="invalid_signature"``
        on signature failure, ``code="malformed"`` on structural decode
        errors, ``code="invalid_sub"`` on a non-UUID ``sub`` claim.
    """
    try:
        decoded = jwt.decode(
            token,
            jwt_secret,
            algorithms=[BACKEND_JWT_ALGORITHM],
            audience=BACKEND_JWT_AUDIENCE,
            issuer=BACKEND_JWT_ISSUER,
            leeway=BACKEND_JWT_LEEWAY_SECONDS,
            options={
                "require": ["sub", "iss", "aud", "iat", "exp", "jti"],
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise BackendJwtError("expired", "Token has expired") from exc
    except jwt.InvalidAudienceError as exc:
        raise BackendJwtError("invalid_audience", "Invalid audience") from exc
    except jwt.InvalidIssuerError as exc:
        raise BackendJwtError("invalid_issuer", "Invalid issuer") from exc
    except jwt.InvalidSignatureError as exc:
        raise BackendJwtError("invalid_signature", "Invalid signature") from exc
    except jwt.MissingRequiredClaimError as exc:
        raise BackendJwtError("missing_claim", str(exc)) from exc
    except jwt.InvalidTokenError as exc:
        raise BackendJwtError("malformed", "Malformed token") from exc

    raw_sub = decoded.get("sub")
    if not isinstance(raw_sub, str):
        raise BackendJwtError("invalid_sub", "sub claim must be a string")
    try:
        sub_uuid = uuid.UUID(raw_sub)
    except ValueError as exc:
        raise BackendJwtError("invalid_sub", "sub claim must be a UUID") from exc

    return BackendJwtClaims(
        sub=sub_uuid,
        iss=str(decoded["iss"]),
        aud=str(decoded["aud"]),
        iat=int(decoded["iat"]),
        exp=int(decoded["exp"]),
        jti=str(decoded["jti"]),
    )


__all__ = [
    "BACKEND_JWT_ALGORITHM",
    "BACKEND_JWT_AUDIENCE",
    "BACKEND_JWT_ISSUER",
    "BACKEND_JWT_LEEWAY_SECONDS",
    "BackendJwtClaims",
    "BackendJwtError",
    "JWT_ACCESS_TTL_SECONDS",
    "issue_backend_jwt",
    "verify_backend_jwt",
]
