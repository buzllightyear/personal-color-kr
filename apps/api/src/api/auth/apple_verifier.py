"""Apple Sign In ID token verifier (Phase 4.3).

Validates an Apple-issued ID token end-to-end:

1. Decodes the unverified header to extract ``kid``.
2. Looks up the matching JWK in the Apple JWKS cache.
3. Verifies the RS256 signature against the JWK's RSA public key.
4. Enforces standard claims: ``iss`` (must be Apple's issuer URL),
   ``aud`` (must equal the iOS app's bundle id), ``exp`` (with ±60s
   leeway), and ``sub`` (must be a non-empty string).

The verifier returns a :class:`VerifiedAppleToken` dataclass with the
fields the auth router actually needs (``sub``, ``email``,
``email_verified``) — never the raw decoded dict, so a downstream caller
cannot accidentally trust an unverified claim.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt
from jwt.algorithms import RSAAlgorithm

from api.auth.apple_jwks import AppleJwksClient

#: The ``iss`` claim Apple sets on every Sign In with Apple ID token.
#: Verified verbatim to defend against tokens issued by a different
#: identity provider being replayed into our auth path.
APPLE_ISSUER: str = "https://appleid.apple.com"

#: Clock skew tolerance (seconds) for Apple ``exp`` validation. Matches
#: the backend JWT leeway so token-handling code uses a single skew
#: budget across both surfaces.
APPLE_LEEWAY_SECONDS: int = 60


class AppleTokenError(Exception):
    """Raised when an Apple ID token fails verification.

    The exception's :attr:`code` attribute is a short, stable string the
    auth router uses for logging and metrics — the HTTP response stays a
    generic 401 to avoid leaking validation hints.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VerifiedAppleToken:
    """The verified subset of an Apple ID token used by the auth router."""

    sub: str
    email: str | None
    email_verified: bool


async def verify_apple_id_token(
    *,
    identity_token: str,
    apple_bundle_id: str,
    jwks_client: AppleJwksClient,
) -> VerifiedAppleToken:
    """Verify an Apple ID token and return a :class:`VerifiedAppleToken`.

    Parameters
    ----------
    identity_token:
        The compact-serialized Apple ID token forwarded by the mobile
        client in the ``POST /v1/auth/sign-in-with-apple`` request body.
    apple_bundle_id:
        The iOS app's bundle identifier — the verifier checks the
        token's ``aud`` claim against this value to defend against
        cross-app token replay.
    jwks_client:
        The injected JWKS client (singleton in prod, mocked in tests).

    Raises
    ------
    AppleTokenError
        With a stable :attr:`code` on any validation failure:
        ``malformed_header``, ``unknown_kid``, ``invalid_signature``,
        ``expired``, ``invalid_audience``, ``invalid_issuer``,
        ``missing_sub``, ``email_verified_not_bool``.
    """
    try:
        header = jwt.get_unverified_header(identity_token)
    except jwt.InvalidTokenError as exc:
        raise AppleTokenError("malformed_header", "Malformed token header") from exc

    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise AppleTokenError("malformed_header", "Token header missing 'kid'")

    keys = await jwks_client.get_keys()
    jwk = keys.get(kid)
    if jwk is None:
        raise AppleTokenError("unknown_kid", f"Unknown kid: {kid!r} not in Apple JWKS")

    # Convert the JWK to an RSA public key for PyJWT.
    try:
        public_key = RSAAlgorithm.from_jwk(jwk)
    except Exception as exc:
        raise AppleTokenError("malformed_jwk", "JWK could not be parsed") from exc

    try:
        # ``RSAAlgorithm.from_jwk`` returns ``RSAPrivateKey | RSAPublicKey``
        # in PyJWT's type stub, but Apple's JWKS is documented to ship
        # public keys only — the runtime cast is therefore safe and the
        # type ignore is the minimal-blast-radius escape hatch.
        decoded: dict[str, Any] = jwt.decode(
            identity_token,
            public_key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            audience=apple_bundle_id,
            issuer=APPLE_ISSUER,
            leeway=APPLE_LEEWAY_SECONDS,
            options={
                "require": ["sub", "iss", "aud", "exp", "iat"],
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise AppleTokenError("expired", "Apple token expired") from exc
    except jwt.InvalidAudienceError as exc:
        raise AppleTokenError(
            "invalid_audience", "Apple token aud does not match bundle id"
        ) from exc
    except jwt.InvalidIssuerError as exc:
        raise AppleTokenError("invalid_issuer", "Apple token iss is not Apple") from exc
    except jwt.InvalidSignatureError as exc:
        raise AppleTokenError(
            "invalid_signature", "Apple token signature invalid"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise AppleTokenError("malformed", "Apple token malformed") from exc

    sub = decoded.get("sub")
    if not isinstance(sub, str) or not sub:
        raise AppleTokenError("missing_sub", "Apple token missing 'sub' claim")

    raw_email = decoded.get("email")
    email: str | None
    if raw_email is None:
        email = None
    elif isinstance(raw_email, str):
        email = raw_email if raw_email else None
    else:
        email = None

    raw_verified = decoded.get("email_verified")
    # Apple sometimes encodes email_verified as the *string* "true"/"false"
    # instead of a bool — accept both, but reject other types.
    email_verified: bool
    if isinstance(raw_verified, bool):
        email_verified = raw_verified
    elif isinstance(raw_verified, str) and raw_verified.lower() in {"true", "false"}:
        email_verified = raw_verified.lower() == "true"
    elif raw_verified is None:
        email_verified = False
    else:
        raise AppleTokenError(
            "email_verified_not_bool",
            "Apple token email_verified must be bool or 'true'/'false'",
        )

    return VerifiedAppleToken(
        sub=sub,
        email=email,
        email_verified=email_verified,
    )


__all__ = [
    "APPLE_ISSUER",
    "APPLE_LEEWAY_SECONDS",
    "AppleTokenError",
    "VerifiedAppleToken",
    "verify_apple_id_token",
]
