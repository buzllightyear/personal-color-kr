"""Unit tests for ``pixels_to_hsb`` (Sub-AC 17-1c).

픽셀 배열을 HSB(Hue, Saturation, Brightness) 색공간으로 변환하는
``pixels_to_hsb`` 함수를 알려진 RGB 값으로 검증한다.

테스트 기준 색상
---------------
* 순수 빨강 (255, 0, 0): H=0°, S=1.0, B=1.0
* 순수 노랑 (255, 255, 0): H=60°, S=1.0, B=1.0
* 중립 회색 (128, 128, 128): H=0°(achromatic), S=0.0, B≈0.502

All tests are *unit* tests — no filesystem access, no external vendors,
no binary dependencies.  Pure-Python arithmetic only.

Test taxonomy
-------------
Section 1 — Primary AC fixtures: pure red, yellow, neutral gray
Section 2 — Extended primaries: green, blue, cyan, magenta, white, black
Section 3 — Multi-pixel averaging: mean color converted to HSB
Section 4 — Output type invariants: frozen dataclass, float fields, ranges
Section 5 — Input validation: TypeError / ValueError boundaries
"""

from __future__ import annotations

import math

import pytest

from personal_color.color_features import HSBColor, pixels_to_hsb

# ---------------------------------------------------------------------------
# Tolerance
# ---------------------------------------------------------------------------
_TOL = 1e-6


def _approx(expected: float, actual: float, *, tol: float = _TOL) -> bool:
    return math.isclose(actual, expected, abs_tol=tol, rel_tol=0)


# ---------------------------------------------------------------------------
# Known HSB values for the test fixtures
# (manually verified with the standard HSV formula)
#
# Formula recap:
#   r', g', b'  = R/255, G/255, B/255
#   cmax        = max(r', g', b')
#   cmin        = min(r', g', b')
#   delta       = cmax - cmin
#   brightness  = cmax
#   saturation  = delta / cmax  if cmax > 0 else 0
#   hue (if delta == 0) = 0
#   hue (cmax == r')    = 60 * ((g' - b') / delta) % 6
#   hue (cmax == g')    = 60 * ((b' - r') / delta + 2)
#   hue (cmax == b')    = 60 * ((r' - g') / delta + 4)
# ---------------------------------------------------------------------------

# ── 순수 빨강 (pure red) ─────────────────────────────────────────────────────
# (255, 0, 0): r'=1, g'=0, b'=0 → cmax=1, cmin=0, delta=1
# brightness=1.0, saturation=1.0, hue=60*((0-0)/1 % 6)=0.0
_RED = (255, 0, 0)
_RED_H_LO, _RED_H_HI = 0.0, 1.0  # hue in [0°, 1°)
_RED_S, _RED_B = 1.0, 1.0

# ── 순수 노랑 (pure yellow) ──────────────────────────────────────────────────
# (255, 255, 0): r'=1, g'=1, b'=0 → cmax=1, cmin=0, delta=1
# brightness=1.0, saturation=1.0, hue=60*((1-0)/1 % 6)=60.0
_YELLOW = (255, 255, 0)
_YELLOW_H_LO, _YELLOW_H_HI = 59.0, 61.0  # hue ≈ 60°
_YELLOW_S, _YELLOW_B = 1.0, 1.0

# ── 중립 회색 (neutral gray) ─────────────────────────────────────────────────
# (128, 128, 128): r'=g'=b'=128/255 → cmax=cmin → delta=0
# brightness=128/255≈0.502, saturation=0.0, hue=0 (achromatic)
_GRAY = (128, 128, 128)
_GRAY_H = 0.0
_GRAY_S = 0.0
_GRAY_B = 128 / 255  # ≈ 0.50196


# ===========================================================================
# Section 1 — Primary AC fixtures (순수 빨강 / 노랑 / 중립 회색)
# ===========================================================================


@pytest.mark.unit
def test_pixels_to_hsb_pure_red_hue_in_expected_range() -> None:
    """순수 빨강 (255, 0, 0) → hue ≈ 0°.

    Red occupies hue=0° in the HSB cylinder.  A single-pixel input must
    return a hue within [0°, 1°) to account for floating-point rounding.
    """
    result = pixels_to_hsb((_RED,))
    assert (
        _RED_H_LO <= result.hue < _RED_H_HI
    ), f"Pure red hue expected in [{_RED_H_LO}, {_RED_H_HI}), got {result.hue}"


@pytest.mark.unit
def test_pixels_to_hsb_pure_red_saturation() -> None:
    """순수 빨강 → saturation = 1.0."""
    result = pixels_to_hsb((_RED,))
    assert _approx(
        _RED_S, result.saturation
    ), f"Pure red saturation expected {_RED_S}, got {result.saturation}"


@pytest.mark.unit
def test_pixels_to_hsb_pure_red_brightness() -> None:
    """순수 빨강 → brightness = 1.0."""
    result = pixels_to_hsb((_RED,))
    assert _approx(
        _RED_B, result.brightness
    ), f"Pure red brightness expected {_RED_B}, got {result.brightness}"


@pytest.mark.unit
def test_pixels_to_hsb_pure_yellow_hue_in_expected_range() -> None:
    """순수 노랑 (255, 255, 0) → hue ≈ 60°.

    Yellow occupies hue=60° in the HSB cylinder.  Result must be within
    [59°, 61°).
    """
    result = pixels_to_hsb((_YELLOW,))
    assert _YELLOW_H_LO <= result.hue < _YELLOW_H_HI, (
        f"Pure yellow hue expected in [{_YELLOW_H_LO}, {_YELLOW_H_HI}), "
        f"got {result.hue}"
    )


@pytest.mark.unit
def test_pixels_to_hsb_pure_yellow_saturation() -> None:
    """순수 노랑 → saturation = 1.0."""
    result = pixels_to_hsb((_YELLOW,))
    assert _approx(
        _YELLOW_S, result.saturation
    ), f"Pure yellow saturation expected {_YELLOW_S}, got {result.saturation}"


@pytest.mark.unit
def test_pixels_to_hsb_pure_yellow_brightness() -> None:
    """순수 노랑 → brightness = 1.0."""
    result = pixels_to_hsb((_YELLOW,))
    assert _approx(
        _YELLOW_B, result.brightness
    ), f"Pure yellow brightness expected {_YELLOW_B}, got {result.brightness}"


@pytest.mark.unit
def test_pixels_to_hsb_neutral_gray_saturation() -> None:
    """중립 회색 (128, 128, 128) → saturation = 0.0 (achromatic).

    All channels equal → zero chroma → fully desaturated.
    """
    result = pixels_to_hsb((_GRAY,))
    assert _approx(
        _GRAY_S, result.saturation
    ), f"Neutral gray saturation expected {_GRAY_S}, got {result.saturation}"


@pytest.mark.unit
def test_pixels_to_hsb_neutral_gray_brightness_in_expected_range() -> None:
    """중립 회색 → brightness ≈ 128/255 ≈ 0.502, within ±0.002.

    brightness = max(R, G, B) / 255 = 128 / 255.
    """
    result = pixels_to_hsb((_GRAY,))
    assert math.isclose(
        result.brightness, _GRAY_B, abs_tol=1e-3, rel_tol=0
    ), f"Neutral gray brightness expected ≈{_GRAY_B:.5f}, got {result.brightness:.5f}"


@pytest.mark.unit
def test_pixels_to_hsb_neutral_gray_hue_is_zero() -> None:
    """중립 회색 → hue = 0.0 (achromatic canonical value)."""
    result = pixels_to_hsb((_GRAY,))
    assert _approx(
        _GRAY_H, result.hue
    ), f"Neutral gray hue expected {_GRAY_H}, got {result.hue}"


# ===========================================================================
# Section 2 — Extended primaries / boundary colors
# ===========================================================================


@pytest.mark.unit
@pytest.mark.parametrize(
    ("pixel", "exp_h_lo", "exp_h_hi", "exp_s", "exp_b"),
    [
        # Pure green: H≈120°, S=1.0, B=1.0
        ((0, 255, 0), 119.0, 121.0, 1.0, 1.0),
        # Pure blue: H≈240°, S=1.0, B=1.0
        ((0, 0, 255), 239.0, 241.0, 1.0, 1.0),
        # Pure cyan: H≈180°, S=1.0, B=1.0
        ((0, 255, 255), 179.0, 181.0, 1.0, 1.0),
        # Pure magenta: H≈300°, S=1.0, B=1.0
        ((255, 0, 255), 299.0, 301.0, 1.0, 1.0),
    ],
    ids=["green", "blue", "cyan", "magenta"],
)
def test_pixels_to_hsb_primary_hues(
    pixel: tuple[int, int, int],
    exp_h_lo: float,
    exp_h_hi: float,
    exp_s: float,
    exp_b: float,
) -> None:
    """Primary / secondary hues must fall in expected ±1° windows."""
    result = pixels_to_hsb((pixel,))

    assert exp_h_lo <= result.hue < exp_h_hi, (
        f"Hue for {pixel}: expected in [{exp_h_lo}, {exp_h_hi}), "
        f"got {result.hue:.4f}"
    )
    assert _approx(
        exp_s, result.saturation
    ), f"Saturation for {pixel}: expected {exp_s}, got {result.saturation}"
    assert _approx(
        exp_b, result.brightness
    ), f"Brightness for {pixel}: expected {exp_b}, got {result.brightness}"


@pytest.mark.unit
def test_pixels_to_hsb_pure_white() -> None:
    """White (255, 255, 255): saturation=0, brightness=1.0, hue=0 (achromatic)."""
    result = pixels_to_hsb(((255, 255, 255),))
    assert _approx(
        0.0, result.saturation
    ), f"White saturation expected 0.0, got {result.saturation}"
    assert _approx(
        1.0, result.brightness
    ), f"White brightness expected 1.0, got {result.brightness}"
    assert _approx(
        0.0, result.hue
    ), f"White hue expected 0.0 (achromatic), got {result.hue}"


@pytest.mark.unit
def test_pixels_to_hsb_pure_black() -> None:
    """Black (0, 0, 0): saturation=0, brightness=0, hue=0."""
    result = pixels_to_hsb(((0, 0, 0),))
    assert _approx(
        0.0, result.saturation
    ), f"Black saturation expected 0.0, got {result.saturation}"
    assert _approx(
        0.0, result.brightness
    ), f"Black brightness expected 0.0, got {result.brightness}"
    assert _approx(0.0, result.hue), f"Black hue expected 0.0, got {result.hue}"


# ===========================================================================
# Section 3 — Multi-pixel averaging
# ===========================================================================


@pytest.mark.unit
def test_pixels_to_hsb_two_identical_pixels_same_as_one() -> None:
    """Two identical pixels must yield the same HSB as a single-pixel input."""
    single = pixels_to_hsb((_RED,))
    double = pixels_to_hsb((_RED, _RED))

    assert _approx(
        single.hue, double.hue
    ), f"Hue mismatch: {single.hue} vs {double.hue}"
    assert _approx(
        single.saturation, double.saturation
    ), f"Saturation mismatch: {single.saturation} vs {double.saturation}"
    assert _approx(
        single.brightness, double.brightness
    ), f"Brightness mismatch: {single.brightness} vs {double.brightness}"


@pytest.mark.unit
def test_pixels_to_hsb_red_and_green_averages_to_yellow_hue() -> None:
    """Mixing (255, 0, 0) + (0, 255, 0) → mean (127.5, 127.5, 0) ≈ yellow-ish hue.

    mean_R = 127.5, mean_G = 127.5, mean_B = 0
    cmax = 127.5, cmin = 0, delta = 127.5
    cmax == r' AND cmax == g' (equal): implementation chooses r' branch → hue = 0°
    Actually: r'=g'=0.5, b'=0 → cmax shared by r and g.
    The standard algorithm uses float equality; when r'==g', the r' branch
    fires first → raw = ((g'-b')/delta) % 6 = (0.5/0.5) % 6 = 1.0 → H = 60°.
    We assert hue in [0°, 61°) — the precise value depends on floating-point
    comparison order which is implementation-defined for exact ties.
    """
    result = pixels_to_hsb((_RED, (0, 255, 0)))
    # mean = (127.5, 127.5, 0) → high-yellow / orange-ish region
    # Saturation and brightness must be non-zero
    assert (
        result.saturation > 0.0
    ), f"Saturation should be > 0 for a colored average, got {result.saturation}"
    assert (
        result.brightness > 0.0
    ), f"Brightness should be > 0 for a non-black average, got {result.brightness}"
    # Hue should be in the red-yellow region [0°, 61°)
    assert (
        0.0 <= result.hue < 61.0
    ), f"Red+green average hue expected in [0, 61), got {result.hue}"


@pytest.mark.unit
def test_pixels_to_hsb_multi_gray_pixels_same_as_single_gray() -> None:
    """Multiple identical gray pixels must yield S=0.0, B=128/255."""
    result = pixels_to_hsb((_GRAY, _GRAY, _GRAY))
    assert _approx(
        0.0, result.saturation
    ), f"Multi-gray saturation should be 0.0, got {result.saturation}"
    assert math.isclose(
        result.brightness, _GRAY_B, abs_tol=1e-3, rel_tol=0
    ), f"Multi-gray brightness expected ≈{_GRAY_B:.4f}, got {result.brightness:.4f}"


# ===========================================================================
# Section 4 — Output type invariants
# ===========================================================================


@pytest.mark.unit
def test_pixels_to_hsb_returns_hsb_color_instance() -> None:
    """Return value must be an HSBColor frozen dataclass."""
    result = pixels_to_hsb((_RED,))
    assert isinstance(
        result, HSBColor
    ), f"Expected HSBColor instance, got {type(result)}"


@pytest.mark.unit
def test_pixels_to_hsb_return_is_frozen() -> None:
    """HSBColor must be immutable (frozen=True)."""
    result = pixels_to_hsb((_RED,))
    with pytest.raises((AttributeError, TypeError)):
        result.hue = 42.0  # type: ignore[misc]


@pytest.mark.unit
def test_pixels_to_hsb_fields_are_floats() -> None:
    """All three fields must be Python float instances."""
    result = pixels_to_hsb((_YELLOW,))
    assert isinstance(result.hue, float), f"hue must be float, got {type(result.hue)}"
    assert isinstance(
        result.saturation, float
    ), f"saturation must be float, got {type(result.saturation)}"
    assert isinstance(
        result.brightness, float
    ), f"brightness must be float, got {type(result.brightness)}"


@pytest.mark.unit
@pytest.mark.parametrize(
    "pixel",
    [
        (0, 0, 0),
        (255, 255, 255),
        (128, 128, 128),
        _RED,
        _YELLOW,
        _GRAY,
        (220, 185, 150),  # 봄웜 skin tone
        (195, 180, 175),  # 겨울쿨 skin tone
    ],
    ids=[
        "black",
        "white",
        "gray",
        "pure_red",
        "pure_yellow",
        "neutral_gray",
        "spring_warm",
        "winter_cool",
    ],
)
def test_pixels_to_hsb_all_fields_in_valid_range(
    pixel: tuple[int, int, int],
) -> None:
    """hue ∈ [0, 360), saturation ∈ [0, 1], brightness ∈ [0, 1] for any pixel."""
    result = pixels_to_hsb((pixel,))

    assert (
        0.0 <= result.hue < 360.0
    ), f"hue {result.hue} out of [0, 360) for pixel {pixel}"
    assert (
        0.0 <= result.saturation <= 1.0
    ), f"saturation {result.saturation} out of [0, 1] for pixel {pixel}"
    assert (
        0.0 <= result.brightness <= 1.0
    ), f"brightness {result.brightness} out of [0, 1] for pixel {pixel}"


# ===========================================================================
# Section 5 — Input validation: TypeError / ValueError boundaries
# ===========================================================================


@pytest.mark.unit
def test_pixels_to_hsb_empty_tuple_raises_value_error() -> None:
    """An empty pixel tuple must raise ValueError."""
    with pytest.raises(ValueError, match="empty"):
        pixels_to_hsb(())


@pytest.mark.unit
def test_pixels_to_hsb_empty_list_raises_value_error() -> None:
    """An empty list must also raise ValueError."""
    with pytest.raises(ValueError, match="empty"):
        pixels_to_hsb([])  # type: ignore[arg-type]


@pytest.mark.unit
def test_pixels_to_hsb_string_input_raises_type_error() -> None:
    """A string input must be rejected as a non-pixel Sequence."""
    with pytest.raises(TypeError):
        pixels_to_hsb("rgb")  # type: ignore[arg-type]


@pytest.mark.unit
def test_pixels_to_hsb_bytes_input_raises_type_error() -> None:
    """Bytes input must be rejected."""
    with pytest.raises(TypeError):
        pixels_to_hsb(b"\xff\x00\x00")  # type: ignore[arg-type]


@pytest.mark.unit
def test_pixels_to_hsb_non_tuple_pixel_raises_type_error() -> None:
    """A pixel that is a list instead of a tuple must raise TypeError."""
    with pytest.raises(TypeError, match="3-tuple"):
        pixels_to_hsb(([255, 0, 0],))  # type: ignore[arg-type]


@pytest.mark.unit
def test_pixels_to_hsb_float_channel_raises_type_error() -> None:
    """A float channel value must raise TypeError."""
    with pytest.raises(TypeError, match="channel"):
        pixels_to_hsb(((255.0, 0, 0),))  # type: ignore[arg-type]


@pytest.mark.unit
def test_pixels_to_hsb_bool_channel_raises_type_error() -> None:
    """A boolean channel value must raise TypeError (bool is int subclass but disallowed)."""
    with pytest.raises(TypeError, match="channel"):
        pixels_to_hsb(((True, 0, 0),))  # type: ignore[arg-type]


@pytest.mark.unit
def test_pixels_to_hsb_channel_above_255_raises_value_error() -> None:
    """A channel value > 255 must raise ValueError."""
    with pytest.raises(ValueError, match="0-255"):
        pixels_to_hsb(((256, 0, 0),))


@pytest.mark.unit
def test_pixels_to_hsb_negative_channel_raises_value_error() -> None:
    """A negative channel value must raise ValueError."""
    with pytest.raises(ValueError, match="0-255"):
        pixels_to_hsb(((-1, 0, 0),))
