"""Unit tests for ``SignInWithAppleRequest`` (Phase 4.3 Sub-AC: request body).

These tests pin the wire shape of the request body for
``POST /v1/auth/sign-in-with-apple``. The Seed contract requires:

    - ``identity_token``: required ``str`` — the Apple ID token (JWT) the
      mobile client received from Sign In with Apple. The server validates
      it against Apple's JWKS in a later seam.
    - ``full_name``: ``Optional[str]`` — supplied only on the *first*
      authorization (Apple's UX contract); subsequent re-auth requests omit
      it. The server stores it on the ``users`` row and never overwrites
      with ``NULL`` on re-auth (Seed: "display_name MUST NOT be
      overwritten with NULL or empty string on re-auth").
    - ``email``: ``Optional[str]`` — supplied only on first authorization
      (or when the user shares it). The server cross-validates the body
      ``email`` against the token's ``email`` claim and raises HTTP 400 on
      mismatch (cross-validation lives in the handler, not the schema).

The schema is intentionally permissive about *which* string is in
``identity_token`` — token validation belongs to the Apple JWKS verifier,
not this Pydantic boundary. The schema only enforces the *shape*.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.schemas.auth import SignInWithAppleRequest


class TestSignInWithAppleRequestShape:
    """The Pydantic v2 model accepts the contracted three-field shape."""

    def test_accepts_all_three_fields(self) -> None:
        """All three fields populated — the first-authorization payload."""
        request = SignInWithAppleRequest(
            identity_token="eyJhbGciOiJSUzI1NiIsImtpZCI6IkF1dGgifQ.payload.sig",
            full_name="Hong Gil-dong",
            email="hong@example.com",
        )

        assert request.identity_token == (
            "eyJhbGciOiJSUzI1NiIsImtpZCI6IkF1dGgifQ.payload.sig"
        )
        assert request.full_name == "Hong Gil-dong"
        assert request.email == "hong@example.com"

    def test_accepts_only_identity_token(self) -> None:
        """Re-auth payload: only ``identity_token`` is sent.

        Apple's contract: ``full_name`` and ``email`` arrive only on the
        *first* authorization. Subsequent calls omit both fields.
        """
        request = SignInWithAppleRequest(
            identity_token="re-auth.token.jwt",
        )

        assert request.identity_token == "re-auth.token.jwt"
        assert request.full_name is None
        assert request.email is None

    def test_accepts_explicit_none_for_optional_fields(self) -> None:
        """Explicit ``None`` is equivalent to omission for optional fields."""
        request = SignInWithAppleRequest(
            identity_token="token.value.sig",
            full_name=None,
            email=None,
            referral_code=None,
        )

        assert request.full_name is None
        assert request.email is None
        assert request.referral_code is None

    def test_referral_code_defaults_to_none_when_omitted(self) -> None:
        """Organic sign-up: ``referral_code`` is absent and defaults to None."""
        request = SignInWithAppleRequest(
            identity_token="organic.token.jwt",
        )

        assert request.referral_code is None

    def test_accepts_referral_code_when_present(self) -> None:
        """Referred sign-up: the 8-char URL-safe code is carried through."""
        request = SignInWithAppleRequest(
            identity_token="referred.token.jwt",
            referral_code="aB3dEf7h",
        )

        assert request.referral_code == "aB3dEf7h"


class TestSignInWithAppleRequestValidation:
    """Validation errors are raised for missing or wrong-typed fields."""

    def test_rejects_missing_identity_token(self) -> None:
        """``identity_token`` is required — omission raises ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            SignInWithAppleRequest()  # type: ignore[call-arg]

        errors = exc_info.value.errors()
        assert any(
            err["loc"] == ("identity_token",) and err["type"] == "missing"
            for err in errors
        ), f"expected a 'missing' error for identity_token, got: {errors}"

    def test_rejects_non_string_identity_token(self) -> None:
        """``identity_token`` must be a string (not an int, list, etc.)."""
        with pytest.raises(ValidationError):
            SignInWithAppleRequest(identity_token=12345)  # type: ignore[arg-type]

    def test_rejects_non_string_full_name(self) -> None:
        """``full_name`` must be a string when present."""
        with pytest.raises(ValidationError):
            SignInWithAppleRequest(
                identity_token="t.t.t",
                full_name=12345,  # type: ignore[arg-type]
            )

    def test_rejects_non_string_email(self) -> None:
        """``email`` must be a string when present."""
        with pytest.raises(ValidationError):
            SignInWithAppleRequest(
                identity_token="t.t.t",
                email=12345,  # type: ignore[arg-type]
            )

    def test_rejects_non_string_referral_code(self) -> None:
        """``referral_code`` must be a string when present."""
        with pytest.raises(ValidationError):
            SignInWithAppleRequest(
                identity_token="t.t.t",
                referral_code=12345,  # type: ignore[arg-type]
            )


class TestSignInWithAppleRequestJSON:
    """The schema round-trips through JSON exactly as the wire contract."""

    def test_parses_first_auth_json_payload(self) -> None:
        """The first-auth JSON shape parses through ``model_validate_json``."""
        payload = (
            '{"identity_token": "id.tok.sig",'
            ' "full_name": "Kim Yuna",'
            ' "email": "yuna@example.com"}'
        )
        request = SignInWithAppleRequest.model_validate_json(payload)

        assert request.identity_token == "id.tok.sig"
        assert request.full_name == "Kim Yuna"
        assert request.email == "yuna@example.com"

    def test_parses_reauth_json_payload(self) -> None:
        """The re-auth JSON shape — only ``identity_token`` — parses."""
        payload = '{"identity_token": "reauth.tok.sig"}'
        request = SignInWithAppleRequest.model_validate_json(payload)

        assert request.identity_token == "reauth.tok.sig"
        assert request.full_name is None
        assert request.email is None
        assert request.referral_code is None

    def test_parses_referred_json_payload(self) -> None:
        """A referred first-auth JSON payload carries ``referral_code``."""
        payload = (
            '{"identity_token": "id.tok.sig",'
            ' "full_name": "Park Ji-sung",'
            ' "email": "jisung@example.com",'
            ' "referral_code": "Xy9zAb2c"}'
        )
        request = SignInWithAppleRequest.model_validate_json(payload)

        assert request.identity_token == "id.tok.sig"
        assert request.referral_code == "Xy9zAb2c"
