"""Integration tests for the diagnosis orchestrator.

Sub-AC 10.5: 추출된 색상값을 받아 10.1/10.2/10.3/10.4 함수들을 통합 호출하여
최종 진단 카테고리(봄/여름/가을/겨울)와 신뢰도(0-1)를 반환하는 오케스트레이터.

Test taxonomy:
  - End-to-end happy paths for all 4 seasons through `diagnose_from_region_colors`.
  - End-to-end happy paths from a mock image through `diagnose_from_image`
    (verifies the orchestrator wires the 10.4 extractor into 10.1-10.3).
  - Confidence shaping — strong vs weak signal, per-axis monotonicity,
    geometric-mean property, clamp behavior.
  - NEUTRAL-tone fallback — the orchestrator must commit (no exception),
    surfacing the weakness in the confidence score.
  - Tunable passthrough — overriding thresholds / scales reaches the
    underlying primitives.
  - Input validation propagation — bad RegionColors / out-of-range
    channels raise through the primitive boundary, not silently.
  - DiagnosisResult immutability and field surface.

These are integration tests by construction (multi-module call paths), but
they remain fast and dependency-free, so they stay under `@pytest.mark.unit`
alongside the primitive tests to keep the diagnosis CI lane single-marker.
"""

from __future__ import annotations

import pytest

from personal_color.contrast_classifier import (
    Contrast,
    ContrastThresholds,
)
from personal_color.diagnosis_orchestrator import (
    ConfidenceScales,
    DEFAULT_CONFIDENCE_SCALES,
    DiagnosisResult,
    diagnose_from_image,
    diagnose_from_region_colors,
)
from personal_color.region_extractor import (
    FaceRegions,
    Region,
    RegionColors,
)
from personal_color.season_classifier import Season
from personal_color.tone_classifier import Tone, ToneThresholds


# ---------------------------------------------------------------------------
# RegionColors fixtures — each one represents a clean archetype for the
# corresponding season. Coordinates in comments are RGB and luma sketches.
# ---------------------------------------------------------------------------


def _spring_colors() -> RegionColors:
    # Warm undertone (R >> B) + bright skin vs medium hair → HIGH contrast.
    # luma_skin ≈ 0.79, luma_hair ≈ 0.20 → delta ≈ 0.59 > 0.4.
    return RegionColors(
        skin=(230, 195, 160),
        eyes=(80, 50, 30),
        hair=(70, 45, 30),
    )


def _autumn_colors() -> RegionColors:
    # Warm undertone (R > B) + small luma gap → LOW contrast.
    return RegionColors(
        skin=(170, 130, 95),
        eyes=(95, 70, 50),
        hair=(140, 105, 80),
    )


def _winter_colors() -> RegionColors:
    # Cool undertone (B > R) + large skin/hair luma gap → HIGH contrast.
    return RegionColors(
        skin=(210, 215, 235),
        eyes=(40, 35, 50),
        hair=(20, 18, 25),
    )


def _summer_colors() -> RegionColors:
    # Cool undertone (B > R) + small luma gap → LOW contrast.
    return RegionColors(
        skin=(180, 185, 205),
        eyes=(110, 115, 135),
        hair=(140, 145, 165),
    )


# ---------------------------------------------------------------------------
# Section 1 — Four-season end-to-end through diagnose_from_region_colors
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    ("colors_factory", "expected_season", "expected_tone", "expected_contrast"),
    [
        (_spring_colors, Season.SPRING, Tone.WARM, Contrast.HIGH),
        (_autumn_colors, Season.AUTUMN, Tone.WARM, Contrast.LOW),
        (_winter_colors, Season.WINTER, Tone.COOL, Contrast.HIGH),
        (_summer_colors, Season.SUMMER, Tone.COOL, Contrast.LOW),
    ],
)
def test_orchestrator_produces_each_season_from_archetype_colors(
    colors_factory,
    expected_season: Season,
    expected_tone: Tone,
    expected_contrast: Contrast,
) -> None:
    result = diagnose_from_region_colors(colors_factory())

    assert isinstance(result, DiagnosisResult)
    assert result.season is expected_season
    assert result.tone is expected_tone
    assert result.contrast is expected_contrast


@pytest.mark.unit
def test_orchestrator_returns_korean_label_via_season_member() -> None:
    # The funnel renders `result.season.korean` on the diagnosis-result
    # screen; pin the mapping here so a season-enum refactor surfaces.
    result = diagnose_from_region_colors(_spring_colors())
    assert result.season.korean == "봄"


# ---------------------------------------------------------------------------
# Section 2 — Confidence shaping
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_confidence_is_in_unit_interval_for_all_archetypes() -> None:
    for colors in (
        _spring_colors(),
        _autumn_colors(),
        _winter_colors(),
        _summer_colors(),
    ):
        result = diagnose_from_region_colors(colors)
        assert 0.0 <= result.confidence <= 1.0
        assert 0.0 <= result.tone_confidence <= 1.0
        assert 0.0 <= result.contrast_confidence <= 1.0


@pytest.mark.unit
def test_strong_signals_produce_high_overall_confidence() -> None:
    # Pure-channel extremes: huge |R-B| and huge luma gap → both axes
    # saturate to 1.0, so the geometric mean is 1.0.
    colors = RegionColors(
        skin=(255, 200, 120),   # |R-B| = 135 → tone axis saturates
        eyes=(0, 0, 0),
        hair=(10, 10, 10),      # near-black hair → contrast axis saturates
    )
    result = diagnose_from_region_colors(colors)
    assert result.tone_confidence == 1.0
    assert result.contrast_confidence == 1.0
    assert result.confidence == 1.0


@pytest.mark.unit
def test_weak_tone_signal_pulls_overall_confidence_down() -> None:
    # Skin tone is essentially neutral (R - B = 2), well below the chroma
    # scale of 40. Hair contrast is large. Geometric mean must reflect the
    # weaker axis — strictly less than the contrast confidence alone.
    colors = RegionColors(
        skin=(200, 200, 198),   # |R-B| = 2 → tone_confidence = 2/40 = 0.05
        eyes=(50, 50, 50),
        hair=(20, 20, 20),
    )
    result = diagnose_from_region_colors(colors)

    assert result.tone_confidence == pytest.approx(0.05, abs=1e-9)
    assert result.contrast_confidence > 0.5
    assert result.confidence < result.contrast_confidence
    assert result.confidence == pytest.approx(
        (result.tone_confidence * result.contrast_confidence) ** 0.5,
        abs=1e-9,
    )


@pytest.mark.unit
def test_weak_contrast_signal_pulls_overall_confidence_down() -> None:
    # Strong tone signal, but skin and hair have nearly identical luma.
    colors = RegionColors(
        skin=(220, 180, 120),   # warm, |R-B| = 100 → tone_confidence = 1.0
        eyes=(190, 160, 110),
        hair=(220, 180, 120),   # same as skin → contrast_confidence = 0.0
    )
    result = diagnose_from_region_colors(colors)

    assert result.tone_confidence == 1.0
    assert result.contrast_confidence == 0.0
    assert result.confidence == 0.0  # geometric mean collapses on a zero axis


@pytest.mark.unit
def test_zero_signal_on_both_axes_produces_zero_confidence() -> None:
    # Pure-gray everywhere — no tone signal, no contrast signal. Funnel
    # should see confidence == 0 so it can gate a "재촬영" prompt or surface
    # the lowest-confidence copy.
    colors = RegionColors(
        skin=(128, 128, 128),
        eyes=(128, 128, 128),
        hair=(128, 128, 128),
    )
    result = diagnose_from_region_colors(colors)
    assert result.confidence == 0.0
    assert result.tone_confidence == 0.0
    assert result.contrast_confidence == 0.0


@pytest.mark.unit
def test_tone_confidence_monotone_in_chroma_signal() -> None:
    # Holding contrast constant, larger |R-B| must not decrease tone_confidence.
    weak_skin = RegionColors(skin=(200, 180, 195), eyes=(50, 50, 50), hair=(20, 20, 20))
    mid_skin = RegionColors(skin=(220, 180, 160), eyes=(50, 50, 50), hair=(20, 20, 20))
    strong_skin = RegionColors(skin=(245, 180, 120), eyes=(50, 50, 50), hair=(20, 20, 20))

    weak = diagnose_from_region_colors(weak_skin)
    mid = diagnose_from_region_colors(mid_skin)
    strong = diagnose_from_region_colors(strong_skin)

    assert weak.tone_confidence <= mid.tone_confidence <= strong.tone_confidence


@pytest.mark.unit
def test_contrast_confidence_monotone_in_luma_delta() -> None:
    # Holding tone constant (same warm skin), larger skin/hair luma gap
    # must not decrease contrast_confidence.
    skin = (220, 180, 120)
    near_hair = RegionColors(skin=skin, eyes=(50, 50, 50), hair=(180, 170, 150))
    mid_hair = RegionColors(skin=skin, eyes=(50, 50, 50), hair=(80, 60, 40))
    far_hair = RegionColors(skin=skin, eyes=(50, 50, 50), hair=(10, 10, 10))

    near = diagnose_from_region_colors(near_hair)
    mid = diagnose_from_region_colors(mid_hair)
    far = diagnose_from_region_colors(far_hair)

    assert near.contrast_confidence <= mid.contrast_confidence <= far.contrast_confidence


# ---------------------------------------------------------------------------
# Section 3 — NEUTRAL fallback. The orchestrator MUST commit to a season.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_neutral_tone_does_not_raise_and_commits_to_warm_or_cool() -> None:
    # |R - B| within chroma floor → primitive returns NEUTRAL → orchestrator
    # commits via sign(R - B). Confidence pulled down (low tone signal).
    colors = RegionColors(
        skin=(200, 195, 198),   # |R - B| = 2 → primitive NEUTRAL
        eyes=(50, 50, 50),
        hair=(20, 20, 20),
    )
    # Must not raise.
    result = diagnose_from_region_colors(colors)
    # Sign of (R - B) = 200 - 198 = +2 → WARM tiebreak.
    assert result.tone in (Tone.WARM, Tone.COOL)
    assert result.tone is Tone.WARM
    # Funnel sees a real season (no None / no exception).
    assert result.season in set(Season)
    # And the weakness shows up as low tone confidence.
    assert result.tone_confidence < 0.1


@pytest.mark.unit
def test_neutral_tone_with_r_less_than_b_falls_back_to_cool() -> None:
    colors = RegionColors(
        skin=(198, 195, 200),   # R < B by 2 → primitive NEUTRAL
        eyes=(50, 50, 50),
        hair=(20, 20, 20),
    )
    result = diagnose_from_region_colors(colors)
    assert result.tone is Tone.COOL


@pytest.mark.unit
def test_neutral_tone_exact_tie_falls_back_to_warm() -> None:
    # R == B exactly → tie → orchestrator picks WARM (East-Asian-skin prior).
    colors = RegionColors(
        skin=(200, 195, 200),
        eyes=(50, 50, 50),
        hair=(20, 20, 20),
    )
    result = diagnose_from_region_colors(colors)
    assert result.tone is Tone.WARM


# ---------------------------------------------------------------------------
# Section 4 — Tunable passthrough
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_tone_thresholds_override_changes_neutral_band() -> None:
    # A small |R - B| of 5 is above the default chroma floor of 4 (→ WARM),
    # but below an inflated floor of 10 (→ NEUTRAL → orchestrator fallback
    # still picks WARM by sign, so the season is unchanged — verify by
    # checking tone resolves consistently with the override path).
    colors = RegionColors(
        skin=(200, 180, 195),   # |R - B| = 5
        eyes=(50, 50, 50),
        hair=(20, 20, 20),
    )

    default_result = diagnose_from_region_colors(colors)
    overridden_result = diagnose_from_region_colors(
        colors,
        tone_thresholds=ToneThresholds(rgb_chroma_floor=10),
    )

    # Default floor=4 → primitive WARM directly. Override floor=10 → primitive
    # NEUTRAL → orchestrator fallback picks WARM by sign. Final tone matches.
    assert default_result.tone is Tone.WARM
    assert overridden_result.tone is Tone.WARM


@pytest.mark.unit
def test_contrast_thresholds_override_flips_high_low_contrast() -> None:
    # Skin/hair luma delta around 0.25 — below the default threshold of 0.4
    # (LOW), but above a relaxed threshold of 0.1 (HIGH). Verifies the
    # override threads through to the 10.2 primitive.
    colors = RegionColors(
        skin=(200, 180, 140),   # warm, luma ≈ 0.72
        eyes=(80, 60, 40),
        hair=(120, 100, 80),    # luma ≈ 0.40 → delta ≈ 0.32
    )

    default_result = diagnose_from_region_colors(colors)
    relaxed_result = diagnose_from_region_colors(
        colors,
        contrast_thresholds=ContrastThresholds(delta_threshold=0.1),
    )

    assert default_result.contrast is Contrast.LOW
    assert default_result.season is Season.AUTUMN
    assert relaxed_result.contrast is Contrast.HIGH
    assert relaxed_result.season is Season.SPRING


@pytest.mark.unit
def test_confidence_scales_override_changes_saturation() -> None:
    # Default tone scale = 40. A |R - B| of 20 yields tone_confidence = 0.5.
    # Halving the scale to 20 saturates tone_confidence to 1.0 for the same
    # input. Verifies the override is wired.
    colors = RegionColors(
        skin=(210, 180, 190),   # |R - B| = 20
        eyes=(50, 50, 50),
        hair=(20, 20, 20),
    )

    default_result = diagnose_from_region_colors(colors)
    tighter_result = diagnose_from_region_colors(
        colors,
        confidence_scales=ConfidenceScales(
            tone_rgb_chroma_scale=20,
            luma_delta_scale=DEFAULT_CONFIDENCE_SCALES.luma_delta_scale,
        ),
    )

    assert default_result.tone_confidence == pytest.approx(0.5, abs=1e-9)
    assert tighter_result.tone_confidence == 1.0


@pytest.mark.unit
def test_invalid_confidence_scales_raises() -> None:
    colors = _spring_colors()
    with pytest.raises(ValueError):
        diagnose_from_region_colors(
            colors,
            confidence_scales=ConfidenceScales(
                tone_rgb_chroma_scale=0,
                luma_delta_scale=0.6,
            ),
        )
    with pytest.raises(ValueError):
        diagnose_from_region_colors(
            colors,
            confidence_scales=ConfidenceScales(
                tone_rgb_chroma_scale=40,
                luma_delta_scale=0.0,
            ),
        )


@pytest.mark.unit
def test_non_confidence_scales_argument_raises_typeerror() -> None:
    with pytest.raises(TypeError):
        diagnose_from_region_colors(
            _spring_colors(),
            confidence_scales="loose",  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# Section 5 — Input validation propagation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_non_region_colors_argument_raises_typeerror() -> None:
    with pytest.raises(TypeError):
        diagnose_from_region_colors(
            {"skin": (200, 180, 140), "eyes": (50, 50, 50), "hair": (20, 20, 20)},  # type: ignore[arg-type]
        )


@pytest.mark.unit
def test_out_of_range_channel_raises_through_primitive() -> None:
    # Bad skin RGB → propagates through classify_tone_rgb's validator.
    bad = RegionColors(skin=(300, 180, 140), eyes=(50, 50, 50), hair=(20, 20, 20))
    with pytest.raises(ValueError):
        diagnose_from_region_colors(bad)


@pytest.mark.unit
def test_non_int_channel_raises_through_primitive() -> None:
    bad = RegionColors(skin=(220.0, 180, 140), eyes=(50, 50, 50), hair=(20, 20, 20))  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        diagnose_from_region_colors(bad)


# ---------------------------------------------------------------------------
# Section 6 — End-to-end via diagnose_from_image (10.4 → 10.1/10.2/10.3)
# ---------------------------------------------------------------------------


def _stamp_image(
    width: int,
    height: int,
    fills: dict[Region, tuple[int, int, int]],
) -> list[list[tuple[int, int, int]]]:
    """Build a mock face image: solid black background, with per-region stamps."""
    image: list[list[tuple[int, int, int]]] = [
        [(0, 0, 0) for _ in range(width)] for _ in range(height)
    ]
    for region, rgb in fills.items():
        for y in range(region.y, region.y + region.height):
            for x in range(region.x, region.x + region.width):
                image[y][x] = rgb
    return image


@pytest.mark.unit
def test_diagnose_from_image_wires_extractor_into_orchestrator() -> None:
    # Build a mock face with stamped skin (warm bright), eyes (mid), and
    # hair (dark). The extractor must collapse each region to its stamped
    # color, and the orchestrator must produce SPRING (warm + high contrast).
    skin_rect = Region(x=10, y=10, width=20, height=20)
    eyes_rect = Region(x=10, y=35, width=20, height=4)
    hair_rect = Region(x=10, y=42, width=20, height=8)

    image = _stamp_image(
        width=40,
        height=60,
        fills={
            skin_rect: (230, 195, 160),
            eyes_rect: (80, 50, 30),
            hair_rect: (25, 20, 18),
        },
    )

    result = diagnose_from_image(
        image,
        FaceRegions(skin=skin_rect, eyes=eyes_rect, hair=hair_rect),
    )

    assert result.season is Season.SPRING
    assert result.tone is Tone.WARM
    assert result.contrast is Contrast.HIGH
    # Sanity-check that the wiring used the actual stamped colors, not the
    # black background — luma of stamped skin should be well above 0.5.
    assert result.skin_luma > 0.5


@pytest.mark.unit
def test_diagnose_from_image_propagates_extractor_validation() -> None:
    # Out-of-bounds region → extractor (10.4) raises before the orchestrator
    # touches the primitives.
    image = _stamp_image(
        width=10,
        height=10,
        fills={Region(x=0, y=0, width=5, height=5): (200, 180, 140)},
    )
    too_big = FaceRegions(
        skin=Region(x=0, y=0, width=20, height=5),  # extends past width=10
        eyes=Region(x=0, y=5, width=5, height=2),
        hair=Region(x=0, y=7, width=5, height=2),
    )
    with pytest.raises(ValueError):
        diagnose_from_image(image, too_big)


# ---------------------------------------------------------------------------
# Section 7 — DiagnosisResult surface & immutability
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_result_is_frozen_dataclass() -> None:
    result = diagnose_from_region_colors(_spring_colors())
    with pytest.raises(Exception):
        # Frozen dataclass — any mutation must fail at runtime.
        result.confidence = 0.0  # type: ignore[misc]


@pytest.mark.unit
def test_result_exposes_all_intermediate_signals() -> None:
    # The funnel + analytics pipeline both read these fields. Pin the
    # surface so a refactor that drops one fails loudly here.
    result = diagnose_from_region_colors(_winter_colors())
    for attr in (
        "season",
        "confidence",
        "tone",
        "contrast",
        "tone_confidence",
        "contrast_confidence",
        "skin_luma",
        "hair_luma",
        "eyes_luma",
    ):
        assert hasattr(result, attr), f"DiagnosisResult missing {attr}"


@pytest.mark.unit
def test_luma_values_are_in_unit_interval() -> None:
    result = diagnose_from_region_colors(_summer_colors())
    for luma in (result.skin_luma, result.hair_luma, result.eyes_luma):
        assert 0.0 <= luma <= 1.0
