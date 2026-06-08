"""Unit tests for ``extract_skin_tone_features`` (Sub-AC 17-1e).

검증 요구사항 (AC 요구 2종):
    1. 알려진 피부색 이미지 입력 시 네 필드(hue, saturation, brightness,
       warm_cool_score) 모두 기대 범위 내 반환.
    2. 얼굴 없는 이미지 입력 시 에러 처리 검증.

All tests are *unit* tests — no Pillow, no MediaPipe, no filesystem access.
Pixel arrays are constructed inline using the ``_solid`` helper, following
the convention established by ``test_skin_extractor.py``.

Pixel fixtures (BT.601 YCbCr pre-computed)
------------------------------------------
봄웜 (220, 185, 150):   Cb ≈ 104.6  Cr ≈ 148.3  → skin ✓
가을웜 (200, 160, 130): Cb ≈ 106.3  Cr ≈ 150.4  → skin ✓
여름쿨 (190, 170, 170): Cb ≈ 124.6  Cr ≈ 138.0  → skin ✓
겨울쿨 (195, 180, 175): Cb ≈ 123.0  Cr ≈ 135.9  → skin ✓
blue sky (50, 100, 200): Cb ≈ 186.4  Cr ≈  94.9  → NOT skin ✗
mid-grey (180, 180, 180): Cb = 128.0  Cr = 128.0  → NOT skin ✗  (Cb > 127)
white    (255, 255, 255): Cb = 128.0  Cr = 128.0  → NOT skin ✗

Expected SkinToneFeature field ranges (from formulas)
-----------------------------------------------------
hue             ∈ [0.0, 360.0)
saturation      ∈ [0.0, 1.0]
brightness      ∈ [0.0, 1.0]
warm_cool_score ∈ [-1.0, 1.0]

Test taxonomy
-------------
Section 1 — AC 필수: 알려진 피부색 이미지 → 네 필드 모두 기대 범위 내 반환
Section 2 — AC 필수: 얼굴 없는 이미지 → 에러 처리 검증
Section 3 — 출력 타입 불변성: SkinToneFeature 인스턴스, frozen 데이터클래스
Section 4 — 의미론적 정확도: 웜/쿨 warm_cool_score 부호 및 구체적 기대값
Section 5 — 멀티픽셀 및 모든 한국 피부톤 픽스처 검증
Section 6 — 입력 검증: TypeError / ValueError 경계
"""

from __future__ import annotations

import math

import pytest

from personal_color.skin_tone_extractor import (
    NoSkinPixelsError,
    SkinToneFeature,
    extract_skin_tone_features,
)

# ---------------------------------------------------------------------------
# Floating-point tolerance
# ---------------------------------------------------------------------------

_TOL = 1e-6


def _approx(expected: float, actual: float, *, tol: float = _TOL) -> bool:
    return math.isclose(actual, expected, abs_tol=tol, rel_tol=0)


# ---------------------------------------------------------------------------
# Known pixel fixtures — skin-classified under BT.601 YCbCr thresholding
# (77 ≤ Cb ≤ 127 AND 133 ≤ Cr ≤ 173)
# ---------------------------------------------------------------------------

_SPRING_WARM: tuple[int, int, int] = (220, 185, 150)  # 봄웜 — skin ✓
_AUTUMN_WARM: tuple[int, int, int] = (200, 160, 130)  # 가을웜 — skin ✓
_SUMMER_COOL: tuple[int, int, int] = (190, 170, 170)  # 여름쿨 — skin ✓
_WINTER_COOL: tuple[int, int, int] = (195, 180, 175)  # 겨울쿨 — skin ✓

_BLUE_SKY: tuple[int, int, int] = (50, 100, 200)   # NOT skin
_MID_GREY: tuple[int, int, int] = (180, 180, 180)  # NOT skin (Cb = 128 > 127)
_WHITE: tuple[int, int, int] = (255, 255, 255)     # NOT skin

# Pre-computed expected SkinToneFeature values for 봄웜 (220, 185, 150)
# -----------------------------------------------------------------------
# HSB conversion for (220, 185, 150):
#   r' = 220/255, g' = 185/255, b' = 150/255
#   cmax = 220/255, cmin = 150/255, delta = 70/255
#   brightness = cmax = 220/255 ≈ 0.8627
#   saturation = delta / cmax = (70/255) / (220/255) = 70/220 ≈ 0.3182
#   hue (cmax == r'):
#       raw = ((g' - b') / delta) % 6
#           = ((185/255 - 150/255) / (70/255)) % 6
#           = (35/70) % 6 = 0.5 % 6 = 0.5
#       hue = 60 * 0.5 = 30.0°
# warm_cool_score = (220 - 150) / 255 = 70/255 ≈ 0.2745

_WARM_HUE = 60.0 * (((185 / 255 - 150 / 255) / (70 / 255)) % 6)  # 30.0°
_WARM_SAT = 70 / 220
_WARM_BRIGHT = 220 / 255
_WARM_SCORE = 70 / 255

# Pre-computed expected SkinToneFeature values for 여름쿨 (190, 170, 170)
# -----------------------------------------------------------------------
# r' = 190/255, g' = 170/255, b' = 170/255
# cmax = 190/255, cmin = 170/255, delta = 20/255
# brightness = 190/255 ≈ 0.7451
# saturation = 20 / 190 ≈ 0.1053
# hue (cmax == r'):
#     raw = ((g' - b') / delta) % 6
#         = ((170/255 - 170/255) / (20/255)) % 6 = 0.0 % 6 = 0.0
#     hue = 60 * 0.0 = 0.0°   (achromatic-ish — g' == b' so raw = 0)
# warm_cool_score = (190 - 170) / 255 = 20/255 ≈ 0.0784

_COOL_SAT = 20 / 190
_COOL_BRIGHT = 190 / 255
_COOL_SCORE = 20 / 255


# ---------------------------------------------------------------------------
# Image helper
# ---------------------------------------------------------------------------


def _solid(
    width: int,
    height: int,
    rgb: tuple[int, int, int],
) -> list[list[tuple[int, int, int]]]:
    """Build a ``width × height`` image filled with a single RGB colour."""
    return [[rgb for _ in range(width)] for _ in range(height)]


# ===========================================================================
# Section 1 — AC 필수: 알려진 피부색 이미지 → 네 필드 모두 기대 범위 내 반환
# ===========================================================================


@pytest.mark.unit
def test_known_skin_image_returns_skin_tone_feature() -> None:
    """봄웜 이미지 → SkinToneFeature 인스턴스 반환.

    AC 검증: 알려진 피부색 이미지 입력 → 올바른 반환 타입.
    """
    image = _solid(10, 10, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert isinstance(result, SkinToneFeature), (
        f"Expected SkinToneFeature, got {type(result).__name__}"
    )


@pytest.mark.unit
def test_known_skin_image_hue_in_expected_range() -> None:
    """봄웜 이미지 → hue ∈ [0.0, 360.0).

    AC 검증: 알려진 피부색 이미지 입력 시 hue 필드 기대 범위 내 반환.
    """
    image = _solid(10, 10, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert 0.0 <= result.hue < 360.0, (
        f"hue {result.hue} out of expected range [0.0, 360.0)"
    )


@pytest.mark.unit
def test_known_skin_image_saturation_in_expected_range() -> None:
    """봄웜 이미지 → saturation ∈ [0.0, 1.0].

    AC 검증: 알려진 피부색 이미지 입력 시 saturation 필드 기대 범위 내 반환.
    """
    image = _solid(10, 10, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert 0.0 <= result.saturation <= 1.0, (
        f"saturation {result.saturation} out of expected range [0.0, 1.0]"
    )


@pytest.mark.unit
def test_known_skin_image_brightness_in_expected_range() -> None:
    """봄웜 이미지 → brightness ∈ [0.0, 1.0].

    AC 검증: 알려진 피부색 이미지 입력 시 brightness 필드 기대 범위 내 반환.
    """
    image = _solid(10, 10, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert 0.0 <= result.brightness <= 1.0, (
        f"brightness {result.brightness} out of expected range [0.0, 1.0]"
    )


@pytest.mark.unit
def test_known_skin_image_warm_cool_score_in_expected_range() -> None:
    """봄웜 이미지 → warm_cool_score ∈ [-1.0, 1.0].

    AC 검증: 알려진 피부색 이미지 입력 시 warm_cool_score 필드 기대 범위 내 반환.
    """
    image = _solid(10, 10, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert -1.0 <= result.warm_cool_score <= 1.0, (
        f"warm_cool_score {result.warm_cool_score} out of expected range [-1.0, 1.0]"
    )


@pytest.mark.unit
def test_known_skin_image_all_four_fields_in_range() -> None:
    """여름쿨 이미지 → 네 필드 모두 기대 범위 내.

    AC 검증: 한 번의 호출로 네 필드 모두 범위 검증 (쿨톤 픽스처 사용).
    """
    image = _solid(8, 8, _SUMMER_COOL)
    result = extract_skin_tone_features(image)

    assert 0.0 <= result.hue < 360.0, f"hue {result.hue} out of range"
    assert 0.0 <= result.saturation <= 1.0, f"saturation {result.saturation} out of range"
    assert 0.0 <= result.brightness <= 1.0, f"brightness {result.brightness} out of range"
    assert -1.0 <= result.warm_cool_score <= 1.0, (
        f"warm_cool_score {result.warm_cool_score} out of range"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("rgb", "label"),
    [
        (_SPRING_WARM, "봄웜"),
        (_AUTUMN_WARM, "가을웜"),
        (_SUMMER_COOL, "여름쿨"),
        (_WINTER_COOL, "겨울쿨"),
    ],
)
def test_all_korean_skin_tones_all_four_fields_in_range(
    rgb: tuple[int, int, int],
    label: str,
) -> None:
    """All four Korean skin-tone fixtures → all four fields in expected range.

    AC 검증: 알려진 피부색 이미지 입력 시 네 필드 모두 기대 범위 내 반환 —
    한국 피부톤 네 가지(봄웜·가을웜·여름쿨·겨울쿨) 각각 검증.
    """
    image = _solid(6, 6, rgb)
    result = extract_skin_tone_features(image)

    assert 0.0 <= result.hue < 360.0, (
        f"[{label}] hue {result.hue} out of [0.0, 360.0)"
    )
    assert 0.0 <= result.saturation <= 1.0, (
        f"[{label}] saturation {result.saturation} out of [0.0, 1.0]"
    )
    assert 0.0 <= result.brightness <= 1.0, (
        f"[{label}] brightness {result.brightness} out of [0.0, 1.0]"
    )
    assert -1.0 <= result.warm_cool_score <= 1.0, (
        f"[{label}] warm_cool_score {result.warm_cool_score} out of [-1.0, 1.0]"
    )


# ===========================================================================
# Section 2 — AC 필수: 얼굴 없는 이미지 → 에러 처리 검증
# ===========================================================================


@pytest.mark.unit
def test_no_face_grey_image_raises_no_skin_pixels_error() -> None:
    """중립 회색 이미지 (no skin) → NoSkinPixelsError 발생.

    AC 검증: 얼굴 없는 이미지 입력 시 에러 처리.
    mid-grey (180, 180, 180): Cb = 128.0 > 127 → YCbCr threshold 초과 → NOT skin.
    """
    image = _solid(10, 10, _MID_GREY)

    with pytest.raises(NoSkinPixelsError):
        extract_skin_tone_features(image)


@pytest.mark.unit
def test_no_face_blue_sky_image_raises_no_skin_pixels_error() -> None:
    """하늘색 이미지 (no skin) → NoSkinPixelsError 발생.

    AC 검증: 얼굴 없는 이미지 입력 시 에러 처리.
    blue sky (50, 100, 200): Cb ≈ 186 >> 127 → NOT skin.
    """
    image = _solid(8, 8, _BLUE_SKY)

    with pytest.raises(NoSkinPixelsError):
        extract_skin_tone_features(image)


@pytest.mark.unit
def test_no_face_white_image_raises_no_skin_pixels_error() -> None:
    """흰색 이미지 (no skin) → NoSkinPixelsError 발생.

    AC 검증: 얼굴 없는 이미지 입력 시 에러 처리.
    pure white (255, 255, 255): Cb = 128.0 > 127 → NOT skin.
    """
    image = _solid(5, 5, _WHITE)

    with pytest.raises(NoSkinPixelsError):
        extract_skin_tone_features(image)


@pytest.mark.unit
def test_no_skin_pixels_error_is_value_error_subclass() -> None:
    """NoSkinPixelsError는 ValueError의 서브클래스여야 한다.

    AC 검증: 에러 처리 — 영구 오류 분류(permanent-error taxonomy)에 부합.
    ValueError 서브클래스 → Phase 4 HTTP 422 Unprocessable Entity 매핑 가능.
    """
    image = _solid(6, 6, _MID_GREY)

    with pytest.raises(NoSkinPixelsError) as exc_info:
        extract_skin_tone_features(image)

    assert isinstance(exc_info.value, ValueError), (
        "NoSkinPixelsError must subclass ValueError for permanent-error taxonomy"
    )


@pytest.mark.unit
def test_no_skin_pixels_error_message_describes_failure_shape() -> None:
    """NoSkinPixelsError 메시지는 실패 형태를 설명해야 하며 PII를 포함하지 않아야 한다."""
    image = _solid(4, 4, _BLUE_SKY)

    with pytest.raises(NoSkinPixelsError) as exc_info:
        extract_skin_tone_features(image)

    message = str(exc_info.value)
    assert len(message) > 0, "Error message must not be empty"

    # PII safety — no caller-side identifiers.
    forbidden = ("distinct_id", "transaction_id", "customer_email", "selfieUri")
    for token in forbidden:
        assert token not in message, (
            f"NoSkinPixelsError message must not contain PII token {token!r}"
        )


# ===========================================================================
# Section 3 — 출력 타입 불변성: SkinToneFeature 인스턴스, frozen 데이터클래스
# ===========================================================================


@pytest.mark.unit
def test_output_is_frozen_immutable() -> None:
    """반환된 SkinToneFeature는 불변(frozen=True)이어야 한다."""
    image = _solid(6, 6, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    with pytest.raises((AttributeError, TypeError)):
        result.hue = 99.0  # type: ignore[misc]


@pytest.mark.unit
def test_output_fields_are_all_floats() -> None:
    """네 필드 모두 Python float 인스턴스여야 한다."""
    image = _solid(6, 6, _AUTUMN_WARM)
    result = extract_skin_tone_features(image)

    assert isinstance(result.hue, float), (
        f"hue must be float, got {type(result.hue).__name__}"
    )
    assert isinstance(result.saturation, float), (
        f"saturation must be float, got {type(result.saturation).__name__}"
    )
    assert isinstance(result.brightness, float), (
        f"brightness must be float, got {type(result.brightness).__name__}"
    )
    assert isinstance(result.warm_cool_score, float), (
        f"warm_cool_score must be float, got {type(result.warm_cool_score).__name__}"
    )


@pytest.mark.unit
def test_output_has_exactly_four_fields() -> None:
    """SkinToneFeature는 정확히 네 필드를 가져야 한다.

    hue, saturation, brightness, warm_cool_score.
    """
    import dataclasses

    image = _solid(4, 4, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    field_names = {f.name for f in dataclasses.fields(result)}
    assert field_names == {"hue", "saturation", "brightness", "warm_cool_score"}, (
        f"SkinToneFeature must have exactly 4 fields, got {sorted(field_names)}"
    )


@pytest.mark.unit
def test_output_is_deterministic_for_same_input() -> None:
    """동일 입력 → 매 호출마다 동일한 SkinToneFeature 반환 (결정론적).

    파이프라인은 완전히 rule-based이므로 비결정성이 없어야 한다.
    """
    image = _solid(8, 8, _SPRING_WARM)

    first = extract_skin_tone_features(image)
    second = extract_skin_tone_features(image)
    third = extract_skin_tone_features(image)

    assert first == second == third, (
        f"extract_skin_tone_features must be deterministic: "
        f"first={first}, second={second}, third={third}"
    )


# ===========================================================================
# Section 4 — 의미론적 정확도: 웜/쿨 warm_cool_score 부호 및 구체적 기대값
# ===========================================================================


@pytest.mark.unit
def test_spring_warm_score_is_positive() -> None:
    """봄웜 이미지 → warm_cool_score > 0 (warm 피부톤)."""
    image = _solid(6, 6, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert result.warm_cool_score > 0, (
        f"봄웜 warm_cool_score must be positive, got {result.warm_cool_score}"
    )


@pytest.mark.unit
def test_autumn_warm_score_is_positive() -> None:
    """가을웜 이미지 → warm_cool_score > 0."""
    image = _solid(6, 6, _AUTUMN_WARM)
    result = extract_skin_tone_features(image)

    assert result.warm_cool_score > 0, (
        f"가을웜 warm_cool_score must be positive, got {result.warm_cool_score}"
    )


@pytest.mark.unit
def test_summer_cool_score_is_positive_but_less_than_spring() -> None:
    """봄웜 warm_cool_score > 여름쿨 warm_cool_score (봄웜이 더 warm).

    여름쿨 (190, 170, 170): R-B = 20 → score ≈ 0.0784 (양수이지만 낮음).
    봄웜 (220, 185, 150):   R-B = 70 → score ≈ 0.2745 (양수이고 높음).
    """
    warm_image = _solid(6, 6, _SPRING_WARM)
    cool_image = _solid(6, 6, _SUMMER_COOL)

    warm_result = extract_skin_tone_features(warm_image)
    cool_result = extract_skin_tone_features(cool_image)

    assert warm_result.warm_cool_score > cool_result.warm_cool_score, (
        f"봄웜 score ({warm_result.warm_cool_score:.4f}) must exceed "
        f"여름쿨 score ({cool_result.warm_cool_score:.4f})"
    )


@pytest.mark.unit
def test_spring_warm_hue_expected_value() -> None:
    """봄웜 (220, 185, 150) → hue ≈ 30.0°.

    계산: cmax=r'=220/255, delta=70/255, raw=((185-150)/(70))%6=0.5
    hue = 60 * 0.5 = 30.0°
    """
    image = _solid(6, 6, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert math.isclose(result.hue, _WARM_HUE, abs_tol=1e-3), (
        f"봄웜 hue expected ≈{_WARM_HUE:.4f}°, got {result.hue:.4f}°"
    )


@pytest.mark.unit
def test_spring_warm_saturation_expected_value() -> None:
    """봄웜 (220, 185, 150) → saturation ≈ 70/220 ≈ 0.3182."""
    image = _solid(6, 6, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert _approx(_WARM_SAT, result.saturation), (
        f"봄웜 saturation expected {_WARM_SAT:.6f}, got {result.saturation:.6f}"
    )


@pytest.mark.unit
def test_spring_warm_brightness_expected_value() -> None:
    """봄웜 (220, 185, 150) → brightness = 220/255 ≈ 0.8627."""
    image = _solid(6, 6, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert _approx(_WARM_BRIGHT, result.brightness), (
        f"봄웜 brightness expected {_WARM_BRIGHT:.6f}, got {result.brightness:.6f}"
    )


@pytest.mark.unit
def test_spring_warm_warm_cool_score_expected_value() -> None:
    """봄웜 (220, 185, 150) → warm_cool_score = (220-150)/255 = 70/255 ≈ 0.2745."""
    image = _solid(6, 6, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert _approx(_WARM_SCORE, result.warm_cool_score), (
        f"봄웜 warm_cool_score expected {_WARM_SCORE:.6f}, "
        f"got {result.warm_cool_score:.6f}"
    )


@pytest.mark.unit
def test_summer_cool_saturation_expected_value() -> None:
    """여름쿨 (190, 170, 170) → saturation ≈ 20/190 ≈ 0.1053."""
    image = _solid(6, 6, _SUMMER_COOL)
    result = extract_skin_tone_features(image)

    assert _approx(_COOL_SAT, result.saturation), (
        f"여름쿨 saturation expected {_COOL_SAT:.6f}, got {result.saturation:.6f}"
    )


@pytest.mark.unit
def test_summer_cool_brightness_expected_value() -> None:
    """여름쿨 (190, 170, 170) → brightness = 190/255 ≈ 0.7451."""
    image = _solid(6, 6, _SUMMER_COOL)
    result = extract_skin_tone_features(image)

    assert _approx(_COOL_BRIGHT, result.brightness), (
        f"여름쿨 brightness expected {_COOL_BRIGHT:.6f}, got {result.brightness:.6f}"
    )


@pytest.mark.unit
def test_summer_cool_warm_cool_score_expected_value() -> None:
    """여름쿨 (190, 170, 170) → warm_cool_score = (190-170)/255 = 20/255 ≈ 0.0784."""
    image = _solid(6, 6, _SUMMER_COOL)
    result = extract_skin_tone_features(image)

    assert _approx(_COOL_SCORE, result.warm_cool_score), (
        f"여름쿨 warm_cool_score expected {_COOL_SCORE:.6f}, "
        f"got {result.warm_cool_score:.6f}"
    )


# ===========================================================================
# Section 5 — 멀티픽셀 및 혼합 피부톤 검증
# ===========================================================================


@pytest.mark.unit
def test_mixed_skin_pixels_image_returns_skin_tone_feature() -> None:
    """혼합 피부색(봄웜 + 여름쿨) 이미지 → SkinToneFeature 반환 (에러 없음)."""
    # 2×2 image with two warm and two cool skin pixels.
    image = [
        [_SPRING_WARM, _SUMMER_COOL],
        [_AUTUMN_WARM, _WINTER_COOL],
    ]
    result = extract_skin_tone_features(image)

    assert isinstance(result, SkinToneFeature)
    assert 0.0 <= result.hue < 360.0
    assert 0.0 <= result.saturation <= 1.0
    assert 0.0 <= result.brightness <= 1.0
    assert -1.0 <= result.warm_cool_score <= 1.0


@pytest.mark.unit
def test_single_pixel_image_with_skin_tone_succeeds() -> None:
    """단일 피부색 픽셀 이미지(1×1) → 에러 없이 SkinToneFeature 반환."""
    image = [[_AUTUMN_WARM]]
    result = extract_skin_tone_features(image)

    assert isinstance(result, SkinToneFeature)
    assert 0.0 <= result.warm_cool_score <= 1.0  # autumn warm → positive score


@pytest.mark.unit
def test_large_uniform_warm_image_all_fields_in_range() -> None:
    """큰 균일한 봄웜 이미지(20×20) → 네 필드 모두 기대 범위 내."""
    image = _solid(20, 20, _SPRING_WARM)
    result = extract_skin_tone_features(image)

    assert 0.0 <= result.hue < 360.0
    assert 0.0 <= result.saturation <= 1.0
    assert 0.0 <= result.brightness <= 1.0
    assert -1.0 <= result.warm_cool_score <= 1.0


@pytest.mark.unit
def test_identical_to_single_pixel_for_uniform_image() -> None:
    """균일한 이미지의 결과 = 단일 픽셀 이미지의 결과 (평균 = 상수).

    N개의 동일 픽셀 → 평균이 같으므로 모든 필드값 동일.
    """
    single = extract_skin_tone_features([[_SPRING_WARM]])
    large = extract_skin_tone_features(_solid(5, 5, _SPRING_WARM))

    assert _approx(single.hue, large.hue), (
        f"hue mismatch: single={single.hue}, large={large.hue}"
    )
    assert _approx(single.saturation, large.saturation), (
        f"saturation mismatch: single={single.saturation}, large={large.saturation}"
    )
    assert _approx(single.brightness, large.brightness), (
        f"brightness mismatch: single={single.brightness}, large={large.brightness}"
    )
    assert _approx(single.warm_cool_score, large.warm_cool_score), (
        f"warm_cool_score mismatch: single={single.warm_cool_score}, "
        f"large={large.warm_cool_score}"
    )


# ===========================================================================
# Section 6 — 입력 검증: TypeError / ValueError 경계
# ===========================================================================


@pytest.mark.unit
def test_empty_image_raises_value_error() -> None:
    """빈 이미지 [] → ValueError 발생."""
    with pytest.raises(ValueError):
        extract_skin_tone_features([])


@pytest.mark.unit
def test_string_image_raises_type_error() -> None:
    """비-시퀀스 이미지 → TypeError 발생."""
    with pytest.raises(TypeError):
        extract_skin_tone_features("not an image")  # type: ignore[arg-type]


@pytest.mark.unit
def test_empty_row_raises_value_error() -> None:
    """빈 행을 가진 이미지 → ValueError 발생."""
    with pytest.raises(ValueError):
        extract_skin_tone_features([[]])
