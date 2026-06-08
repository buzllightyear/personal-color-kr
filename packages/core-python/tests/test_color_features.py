"""Unit tests for ``compute_color_features`` (Sub-AC 12.1.3).

피부 픽셀 배열을 입력받아 색온도(color_temperature)·명도(brightness)·채도(saturation)
세 값으로 구성된 색 특성 벡터를 반환하는 ``compute_color_features`` 함수를 고정된
RGB 값으로 검증.

All tests are *unit* tests — no Pillow, no MediaPipe, no filesystem access.
Input arrays are built inline using simple RGB fixtures.

Test taxonomy
-------------
Section 1 — Fixed-RGB fixtures: expected vector values (core AC requirement)
Section 2 — Single-pixel shortcut: result equals the pixel's own features
Section 3 — Multi-pixel averaging: mean is correctly computed
Section 4 — Output type invariants: frozen dataclass, float fields, range bounds
Section 5 — Input validation: TypeError and ValueError boundaries
"""

from __future__ import annotations

import math

import pytest

from personal_color.color_features import (
    ColorFeatureVector,
    compute_color_features,
)

# ---------------------------------------------------------------------------
# Shared tolerance — all approximate equality checks use this epsilon.
# 1e-6 is sufficient because the formula uses only simple arithmetic on
# 8-bit integers; floating-point rounding is sub-millionth-level.
# ---------------------------------------------------------------------------

_TOL = 1e-6


def _approx(expected: float, actual: float, *, tol: float = _TOL) -> bool:
    return math.isclose(actual, expected, abs_tol=tol, rel_tol=0)


# ---------------------------------------------------------------------------
# Pre-computed expected values (formula verified manually)
#
# color_temperature = (mean_R - mean_B) / 255
# brightness        = (0.299*mean_R + 0.587*mean_G + 0.114*mean_B) / 255
# saturation        = (max(R,G,B) - min(R,G,B)) / max(R,G,B)   if max>0 else 0
# ---------------------------------------------------------------------------

# 봄웜 (Spring Warm): (220, 185, 150)
#   color_temp = (220 - 150) / 255 =  70/255 ≈  0.27451
#   brightness = (0.299*220 + 0.587*185 + 0.114*150) / 255
#              = (65.78 + 108.595 + 17.1) / 255 = 191.475/255 ≈ 0.75088
#   saturation = (220 - 150) / 220 = 70/220 ≈ 0.31818
_SPRING_WARM: tuple[int, int, int] = (220, 185, 150)
_SPRING_WARM_TEMP = 70 / 255
_SPRING_WARM_BRIGHT = (0.299 * 220 + 0.587 * 185 + 0.114 * 150) / 255
_SPRING_WARM_SAT = 70 / 220

# 가을웜 (Autumn Warm): (200, 160, 130)
#   color_temp = (200 - 130) / 255 =  70/255 ≈  0.27451
#   brightness = (0.299*200 + 0.587*160 + 0.114*130) / 255
#              = (59.8 + 93.92 + 14.82) / 255 = 168.54/255 ≈ 0.66094
#   saturation = (200 - 130) / 200 = 70/200 = 0.35
_AUTUMN_WARM: tuple[int, int, int] = (200, 160, 130)
_AUTUMN_WARM_TEMP = 70 / 255
_AUTUMN_WARM_BRIGHT = (0.299 * 200 + 0.587 * 160 + 0.114 * 130) / 255
_AUTUMN_WARM_SAT = 70 / 200

# 여름쿨 (Summer Cool): (190, 170, 170)
#   color_temp = (190 - 170) / 255 =  20/255 ≈  0.07843
#   brightness = (0.299*190 + 0.587*170 + 0.114*170) / 255
#              = (56.81 + 99.79 + 19.38) / 255 = 175.98/255 ≈ 0.69012
#   saturation = (190 - 170) / 190 = 20/190 ≈ 0.10526
_SUMMER_COOL: tuple[int, int, int] = (190, 170, 170)
_SUMMER_COOL_TEMP = 20 / 255
_SUMMER_COOL_BRIGHT = (0.299 * 190 + 0.587 * 170 + 0.114 * 170) / 255
_SUMMER_COOL_SAT = 20 / 190

# 겨울쿨 (Winter Cool): (195, 180, 175)
#   color_temp = (195 - 175) / 255 =  20/255 ≈  0.07843
#   brightness = (0.299*195 + 0.587*180 + 0.114*175) / 255
#              = (58.305 + 105.66 + 19.95) / 255 = 183.915/255 ≈ 0.72122
#   saturation = (195 - 175) / 195 = 20/195 ≈ 0.10256
_WINTER_COOL: tuple[int, int, int] = (195, 180, 175)
_WINTER_COOL_TEMP = 20 / 255
_WINTER_COOL_BRIGHT = (0.299 * 195 + 0.587 * 180 + 0.114 * 175) / 255
_WINTER_COOL_SAT = 20 / 195

# Pure red: (255, 0, 0) — maximum warm, maximum saturation
#   color_temp = (255 - 0) / 255 = 1.0
#   brightness = (0.299*255 + 0 + 0) / 255 = 0.299
#   saturation = (255 - 0) / 255 = 1.0
_PURE_RED: tuple[int, int, int] = (255, 0, 0)
_PURE_RED_TEMP = 1.0
_PURE_RED_BRIGHT = 0.299
_PURE_RED_SAT = 1.0

# Pure blue: (0, 0, 255) — maximum cool, maximum saturation
#   color_temp = (0 - 255) / 255 = -1.0
#   brightness = (0 + 0 + 0.114*255) / 255 = 0.114
#   saturation = (255 - 0) / 255 = 1.0
_PURE_BLUE: tuple[int, int, int] = (0, 0, 255)
_PURE_BLUE_TEMP = -1.0
_PURE_BLUE_BRIGHT = 0.114
_PURE_BLUE_SAT = 1.0

# Pure white: (255, 255, 255) — neutral temperature, maximum brightness, zero saturation
#   color_temp = (255 - 255) / 255 = 0.0
#   brightness = (0.299 + 0.587 + 0.114) = 1.0
#   saturation = (255 - 255) / 255 = 0.0
_PURE_WHITE: tuple[int, int, int] = (255, 255, 255)
_WHITE_TEMP = 0.0
_WHITE_BRIGHT = 1.0
_WHITE_SAT = 0.0

# Black: (0, 0, 0) — neutral temperature, zero brightness, zero saturation
#   color_temp = 0.0, brightness = 0.0, saturation = 0.0
_BLACK: tuple[int, int, int] = (0, 0, 0)
_BLACK_TEMP = 0.0
_BLACK_BRIGHT = 0.0
_BLACK_SAT = 0.0


# ===========================================================================
# Section 1 — Fixed-RGB fixtures: expected vector values
# ===========================================================================


@pytest.mark.unit
@pytest.mark.parametrize(
    ("pixel", "exp_temp", "exp_bright", "exp_sat"),
    [
        (_SPRING_WARM, _SPRING_WARM_TEMP, _SPRING_WARM_BRIGHT, _SPRING_WARM_SAT),
        (_AUTUMN_WARM, _AUTUMN_WARM_TEMP, _AUTUMN_WARM_BRIGHT, _AUTUMN_WARM_SAT),
        (_SUMMER_COOL, _SUMMER_COOL_TEMP, _SUMMER_COOL_BRIGHT, _SUMMER_COOL_SAT),
        (_WINTER_COOL, _WINTER_COOL_TEMP, _WINTER_COOL_BRIGHT, _WINTER_COOL_SAT),
        (_PURE_RED,    _PURE_RED_TEMP,    _PURE_RED_BRIGHT,    _PURE_RED_SAT),
        (_PURE_BLUE,   _PURE_BLUE_TEMP,   _PURE_BLUE_BRIGHT,   _PURE_BLUE_SAT),
        (_PURE_WHITE,  _WHITE_TEMP,       _WHITE_BRIGHT,       _WHITE_SAT),
        (_BLACK,       _BLACK_TEMP,       _BLACK_BRIGHT,       _BLACK_SAT),
    ],
    ids=[
        "spring_warm",
        "autumn_warm",
        "summer_cool",
        "winter_cool",
        "pure_red",
        "pure_blue",
        "pure_white",
        "black",
    ],
)
def test_compute_color_features_fixed_rgb_expected_vector(
    pixel: tuple[int, int, int],
    exp_temp: float,
    exp_bright: float,
    exp_sat: float,
) -> None:
    """고정 RGB 픽셀에 대해 예상 색 특성 벡터와 일치해야 한다.

    This is the primary AC-3 contract test: given a fixed, known RGB value,
    the returned ``ColorFeatureVector`` must match the pre-computed expected
    values within floating-point tolerance.
    """
    result = compute_color_features((pixel,))

    assert _approx(exp_temp, result.color_temperature), (
        f"color_temperature: expected {exp_temp:.6f}, "
        f"got {result.color_temperature:.6f} for pixel {pixel}"
    )
    assert _approx(exp_bright, result.brightness), (
        f"brightness: expected {exp_bright:.6f}, "
        f"got {result.brightness:.6f} for pixel {pixel}"
    )
    assert _approx(exp_sat, result.saturation), (
        f"saturation: expected {exp_sat:.6f}, "
        f"got {result.saturation:.6f} for pixel {pixel}"
    )


@pytest.mark.unit
def test_compute_color_features_spring_warm_is_warmer_than_winter_cool() -> None:
    """봄웜 color_temperature must exceed 겨울쿨 color_temperature.

    Spring-warm (220, 185, 150) has a larger R-B gap (70) than winter-cool
    (195, 180, 175, gap=20), so its warm signal must be strictly larger.
    """
    spring = compute_color_features((_SPRING_WARM,))
    winter = compute_color_features((_WINTER_COOL,))

    assert spring.color_temperature > winter.color_temperature, (
        f"봄웜 ({spring.color_temperature:.4f}) must be warmer than "
        f"겨울쿨 ({winter.color_temperature:.4f})"
    )


@pytest.mark.unit
def test_compute_color_features_blue_is_cooler_than_red() -> None:
    """Pure blue must have strictly negative color_temperature; pure red positive."""
    red_result = compute_color_features((_PURE_RED,))
    blue_result = compute_color_features((_PURE_BLUE,))

    assert red_result.color_temperature > 0, (
        f"Pure red should have positive color_temperature, "
        f"got {red_result.color_temperature}"
    )
    assert blue_result.color_temperature < 0, (
        f"Pure blue should have negative color_temperature, "
        f"got {blue_result.color_temperature}"
    )


@pytest.mark.unit
def test_compute_color_features_white_is_brighter_than_black() -> None:
    """White pixel must have brightness = 1.0 and black must have brightness = 0.0."""
    white_result = compute_color_features((_PURE_WHITE,))
    black_result = compute_color_features((_BLACK,))

    assert _approx(1.0, white_result.brightness), (
        f"White brightness should be 1.0, got {white_result.brightness}"
    )
    assert _approx(0.0, black_result.brightness), (
        f"Black brightness should be 0.0, got {black_result.brightness}"
    )


@pytest.mark.unit
def test_compute_color_features_white_has_zero_saturation() -> None:
    """White pixel (255, 255, 255) must return saturation = 0.0 (achromatic)."""
    result = compute_color_features((_PURE_WHITE,))
    assert _approx(0.0, result.saturation), (
        f"White saturation should be 0.0, got {result.saturation}"
    )


@pytest.mark.unit
def test_compute_color_features_black_has_zero_saturation() -> None:
    """Black pixel (0, 0, 0) must return saturation = 0.0 (degenerate case)."""
    result = compute_color_features((_BLACK,))
    assert _approx(0.0, result.saturation), (
        f"Black saturation should be 0.0, got {result.saturation}"
    )


@pytest.mark.unit
def test_compute_color_features_pure_red_has_full_saturation() -> None:
    """Pure red (255, 0, 0) must return saturation = 1.0."""
    result = compute_color_features((_PURE_RED,))
    assert _approx(1.0, result.saturation), (
        f"Pure red saturation should be 1.0, got {result.saturation}"
    )


# ===========================================================================
# Section 2 — Single-pixel shortcut
# ===========================================================================


@pytest.mark.unit
def test_compute_color_features_single_pixel_equals_formula() -> None:
    """A 1-pixel array must yield the same result as applying the formula directly.

    This verifies the averaging logic works correctly for N=1 (no rounding
    introduced by the mean computation).
    """
    r, g, b = _SPRING_WARM
    expected_temp = (r - b) / 255.0
    expected_bright = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    expected_sat = (max_c - min_c) / max_c

    result = compute_color_features((_SPRING_WARM,))

    assert _approx(expected_temp, result.color_temperature)
    assert _approx(expected_bright, result.brightness)
    assert _approx(expected_sat, result.saturation)


# ===========================================================================
# Section 3 — Multi-pixel averaging
# ===========================================================================


@pytest.mark.unit
def test_compute_color_features_two_pixels_average() -> None:
    """Two pixels: result must match formula applied to the channel-wise mean.

    Pixels: (200, 100, 50) and (100, 50, 200)
    mean_R = 150, mean_G = 75, mean_B = 125

    color_temp = (150 - 125) / 255 = 25/255 ≈ 0.09804
    brightness = (0.299*150 + 0.587*75 + 0.114*125) / 255
               = (44.85 + 44.025 + 14.25) / 255 = 103.125/255 ≈ 0.40441
    max_c = 150, min_c = 75
    saturation = (150 - 75) / 150 = 0.5
    """
    pxA = (200, 100, 50)
    pxB = (100, 50, 200)
    result = compute_color_features((pxA, pxB))

    mean_r, mean_g, mean_b = 150.0, 75.0, 125.0
    exp_temp = (mean_r - mean_b) / 255.0
    exp_bright = (0.299 * mean_r + 0.587 * mean_g + 0.114 * mean_b) / 255.0
    max_c = max(mean_r, mean_g, mean_b)
    min_c = min(mean_r, mean_g, mean_b)
    exp_sat = (max_c - min_c) / max_c

    assert _approx(exp_temp, result.color_temperature), (
        f"Two-pixel color_temperature: expected {exp_temp:.6f}, "
        f"got {result.color_temperature:.6f}"
    )
    assert _approx(exp_bright, result.brightness), (
        f"Two-pixel brightness: expected {exp_bright:.6f}, "
        f"got {result.brightness:.6f}"
    )
    assert _approx(exp_sat, result.saturation), (
        f"Two-pixel saturation: expected {exp_sat:.6f}, "
        f"got {result.saturation:.6f}"
    )


@pytest.mark.unit
def test_compute_color_features_identical_pixels_same_as_single() -> None:
    """N identical pixels must yield the same result as a 1-pixel array."""
    single = compute_color_features((_AUTUMN_WARM,))
    triple = compute_color_features((_AUTUMN_WARM, _AUTUMN_WARM, _AUTUMN_WARM))

    assert _approx(single.color_temperature, triple.color_temperature)
    assert _approx(single.brightness, triple.brightness)
    assert _approx(single.saturation, triple.saturation)


@pytest.mark.unit
def test_compute_color_features_neutral_pixel_from_warm_cool_mix() -> None:
    """Mixing equal warm and cool pixels averages to a near-neutral temperature.

    (255, 0, 0) + (0, 0, 255) → mean_R = 127.5, mean_B = 127.5
    color_temp = (127.5 - 127.5) / 255 = 0.0
    """
    result = compute_color_features((_PURE_RED, _PURE_BLUE))
    assert _approx(0.0, result.color_temperature), (
        f"Equal warm+cool mix should have color_temp ≈ 0, "
        f"got {result.color_temperature}"
    )


# ===========================================================================
# Section 4 — Output type invariants
# ===========================================================================


@pytest.mark.unit
def test_compute_color_features_returns_frozen_dataclass() -> None:
    """Return type must be a frozen ColorFeatureVector dataclass."""
    result = compute_color_features((_SPRING_WARM,))

    assert isinstance(result, ColorFeatureVector), (
        f"Expected ColorFeatureVector, got {type(result)}"
    )
    # frozen=True means attribute assignment raises FrozenInstanceError
    with pytest.raises((AttributeError, TypeError)):
        result.color_temperature = 0.0  # type: ignore[misc]


@pytest.mark.unit
def test_compute_color_features_fields_are_floats() -> None:
    """All three fields of the returned vector must be Python float instances."""
    result = compute_color_features((_SPRING_WARM,))

    assert isinstance(result.color_temperature, float), (
        f"color_temperature must be float, got {type(result.color_temperature)}"
    )
    assert isinstance(result.brightness, float), (
        f"brightness must be float, got {type(result.brightness)}"
    )
    assert isinstance(result.saturation, float), (
        f"saturation must be float, got {type(result.saturation)}"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    "pixel",
    [
        (0, 0, 0),
        (255, 255, 255),
        (128, 128, 128),
        _SPRING_WARM,
        _AUTUMN_WARM,
        _SUMMER_COOL,
        _WINTER_COOL,
    ],
    ids=["black", "white", "gray", "spring_warm", "autumn_warm", "summer_cool", "winter_cool"],
)
def test_compute_color_features_all_fields_in_valid_range(
    pixel: tuple[int, int, int],
) -> None:
    """brightness and saturation must be in [0.0, 1.0]; color_temp in [-1.0, 1.0]."""
    result = compute_color_features((pixel,))

    assert -1.0 <= result.color_temperature <= 1.0, (
        f"color_temperature {result.color_temperature} out of [-1, 1] "
        f"for pixel {pixel}"
    )
    assert 0.0 <= result.brightness <= 1.0, (
        f"brightness {result.brightness} out of [0, 1] for pixel {pixel}"
    )
    assert 0.0 <= result.saturation <= 1.0, (
        f"saturation {result.saturation} out of [0, 1] for pixel {pixel}"
    )


# ===========================================================================
# Section 5 — Input validation: TypeError and ValueError boundaries
# ===========================================================================


@pytest.mark.unit
def test_compute_color_features_empty_tuple_raises_value_error() -> None:
    """An empty pixel tuple must raise ValueError."""
    with pytest.raises(ValueError, match="empty"):
        compute_color_features(())


@pytest.mark.unit
def test_compute_color_features_empty_list_raises_value_error() -> None:
    """An empty list (Sequence) must also raise ValueError."""
    with pytest.raises(ValueError, match="empty"):
        compute_color_features([])  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_string_input_raises_type_error() -> None:
    """A string must be rejected as a non-pixel Sequence."""
    with pytest.raises(TypeError):
        compute_color_features("rgb")  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_bytes_input_raises_type_error() -> None:
    """Bytes input must be rejected as a non-pixel Sequence."""
    with pytest.raises(TypeError):
        compute_color_features(b"\xff\x00\x00")  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_non_tuple_pixel_raises_type_error() -> None:
    """A pixel that is a list instead of a tuple must raise TypeError."""
    bad_pixels = ([255, 0, 0],)  # list instead of tuple
    with pytest.raises(TypeError, match="3-tuple"):
        compute_color_features(bad_pixels)  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_pixel_with_two_channels_raises_type_error() -> None:
    """A pixel tuple with only 2 channels must raise TypeError."""
    bad_pixels = ((255, 0),)
    with pytest.raises(TypeError, match="3-tuple"):
        compute_color_features(bad_pixels)  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_pixel_with_four_channels_raises_type_error() -> None:
    """A pixel tuple with 4 channels (RGBA) must raise TypeError."""
    bad_pixels = ((255, 0, 0, 255),)
    with pytest.raises(TypeError, match="3-tuple"):
        compute_color_features(bad_pixels)  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_float_channel_raises_type_error() -> None:
    """A float channel value must raise TypeError (int required)."""
    bad_pixels = ((255.0, 0, 0),)  # type: ignore[list-item]
    with pytest.raises(TypeError, match="channel"):
        compute_color_features(bad_pixels)  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_bool_channel_raises_type_error() -> None:
    """A boolean channel value must raise TypeError (bool is int subclass but disallowed)."""
    bad_pixels = ((True, 0, 0),)  # type: ignore[list-item]
    with pytest.raises(TypeError, match="channel"):
        compute_color_features(bad_pixels)  # type: ignore[arg-type]


@pytest.mark.unit
def test_compute_color_features_channel_above_255_raises_value_error() -> None:
    """A channel value > 255 must raise ValueError."""
    bad_pixels = ((256, 0, 0),)
    with pytest.raises(ValueError, match="0-255"):
        compute_color_features(bad_pixels)


@pytest.mark.unit
def test_compute_color_features_negative_channel_raises_value_error() -> None:
    """A negative channel value must raise ValueError."""
    bad_pixels = ((-1, 0, 0),)
    with pytest.raises(ValueError, match="0-255"):
        compute_color_features(bad_pixels)


@pytest.mark.unit
def test_compute_color_features_second_pixel_bad_channel_raises() -> None:
    """Validation must check every pixel, not just the first."""
    bad_pixels = (
        (200, 185, 150),   # valid spring-warm pixel
        (256, 0, 0),       # invalid — second pixel, channel R = 256
    )
    with pytest.raises(ValueError, match="0-255"):
        compute_color_features(bad_pixels)
