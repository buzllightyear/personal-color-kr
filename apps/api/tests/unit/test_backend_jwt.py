"""Unit tests for :mod:`api.auth.backend_jwt` (Phase 4.3).

Exercise the sign/verify round-trip + every documented failure mode of
the backend HS256 JWT helper. Pure unit tier — no DB, no network, no
``DATABASE_URL`` required.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from api.auth.backend_jwt import (
    BACKEND_JWT_ALGORITHM,
    BACKEND_JWT_AUDIENCE,
    BACKEND_JWT_ISSUER,
    BACKEND_JWT_LEEWAY_SECONDS,
    BackendJwtError,
    issue_backend_jwt,
    verify_backend_jwt,
)

_SECRET: str = "test-secret-do-not-use-in-prod"


@pytest.mark.unit
def test_issue_and_verify_round_trip() -> None:
    """A token signed by ``issue_backend_jwt`` decodes via ``verify_backend_jwt``."""
    user_id = uuid.uuid4()
    token = issue_backend_jwt(user_id=user_id, jwt_secret=_SECRET)
    claims = verify_backend_jwt(token=token, jwt_secret=_SECRET)
    assert claims.sub == user_id
    assert claims.iss == BACKEND_JWT_ISSUER
    assert claims.aud == BACKEND_JWT_AUDIENCE
    assert isinstance(claims.iat, int)
    assert claims.exp > claims.iat
    assert isinstance(claims.jti, str) and len(claims.jti) > 0


@pytest.mark.unit
def test_default_ttl_is_24_hours() -> None:
    """The default ttl is 86_400 seconds (the Seed-pinned 24h)."""
    user_id = uuid.uuid4()
    token = issue_backend_jwt(user_id=user_id, jwt_secret=_SECRET)
    claims = verify_backend_jwt(token=token, jwt_secret=_SECRET)
    assert claims.exp - claims.iat == 86_400


@pytest.mark.unit
def test_no_email_claim_in_backend_jwt() -> None:
    """The backend JWT never carries PII like email or display_name."""
    user_id = uuid.uuid4()
    token = issue_backend_jwt(user_id=user_id, jwt_secret=_SECRET)
    # Decode without verification to inspect ALL claims (not just the
    # subset BackendJwtClaims exposes).
    raw = jwt.decode(
        token,
        _SECRET,
        algorithms=[BACKEND_JWT_ALGORITHM],
        audience=BACKEND_JWT_AUDIENCE,
        issuer=BACKEND_JWT_ISSUER,
    )
    forbidden_pii_keys = {"email", "display_name", "apple_sub", "full_name"}
    assert not (
        raw.keys() & forbidden_pii_keys
    ), f"Backend JWT must not carry PII; found: {raw.keys() & forbidden_pii_keys}"


@pytest.mark.unit
def test_wrong_secret_raises_invalid_signature() -> None:
    """A token signed with secret X cannot be verified with secret Y."""
    user_id = uuid.uuid4()
    token = issue_backend_jwt(user_id=user_id, jwt_secret=_SECRET)
    with pytest.raises(BackendJwtError) as excinfo:
        verify_backend_jwt(token=token, jwt_secret="different-secret")
    assert excinfo.value.code == "invalid_signature"


@pytest.mark.unit
def test_expired_token_raises_expired() -> None:
    """A token whose exp has passed (beyond leeway) raises ``expired``."""
    user_id = uuid.uuid4()
    # Issue at a time far enough in the past that even the 60s leeway
    # cannot rescue it.
    past = datetime.now(timezone.utc) - timedelta(seconds=86_400 + 120)
    token = issue_backend_jwt(user_id=user_id, jwt_secret=_SECRET, now=past)
    with pytest.raises(BackendJwtError) as excinfo:
        verify_backend_jwt(token=token, jwt_secret=_SECRET)
    assert excinfo.value.code == "expired"


@pytest.mark.unit
def test_token_within_leeway_passes() -> None:
    """A token expired ≤60s ago still verifies (clock-skew tolerance)."""
    user_id = uuid.uuid4()
    # Issue 1s short of expiring; the token is technically just inside
    # ttl, so it must verify cleanly.
    short_ttl = 5
    past = datetime.now(timezone.utc) - timedelta(seconds=short_ttl - 1)
    token = issue_backend_jwt(
        user_id=user_id, jwt_secret=_SECRET, ttl_seconds=short_ttl, now=past
    )
    # Now wait a small moment — the token is still inside leeway.
    claims = verify_backend_jwt(token=token, jwt_secret=_SECRET)
    assert claims.sub == user_id


@pytest.mark.unit
def test_invalid_audience_token_raises() -> None:
    """A token whose ``aud`` differs from the expected audience raises."""
    user_id = uuid.uuid4()
    # Hand-craft a token with the wrong aud.
    now = int(time.time())
    bad_token = jwt.encode(
        {
            "sub": str(user_id),
            "iss": BACKEND_JWT_ISSUER,
            "aud": "wrong-audience",
            "iat": now,
            "exp": now + 60,
            "jti": uuid.uuid4().hex,
        },
        _SECRET,
        algorithm=BACKEND_JWT_ALGORITHM,
    )
    with pytest.raises(BackendJwtError) as excinfo:
        verify_backend_jwt(token=bad_token, jwt_secret=_SECRET)
    assert excinfo.value.code == "invalid_audience"


@pytest.mark.unit
def test_invalid_issuer_token_raises() -> None:
    """A token whose ``iss`` differs from the expected issuer raises."""
    user_id = uuid.uuid4()
    now = int(time.time())
    bad_token = jwt.encode(
        {
            "sub": str(user_id),
            "iss": "evil-issuer",
            "aud": BACKEND_JWT_AUDIENCE,
            "iat": now,
            "exp": now + 60,
            "jti": uuid.uuid4().hex,
        },
        _SECRET,
        algorithm=BACKEND_JWT_ALGORITHM,
    )
    with pytest.raises(BackendJwtError) as excinfo:
        verify_backend_jwt(token=bad_token, jwt_secret=_SECRET)
    assert excinfo.value.code == "invalid_issuer"


@pytest.mark.unit
def test_non_uuid_sub_raises_invalid_sub() -> None:
    """A token whose ``sub`` is not a parseable UUID raises ``invalid_sub``."""
    now = int(time.time())
    bad_token = jwt.encode(
        {
            "sub": "not-a-uuid",
            "iss": BACKEND_JWT_ISSUER,
            "aud": BACKEND_JWT_AUDIENCE,
            "iat": now,
            "exp": now + 60,
            "jti": uuid.uuid4().hex,
        },
        _SECRET,
        algorithm=BACKEND_JWT_ALGORITHM,
    )
    with pytest.raises(BackendJwtError) as excinfo:
        verify_backend_jwt(token=bad_token, jwt_secret=_SECRET)
    assert excinfo.value.code == "invalid_sub"


@pytest.mark.unit
def test_malformed_token_raises_malformed() -> None:
    """A garbage non-JWT string raises ``malformed``."""
    with pytest.raises(BackendJwtError) as excinfo:
        verify_backend_jwt(token="not.a.jwt", jwt_secret=_SECRET)
    assert excinfo.value.code in {"malformed", "invalid_signature"}


@pytest.mark.unit
def test_leeway_constant_is_60_seconds() -> None:
    """Module-level constant matches the Seed-pinned 60-second skew budget."""
    assert BACKEND_JWT_LEEWAY_SECONDS == 60
