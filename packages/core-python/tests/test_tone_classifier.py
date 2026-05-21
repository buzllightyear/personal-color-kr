"""Unit tests for warm/cool tone classification.

Sub-AC 10.1: RGB/HSV 색상 값을 입력받아 웜톤/쿨톤을 판별하는 함수.

Korean personal color (퍼스널 컬러) primary axis = undertone:
  - Warm (웜톤): yellow undertone — spring/autumn families
  - Cool (쿨톤): blue undertone — summer/winter families
  - Neutral (중성): rare borderline — caller can route as needed

Branch coverage targets:
  - warm branch
  - cool branch
  - neutral / boundary branch
  - input validation branch
"""

from __future__ import annotations

import pytest

from personal_color.tone_classifier import (
    Tone,
    classify_tone_hsv,
    classify_tone_rgb,
)

# ---------------------------------------------------------------------------
# RGB — warm branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "rgb",
    [
        (255, 0, 0),  # pure red
        (255, 165, 0),  # orange
        (255, 220, 100),  # warm yellow
        (220, 180, 140),  # warm skin tone (R >> B)
        (200, 150, 120),  # bronze
    ],
)
def test_classify_tone_rgb_warm(rgb: tuple[int, int, int]) -> None:
    assert classify_tone_rgb(*rgb) is Tone.WARM


# ---------------------------------------------------------------------------
# RGB — cool branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "rgb",
    [
        (0, 0, 255),  # pure blue
        (100, 150, 255),  # sky / cool blue
        (180, 160, 220),  # cool lavender skin tone
        (120, 130, 200),  # cool periwinkle
        (0, 128, 200),  # cool teal-blue
    ],
)
def test_classify_tone_rgb_cool(rgb: tuple[int, int, int]) -> None:
    assert classify_tone_rgb(*rgb) is Tone.COOL


# ---------------------------------------------------------------------------
# RGB — neutral / boundary branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "rgb",
    [
        (0, 0, 0),  # black — boundary
        (255, 255, 255),  # white — boundary (R == B)
        (128, 128, 128),  # mid gray — boundary
        (200, 180, 200),  # R == B with green channel — neutral
        (150, 100, 150),  # R == B saturated — neutral
    ],
)
def test_classify_tone_rgb_neutral_when_r_equals_b(
    rgb: tuple[int, int, int],
) -> None:
    assert classify_tone_rgb(*rgb) is Tone.NEUTRAL


@pytest.mark.unit
def test_classify_tone_rgb_neutral_below_saturation_threshold() -> None:
    """Near-grayscale colors (very low chroma) classify as NEUTRAL even when
    R and B differ by 1-2 levels, because such a small delta is photographic
    noise rather than a real undertone signal."""
    # R only 1 level above B, mid-gray luminance — under threshold
    assert classify_tone_rgb(128, 128, 127) is Tone.NEUTRAL
    # mirror case (cool side, tiny delta)
    assert classify_tone_rgb(127, 128, 128) is Tone.NEUTRAL


# ---------------------------------------------------------------------------
# RGB — input validation branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "rgb",
    [
        (-1, 0, 0),
        (256, 0, 0),
        (0, -1, 0),
        (0, 256, 0),
        (0, 0, -1),
        (0, 0, 256),
    ],
)
def test_classify_tone_rgb_rejects_out_of_range(
    rgb: tuple[int, int, int],
) -> None:
    with pytest.raises(ValueError):
        classify_tone_rgb(*rgb)


@pytest.mark.unit
def test_classify_tone_rgb_rejects_non_integer() -> None:
    with pytest.raises(TypeError):
        classify_tone_rgb(255.0, 0, 0)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# HSV — warm branch (hue 0-60 and 300-360)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "hsv",
    [
        (0.0, 1.0, 1.0),  # pure red
        (30.0, 0.8, 0.9),  # orange
        (60.0, 1.0, 1.0),  # yellow — upper warm boundary
        (15.0, 0.6, 0.7),  # warm skin tone
        (330.0, 0.5, 0.8),  # warm magenta-pink
        (360.0, 1.0, 1.0),  # 360 wraps to red — warm
    ],
)
def test_classify_tone_hsv_warm(hsv: tuple[float, float, float]) -> None:
    assert classify_tone_hsv(*hsv) is Tone.WARM


# ---------------------------------------------------------------------------
# HSV — cool branch (hue 180-270)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "hsv",
    [
        (180.0, 1.0, 1.0),  # cyan — lower cool boundary
        (210.0, 0.9, 0.8),  # azure
        (240.0, 1.0, 1.0),  # pure blue
        (270.0, 0.8, 0.7),  # violet — upper cool boundary
        (200.0, 0.5, 0.6),  # cool muted blue
    ],
)
def test_classify_tone_hsv_cool(hsv: tuple[float, float, float]) -> None:
    assert classify_tone_hsv(*hsv) is Tone.COOL


# ---------------------------------------------------------------------------
# HSV — neutral / boundary branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "hsv",
    [
        (120.0, 1.0, 1.0),  # pure green — between warm/cool
        (150.0, 0.8, 0.8),  # yellow-green
        (90.0, 0.7, 0.7),  # chartreuse
        (285.0, 0.6, 0.6),  # purple between cool and warm
    ],
)
def test_classify_tone_hsv_neutral_hue(hsv: tuple[float, float, float]) -> None:
    assert classify_tone_hsv(*hsv) is Tone.NEUTRAL


@pytest.mark.unit
@pytest.mark.parametrize(
    "hsv",
    [
        (0.0, 0.0, 1.0),  # white — no chroma
        (0.0, 0.0, 0.0),  # black — no chroma
        (0.0, 0.0, 0.5),  # gray
        (45.0, 0.05, 0.8),  # near-gray warm hue — under saturation floor
        (210.0, 0.04, 0.5),  # near-gray cool hue — under saturation floor
    ],
)
def test_classify_tone_hsv_low_saturation_is_neutral(
    hsv: tuple[float, float, float],
) -> None:
    assert classify_tone_hsv(*hsv) is Tone.NEUTRAL


# ---------------------------------------------------------------------------
# HSV — input validation branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "hsv",
    [
        (-0.01, 0.5, 0.5),
        (360.01, 0.5, 0.5),
        (0.0, -0.01, 0.5),
        (0.0, 1.01, 0.5),
        (0.0, 0.5, -0.01),
        (0.0, 0.5, 1.01),
    ],
)
def test_classify_tone_hsv_rejects_out_of_range(
    hsv: tuple[float, float, float],
) -> None:
    with pytest.raises(ValueError):
        classify_tone_hsv(*hsv)


# ---------------------------------------------------------------------------
# Cross-consistency: RGB and HSV should agree on signature anchor colors
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_red_agrees_warm_in_both_spaces() -> None:
    assert classify_tone_rgb(255, 0, 0) is Tone.WARM
    assert classify_tone_hsv(0.0, 1.0, 1.0) is Tone.WARM


@pytest.mark.unit
def test_blue_agrees_cool_in_both_spaces() -> None:
    assert classify_tone_rgb(0, 0, 255) is Tone.COOL
    assert classify_tone_hsv(240.0, 1.0, 1.0) is Tone.COOL
