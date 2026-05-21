"""Unit tests for the 4-category season classifier.

Sub-AC 10.3: 톤(웜/쿨) + 밝기(high/low) 조합을 봄/여름/가을/겨울 4 카테고리로
매핑하는 분류 함수. 4가지 조합 전수 검증.

Korean personal color (퍼스널 컬러) 4-category framework:
  +----------+------------------+------------------+
  |          | HIGH contrast    | LOW contrast     |
  +----------+------------------+------------------+
  | WARM     | 봄 (Spring)       | 가을 (Autumn)     |
  | COOL     | 겨울 (Winter)      | 여름 (Summer)     |
  +----------+------------------+------------------+

Branch coverage targets:
  - all 4 (tone × contrast) combinations — exhaustive
  - neutral-tone rejection (NEUTRAL is a primitive verdict, not a category)
  - integration with the RGB-tone + lightness-contrast primitives
  - integration with the HSV-tone + delta-contrast primitives
  - input-validation passthrough from the underlying primitives
  - Season enum membership and Korean-label property
"""

from __future__ import annotations

import pytest

from personal_color.contrast_classifier import Contrast
from personal_color.season_classifier import (
    Season,
    classify_season,
    classify_season_from_hsv_and_delta,
    classify_season_from_rgb_and_lightness,
)
from personal_color.tone_classifier import Tone

# ---------------------------------------------------------------------------
# 4 combinations — exhaustive truth table
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    ("tone", "contrast", "expected"),
    [
        (Tone.WARM, Contrast.HIGH, Season.SPRING),  # 봄
        (Tone.WARM, Contrast.LOW, Season.AUTUMN),  # 가을
        (Tone.COOL, Contrast.HIGH, Season.WINTER),  # 겨울
        (Tone.COOL, Contrast.LOW, Season.SUMMER),  # 여름
    ],
)
def test_classify_season_all_four_combinations(
    tone: Tone,
    contrast: Contrast,
    expected: Season,
) -> None:
    assert classify_season(tone, contrast) is expected


# ---------------------------------------------------------------------------
# Neutral tone — NEUTRAL is a primitive verdict, not a season. Reject.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("contrast", [Contrast.HIGH, Contrast.LOW])
def test_classify_season_rejects_neutral_tone(contrast: Contrast) -> None:
    with pytest.raises(ValueError):
        classify_season(Tone.NEUTRAL, contrast)


# ---------------------------------------------------------------------------
# Input-type validation — enums only. No stringly-typed callers.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_season_rejects_string_tone() -> None:
    with pytest.raises(TypeError):
        classify_season("warm", Contrast.HIGH)  # type: ignore[arg-type]


@pytest.mark.unit
def test_classify_season_rejects_string_contrast() -> None:
    with pytest.raises(TypeError):
        classify_season(Tone.WARM, "high")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Season enum — Korean labels exposed for funnel UI / downstream rendering
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_season_members_are_exactly_four() -> None:
    assert {s.name for s in Season} == {"SPRING", "SUMMER", "AUTUMN", "WINTER"}


@pytest.mark.unit
@pytest.mark.parametrize(
    ("season", "korean"),
    [
        (Season.SPRING, "봄"),
        (Season.SUMMER, "여름"),
        (Season.AUTUMN, "가을"),
        (Season.WINTER, "겨울"),
    ],
)
def test_season_has_korean_label(season: Season, korean: str) -> None:
    assert season.korean == korean


# ---------------------------------------------------------------------------
# Integration: RGB tone + single-lightness contrast → Season
# (composes the 10.1 RGB primitive with the 10.2 single-lightness primitive)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rgb_warm_high_lightness_classifies_spring() -> None:
    # Warm skin tone (R >> B), high-key lightness → 봄.
    assert (
        classify_season_from_rgb_and_lightness(r=220, g=180, b=140, lightness=0.85)
        is Season.SPRING
    )


@pytest.mark.unit
def test_rgb_warm_low_lightness_classifies_autumn() -> None:
    # Warm skin tone, low-key lightness → 가을.
    assert (
        classify_season_from_rgb_and_lightness(r=160, g=110, b=80, lightness=0.35)
        is Season.AUTUMN
    )


@pytest.mark.unit
def test_rgb_cool_high_lightness_classifies_winter() -> None:
    # Cool tone (B >> R) but high-key — winter signature: clear + cool.
    # Cheat sheet maps to 겨울 by the contrast-tier semantics from 10.2 even
    # though the lightness is high; the single-lightness primitive only sees
    # the brightness number, not the under-eye/hair gap. Documented here as
    # the deliberate semantics of this composition.
    assert (
        classify_season_from_rgb_and_lightness(r=180, g=200, b=240, lightness=0.85)
        is Season.WINTER
    )


@pytest.mark.unit
def test_rgb_cool_low_lightness_classifies_summer() -> None:
    # Cool tone, low-key lightness → 여름 (light, muted in the composition).
    assert (
        classify_season_from_rgb_and_lightness(r=120, g=140, b=180, lightness=0.4)
        is Season.SUMMER
    )


@pytest.mark.unit
def test_rgb_neutral_tone_raises() -> None:
    # R == B → NEUTRAL primitive → composition refuses to commit a season.
    with pytest.raises(ValueError):
        classify_season_from_rgb_and_lightness(r=200, g=200, b=200, lightness=0.7)


@pytest.mark.unit
def test_rgb_composition_validates_inputs() -> None:
    # Out-of-range RGB raises through the primitive.
    with pytest.raises(ValueError):
        classify_season_from_rgb_and_lightness(r=-1, g=0, b=0, lightness=0.5)
    # Out-of-range lightness raises through the contrast primitive.
    with pytest.raises(ValueError):
        classify_season_from_rgb_and_lightness(r=200, g=150, b=100, lightness=1.5)


# ---------------------------------------------------------------------------
# Integration: HSV tone + pair-delta contrast → Season
# (composes the 10.1 HSV primitive with the 10.2 delta primitive — the
# combination intended for "skin sample vs hair sample" diagnosis flows.)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_hsv_warm_high_delta_classifies_spring() -> None:
    # Warm hue, large skin-vs-hair lightness gap → 봄.
    assert (
        classify_season_from_hsv_and_delta(
            h=25.0,
            s=0.6,
            v=0.9,
            lightness_light=0.9,
            lightness_dark=0.15,
        )
        is Season.SPRING
    )


@pytest.mark.unit
def test_hsv_warm_low_delta_classifies_autumn() -> None:
    # Warm hue, small skin-vs-hair gap → 가을 (deep, muted).
    assert (
        classify_season_from_hsv_and_delta(
            h=20.0,
            s=0.5,
            v=0.5,
            lightness_light=0.45,
            lightness_dark=0.3,
        )
        is Season.AUTUMN
    )


@pytest.mark.unit
def test_hsv_cool_high_delta_classifies_winter() -> None:
    # Cool hue, large gap → 겨울 (light skin + dark hair, classic winter).
    assert (
        classify_season_from_hsv_and_delta(
            h=220.0,
            s=0.4,
            v=0.85,
            lightness_light=0.9,
            lightness_dark=0.1,
        )
        is Season.WINTER
    )


@pytest.mark.unit
def test_hsv_cool_low_delta_classifies_summer() -> None:
    # Cool hue, small gap → 여름.
    assert (
        classify_season_from_hsv_and_delta(
            h=210.0,
            s=0.4,
            v=0.8,
            lightness_light=0.7,
            lightness_dark=0.5,
        )
        is Season.SUMMER
    )


@pytest.mark.unit
def test_hsv_neutral_tone_raises() -> None:
    # Mid-green hue (between warm and cool bands) → NEUTRAL → refuse season.
    with pytest.raises(ValueError):
        classify_season_from_hsv_and_delta(
            h=120.0,
            s=0.9,
            v=0.9,
            lightness_light=0.8,
            lightness_dark=0.1,
        )


@pytest.mark.unit
def test_hsv_composition_validates_inputs() -> None:
    # Hue out of range raises through HSV primitive.
    with pytest.raises(ValueError):
        classify_season_from_hsv_and_delta(
            h=400.0,
            s=0.5,
            v=0.5,
            lightness_light=0.8,
            lightness_dark=0.2,
        )
    # Lightness out of range raises through delta primitive.
    with pytest.raises(ValueError):
        classify_season_from_hsv_and_delta(
            h=30.0,
            s=0.5,
            v=0.5,
            lightness_light=1.5,
            lightness_dark=0.2,
        )


# ---------------------------------------------------------------------------
# Cross-check: hand-built truth table against pure-enum classify_season
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_truth_table_is_complete_and_distinct() -> None:
    """Every (warm/cool × high/low) combination produces a *distinct* season,
    so the function is a bijection on the 2×2 input space. Prevents a future
    refactor from collapsing two cells onto the same category."""
    table = {
        (tone, contrast): classify_season(tone, contrast)
        for tone in (Tone.WARM, Tone.COOL)
        for contrast in (Contrast.HIGH, Contrast.LOW)
    }
    assert len(set(table.values())) == 4
    assert set(table.values()) == set(Season)
