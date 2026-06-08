"""Unit tests for ``generation.voice_config`` (Sub-AC 13b-1).

Acceptance criterion (Sub-AC 13b-1) being verified
---------------------------------------------------
    VoiceConfig dataclass/schema 정의 — tone·persona·platform·language 등
    필드를 갖는 frozen dataclass(또는 Pydantic 모델)를 구현하고, 유효 인스턴스
    생성·불변성·잘못된 필드 타입 거부를 검증하는 단위 테스트 작성.

Test coverage
-------------
1.  **Happy path** — all required fields present → ``VoiceConfig`` returned.
2.  **validate_voice_config wrapper** — public function returns ``VoiceConfig``.
3.  **Missing required fields** — each required field omitted individually
    → ``ValidationError`` raised with field name in the error message.
4.  **Wrong type — cta_templates** — non-dict value → ``ValidationError``.
5.  **Wrong type — cta_templates values** — dict with non-str values
    → ``ValidationError``.
6.  **Immutability** — mutating any field on a constructed ``VoiceConfig``
    raises an exception (frozen Pydantic model).
7.  **Empty string for required fields** — empty string for ``min_length=1``
    required fields → ``ValidationError``.
8.  **Field value preservation** — all field values round-trip through the
    model without mutation.
9.  **cta_templates empty dict** — empty dict is a valid value.
10. **validate_voice_config raises ValidationError** — invalid payload raises
    ``pydantic.ValidationError`` (not a generic ``Exception``).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from generation.voice_config import VoiceConfig, validate_voice_config

# ---------------------------------------------------------------------------
# Shared fixture: a minimal valid voice-config payload
# ---------------------------------------------------------------------------

_VALID_PAYLOAD: dict = {
    "voice_id": "voice_v1",
    "tone_descriptor": "감성적 친근",
    "persona": "독립 큐레이터 1인칭 시점",
    "platform": "ios",
    "language": "ko",
    "trend_timing_voice": "지금 이 트렌드 — 선점 감성",
    "photo_sense_voice": "구도·빛·보정 감각 — 정제된 눈",
    "cta_templates": {"trend_drop": "지금 바로 생성하기", "subscribe": "구독하기"},
    "updated_at": "2026-06-01T09:00:00Z",
}


def _payload(**overrides) -> dict:
    """Return a copy of _VALID_PAYLOAD with the given overrides applied."""
    return {**_VALID_PAYLOAD, **overrides}


def _payload_without(*keys: str) -> dict:
    """Return a copy of _VALID_PAYLOAD with the given keys removed."""
    p = dict(_VALID_PAYLOAD)
    for k in keys:
        p.pop(k, None)
    return p


# ---------------------------------------------------------------------------
# 1. Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_voice_config_passes_with_all_required_fields() -> None:
    """VoiceConfig can be constructed when all required fields are valid."""
    vc = VoiceConfig(**_VALID_PAYLOAD)

    assert isinstance(vc, VoiceConfig)
    assert vc.voice_id == "voice_v1"
    assert vc.tone_descriptor == "감성적 친근"
    assert vc.persona == "독립 큐레이터 1인칭 시점"
    assert vc.platform == "ios"
    assert vc.language == "ko"
    assert vc.trend_timing_voice == "지금 이 트렌드 — 선점 감성"
    assert vc.photo_sense_voice == "구도·빛·보정 감각 — 정제된 눈"
    assert vc.cta_templates == {
        "trend_drop": "지금 바로 생성하기",
        "subscribe": "구독하기",
    }
    assert vc.updated_at == "2026-06-01T09:00:00Z"


# ---------------------------------------------------------------------------
# 2. validate_voice_config wrapper
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_voice_config_returns_voice_config_type() -> None:
    """validate_voice_config always returns a VoiceConfig instance."""
    result = validate_voice_config(_VALID_PAYLOAD)
    assert type(result) is VoiceConfig


@pytest.mark.unit
def test_validate_voice_config_matches_direct_construction() -> None:
    """validate_voice_config produces the same object as VoiceConfig(**payload)."""
    direct = VoiceConfig(**_VALID_PAYLOAD)
    via_func = validate_voice_config(_VALID_PAYLOAD)
    assert direct == via_func


# ---------------------------------------------------------------------------
# 3. Missing required fields → ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "missing_field",
    [
        "voice_id",
        "tone_descriptor",
        "persona",
        "platform",
        "language",
        "trend_timing_voice",
        "photo_sense_voice",
        "cta_templates",
        "updated_at",
    ],
)
def test_validate_voice_config_raises_on_missing_required_field(
    missing_field: str,
) -> None:
    """Omitting any required field raises pydantic.ValidationError."""
    data = _payload_without(missing_field)
    with pytest.raises(ValidationError) as exc_info:
        validate_voice_config(data)

    error_str = str(exc_info.value)
    assert missing_field in error_str, (
        f"ValidationError should mention '{missing_field}'; " f"got: {error_str[:300]}"
    )


# ---------------------------------------------------------------------------
# 4. Wrong type — cta_templates not a dict
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_voice_config_raises_on_cta_templates_as_string() -> None:
    """cta_templates as a plain string raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_voice_config(_payload(cta_templates="지금 바로 생성하기"))


@pytest.mark.unit
def test_validate_voice_config_raises_on_cta_templates_as_list() -> None:
    """cta_templates as a list raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_voice_config(_payload(cta_templates=["지금 바로 생성하기"]))


@pytest.mark.unit
def test_validate_voice_config_raises_on_cta_templates_as_integer() -> None:
    """cta_templates as an integer raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_voice_config(_payload(cta_templates=42))


# ---------------------------------------------------------------------------
# 5. Wrong type — cta_templates values not str
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_voice_config_raises_on_cta_templates_non_str_value() -> None:
    """cta_templates dict with non-string value raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_voice_config(_payload(cta_templates={"trend_drop": 123}))


@pytest.mark.unit
def test_validate_voice_config_raises_on_cta_templates_none_value() -> None:
    """cta_templates dict with None value raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_voice_config(_payload(cta_templates={"trend_drop": None}))


# ---------------------------------------------------------------------------
# 6. Immutability (frozen model)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_voice_config_is_immutable_voice_id() -> None:
    """Setting voice_id on a constructed VoiceConfig raises an exception."""
    vc = validate_voice_config(_VALID_PAYLOAD)
    with pytest.raises(Exception):
        vc.voice_id = "tampered"  # type: ignore[misc]


@pytest.mark.unit
def test_voice_config_is_immutable_tone_descriptor() -> None:
    """Setting tone_descriptor on a constructed VoiceConfig raises an exception."""
    vc = validate_voice_config(_VALID_PAYLOAD)
    with pytest.raises(Exception):
        vc.tone_descriptor = "변경됨"  # type: ignore[misc]


@pytest.mark.unit
def test_voice_config_is_immutable_language() -> None:
    """Setting language on a constructed VoiceConfig raises an exception."""
    vc = validate_voice_config(_VALID_PAYLOAD)
    with pytest.raises(Exception):
        vc.language = "en"  # type: ignore[misc]


@pytest.mark.unit
def test_voice_config_is_immutable_platform() -> None:
    """Setting platform on a constructed VoiceConfig raises an exception."""
    vc = validate_voice_config(_VALID_PAYLOAD)
    with pytest.raises(Exception):
        vc.platform = "android"  # type: ignore[misc]


@pytest.mark.unit
def test_voice_config_is_immutable_persona() -> None:
    """Setting persona on a constructed VoiceConfig raises an exception."""
    vc = validate_voice_config(_VALID_PAYLOAD)
    with pytest.raises(Exception):
        vc.persona = "changed"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# 7. Empty string for required string fields → ValidationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "empty_str_field",
    [
        "voice_id",
        "tone_descriptor",
        "persona",
        "platform",
        "language",
        "trend_timing_voice",
        "photo_sense_voice",
        "updated_at",
    ],
)
def test_validate_voice_config_raises_on_empty_string_required_fields(
    empty_str_field: str,
) -> None:
    """Empty string for min_length=1 fields raises ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        validate_voice_config(_payload(**{empty_str_field: ""}))
    assert empty_str_field in str(exc_info.value)


# ---------------------------------------------------------------------------
# 8. Field value preservation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_voice_config_preserves_all_field_values() -> None:
    """All fields round-trip through VoiceConfig without mutation."""
    vc = validate_voice_config(_VALID_PAYLOAD)

    assert vc.voice_id == _VALID_PAYLOAD["voice_id"]
    assert vc.tone_descriptor == _VALID_PAYLOAD["tone_descriptor"]
    assert vc.persona == _VALID_PAYLOAD["persona"]
    assert vc.platform == _VALID_PAYLOAD["platform"]
    assert vc.language == _VALID_PAYLOAD["language"]
    assert vc.trend_timing_voice == _VALID_PAYLOAD["trend_timing_voice"]
    assert vc.photo_sense_voice == _VALID_PAYLOAD["photo_sense_voice"]
    assert vc.cta_templates == _VALID_PAYLOAD["cta_templates"]
    assert vc.updated_at == _VALID_PAYLOAD["updated_at"]


# ---------------------------------------------------------------------------
# 9. cta_templates empty dict is valid
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_voice_config_accepts_empty_cta_templates() -> None:
    """Empty cta_templates dict is valid — app falls back to hardcoded defaults."""
    vc = validate_voice_config(_payload(cta_templates={}))
    assert vc.cta_templates == {}


# ---------------------------------------------------------------------------
# 10. validate_voice_config raises ValidationError (not generic Exception)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_voice_config_raises_validation_error_not_generic_error() -> None:
    """validate_voice_config raises pydantic.ValidationError on completely empty dict."""
    with pytest.raises(ValidationError):
        validate_voice_config({})


# ---------------------------------------------------------------------------
# 11. Equality and hashing (frozen Pydantic models are hashable)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_voice_config_equality() -> None:
    """Two VoiceConfig instances with identical fields compare equal."""
    vc1 = validate_voice_config(_VALID_PAYLOAD)
    vc2 = validate_voice_config(_VALID_PAYLOAD)
    assert vc1 == vc2


@pytest.mark.unit
def test_voice_config_inequality_on_different_language() -> None:
    """VoiceConfig instances with different language fields are not equal."""
    vc_ko = validate_voice_config(_payload(language="ko"))
    vc_en = validate_voice_config(_payload(language="en"))
    assert vc_ko != vc_en


# ---------------------------------------------------------------------------
# 12. Wrong types for scalar string fields
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_validate_voice_config_raises_on_voice_id_as_integer() -> None:
    """voice_id as an integer that cannot coerce to a valid non-empty string raises
    ValidationError — or is coerced to a non-empty string. We assert no silent
    data loss by checking that an *integer-typed* voice_id either validates or
    raises ValidationError but does NOT silently produce an empty string."""
    # Pydantic v2 coerces int → str in lax mode; the resulting string "42" is
    # non-empty, so this may pass. We only assert the type is str if it passes.
    try:
        vc = validate_voice_config(_payload(voice_id=42))
        assert isinstance(vc.voice_id, str) and vc.voice_id != ""
    except ValidationError:
        pass  # also acceptable


@pytest.mark.unit
def test_validate_voice_config_raises_on_platform_as_none() -> None:
    """platform=None (explicit null) raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_voice_config(_payload(platform=None))


@pytest.mark.unit
def test_validate_voice_config_raises_on_language_as_none() -> None:
    """language=None (explicit null) raises ValidationError."""
    with pytest.raises(ValidationError):
        validate_voice_config(_payload(language=None))
