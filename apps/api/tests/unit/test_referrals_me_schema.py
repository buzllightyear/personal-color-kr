"""Unit tests for ``ReferralMeResponse`` (Phase 4.5 Sub-AC: response body).

These tests pin the wire shape of the response body for
``GET /v1/referrals/me``. The Seed contract requires three fields:

    - ``referral_code``: ``str`` — the authenticated user's per-user fixed
      8-char URL-safe referral code.
    - ``share_url``: ``str`` — the server-assembled ``REFERRAL_BASE_URL`` +
      ``referral_code`` URL (single source of truth lives server-side).
    - ``friend_used_count``: ``int`` — count of users referred by this user.

The model only enforces the wire *shape* (types + the ``extra="forbid"``
guard). The share-URL assembly and the friend-count aggregation live in the
handler / repository seam, never in this Pydantic boundary.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.schemas.referrals import ReferralMeResponse


class TestReferralMeResponseShape:
    """The Pydantic v2 model accepts the contracted three-field shape."""

    def test_accepts_all_three_fields(self) -> None:
        """A fully populated response carries all three Seed-pinned fields."""
        response = ReferralMeResponse(
            referral_code="aB3dEf7h",
            share_url="https://pcolor.example/r/aB3dEf7h",
            friend_used_count=5,
        )

        assert response.referral_code == "aB3dEf7h"
        assert response.share_url == "https://pcolor.example/r/aB3dEf7h"
        assert response.friend_used_count == 5

    def test_accepts_zero_friend_used_count(self) -> None:
        """A brand-new user with no referrals serializes a zero count."""
        response = ReferralMeResponse(
            referral_code="Xy9zAb2c",
            share_url="https://pcolor.example/r/Xy9zAb2c",
            friend_used_count=0,
        )

        assert response.friend_used_count == 0


class TestReferralMeResponseSerialization:
    """The model serializes to the exact wire dict / JSON contract."""

    def test_model_dump_produces_three_keys(self) -> None:
        """``model_dump`` emits exactly the three contracted keys."""
        response = ReferralMeResponse(
            referral_code="aB3dEf7h",
            share_url="https://pcolor.example/r/aB3dEf7h",
            friend_used_count=3,
        )

        assert response.model_dump() == {
            "referral_code": "aB3dEf7h",
            "share_url": "https://pcolor.example/r/aB3dEf7h",
            "friend_used_count": 3,
        }

    def test_round_trips_through_json(self) -> None:
        """The model round-trips through ``model_validate_json``."""
        payload = (
            '{"referral_code": "aB3dEf7h",'
            ' "share_url": "https://pcolor.example/r/aB3dEf7h",'
            ' "friend_used_count": 7}'
        )
        response = ReferralMeResponse.model_validate_json(payload)

        assert response.referral_code == "aB3dEf7h"
        assert response.share_url == "https://pcolor.example/r/aB3dEf7h"
        assert response.friend_used_count == 7


class TestReferralMeResponseValidation:
    """Validation errors are raised for missing, wrong-typed, or extra fields."""

    def test_rejects_missing_referral_code(self) -> None:
        """``referral_code`` is required."""
        with pytest.raises(ValidationError) as exc_info:
            ReferralMeResponse(  # type: ignore[call-arg]
                share_url="https://pcolor.example/r/aB3dEf7h",
                friend_used_count=1,
            )

        errors = exc_info.value.errors()
        assert any(
            err["loc"] == ("referral_code",) and err["type"] == "missing"
            for err in errors
        ), f"expected a 'missing' error for referral_code, got: {errors}"

    def test_rejects_missing_share_url(self) -> None:
        """``share_url`` is required."""
        with pytest.raises(ValidationError) as exc_info:
            ReferralMeResponse(  # type: ignore[call-arg]
                referral_code="aB3dEf7h",
                friend_used_count=1,
            )

        errors = exc_info.value.errors()
        assert any(
            err["loc"] == ("share_url",) and err["type"] == "missing" for err in errors
        ), f"expected a 'missing' error for share_url, got: {errors}"

    def test_rejects_missing_friend_used_count(self) -> None:
        """``friend_used_count`` is required."""
        with pytest.raises(ValidationError) as exc_info:
            ReferralMeResponse(  # type: ignore[call-arg]
                referral_code="aB3dEf7h",
                share_url="https://pcolor.example/r/aB3dEf7h",
            )

        errors = exc_info.value.errors()
        assert any(
            err["loc"] == ("friend_used_count",) and err["type"] == "missing"
            for err in errors
        ), f"expected a 'missing' error for friend_used_count, got: {errors}"

    def test_rejects_non_string_referral_code(self) -> None:
        """``referral_code`` must be a string."""
        with pytest.raises(ValidationError):
            ReferralMeResponse(
                referral_code=12345,  # type: ignore[arg-type]
                share_url="https://pcolor.example/r/aB3dEf7h",
                friend_used_count=1,
            )

    def test_rejects_non_string_share_url(self) -> None:
        """``share_url`` must be a string."""
        with pytest.raises(ValidationError):
            ReferralMeResponse(
                referral_code="aB3dEf7h",
                share_url=12345,  # type: ignore[arg-type]
                friend_used_count=1,
            )

    def test_rejects_non_integer_friend_used_count(self) -> None:
        """``friend_used_count`` must be an int (not a non-numeric string)."""
        with pytest.raises(ValidationError):
            ReferralMeResponse(
                referral_code="aB3dEf7h",
                share_url="https://pcolor.example/r/aB3dEf7h",
                friend_used_count="not-a-number",  # type: ignore[arg-type]
            )

    def test_rejects_extra_field(self) -> None:
        """``extra='forbid'`` rejects unknown keys (silent-drift guard)."""
        with pytest.raises(ValidationError):
            ReferralMeResponse(
                referral_code="aB3dEf7h",
                share_url="https://pcolor.example/r/aB3dEf7h",
                friend_used_count=1,
                reward_points=100,  # type: ignore[call-arg]
            )
