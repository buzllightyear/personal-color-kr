"""Unit tests for hsb_season_classifier (Sub-AC 17-2).

퍼스널컬러 시즌 분류 함수 검증:
(hue, saturation, brightness, warm_cool_score) → 'spring'|'summer'|'autumn'|'winter'

Test strategy
-------------
1. **4-season representative vectors** (primary AC requirement):
   Each of the four Korean personal-colour seasons is covered by a
   characteristic (hue, saturation, brightness, warm_cool_score) tuple
   that sits well inside the decision boundaries, so a threshold
   calibration change within ±0.1 of the defaults cannot flip the result.

2. **Boundary behaviour**:
   * ``brightness`` at the exact midpoint maps to LOW contrast.
   * ``warm_cool_score`` at the exact threshold maps to NEUTRAL (raises).

3. **Neutral-zone tiebreaker**:
   * score in neutral zone + valid hue band → resolved to warm/cool.
   * score in neutral zone + achromatic (low saturation) → ValueError.
   * score in neutral zone + ambiguous hue → ValueError.

4. **Input validation**:
   * Out-of-range scalars raise ValueError.
   * Non-numeric types raise TypeError.
   * Wrong thresholds type raises TypeError.

5. **Threshold overrides** — custom ``HSBClassifierThresholds`` respected.

Korean personal-colour truth table:
    +-----------+-------------------+-------------------+
    |           | brightness HIGH   | brightness LOW    |
    |           | (> 0.5 default)   | (<= 0.5 default)  |
    +-----------+-------------------+-------------------+
    | warm tone | 'spring' (봄)     | 'autumn' (가을)    |
    | cool tone | 'winter' (겨울)   | 'summer' (여름)    |
    +-----------+-------------------+-------------------+
"""

from __future__ import annotations

import pytest

from personal_color.hsb_season_classifier import (
    DEFAULT_HSB_THRESHOLDS,
    HSBClassifierThresholds,
    classify_season_from_hsb_features,
)

# ---------------------------------------------------------------------------
# Section 1: 4-season representative feature vectors (primary AC requirement)
#
# Each vector is a prototype for the labelled season.  Values are chosen well
# inside the decision boundaries (warm_cool_score far from ±0.02, brightness
# far from 0.5) so the tests are robust to reasonable threshold calibration.
#
# 봄 (Spring)  — warm undertone + bright value
#     Peach/ivory skin, clear gold highlight → warm_cool_score > 0, brightness high
# 가을 (Autumn) — warm undertone + dark value
#     Amber/olive skin, muted deep tone → warm_cool_score > 0, brightness low
# 겨울 (Winter) — cool undertone + bright value
#     Porcelain/ivory skin with pink-blue tint, high-contrast clear → wcs < 0, bright
# 여름 (Summer) — cool undertone + dark value
#     Rose-beige muted skin with lavender-pink undertone → wcs < 0, brightness low
# ---------------------------------------------------------------------------

_REPRESENTATIVE_VECTORS = [
    # (hue, saturation, brightness, warm_cool_score, expected_season)
    pytest.param(
        25.0,  # warm orange-gold hue
        0.45,  # moderate saturation
        0.78,  # HIGH brightness → 봄
        0.15,  # clearly warm
        "spring",
        id="spring_봄_warm_bright",
    ),
    pytest.param(
        20.0,  # warm amber hue
        0.55,  # moderate-high saturation
        0.32,  # LOW brightness → 가을
        0.22,  # clearly warm
        "autumn",
        id="autumn_가을_warm_dark",
    ),
    pytest.param(
        220.0,  # cool blue-violet hue
        0.35,  # low-moderate saturation
        0.82,  # HIGH brightness → 겨울
        -0.12,  # clearly cool
        "winter",
        id="winter_겨울_cool_bright",
    ),
    pytest.param(
        200.0,  # cool blue-cyan hue
        0.30,  # low saturation (muted)
        0.42,  # LOW brightness → 여름
        -0.08,  # clearly cool
        "summer",
        id="summer_여름_cool_dark",
    ),
]


@pytest.mark.unit
@pytest.mark.parametrize(
    ("hue", "saturation", "brightness", "warm_cool_score", "expected"),
    _REPRESENTATIVE_VECTORS,
)
def test_four_season_representative_vectors(
    hue: float,
    saturation: float,
    brightness: float,
    warm_cool_score: float,
    expected: str,
) -> None:
    """4개 시즌 대표 특징값 벡터 각각 올바른 카테고리 반환 검증 (AC 17-2)."""
    result = classify_season_from_hsb_features(
        hue, saturation, brightness, warm_cool_score
    )
    assert result == expected, (
        f"Expected season={expected!r} for "
        f"hue={hue}, sat={saturation}, bri={brightness}, wcs={warm_cool_score}; "
        f"got {result!r}"
    )


@pytest.mark.unit
def test_four_season_representatives_are_all_distinct() -> None:
    """The four representative vectors each map to a *distinct* season string."""
    results = {
        classify_season_from_hsb_features(hue, sat, bri, wcs)
        for hue, sat, bri, wcs, _ in [
            param.values for param in _REPRESENTATIVE_VECTORS  # type: ignore[attr-defined]
        ]
    }
    assert results == {
        "spring",
        "summer",
        "autumn",
        "winter",
    }, f"Expected all four seasons; got {sorted(results)}"


# ---------------------------------------------------------------------------
# Section 2: Warm/cool score as the primary axis
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    ("warm_cool_score", "brightness", "expected"),
    [
        (0.5, 0.8, "spring"),  # strongly warm + bright
        (0.5, 0.2, "autumn"),  # strongly warm + dark
        (-0.5, 0.8, "winter"),  # strongly cool + bright
        (-0.5, 0.2, "summer"),  # strongly cool + dark
    ],
    ids=["strong_spring", "strong_autumn", "strong_winter", "strong_summer"],
)
def test_primary_warm_cool_score_axis(
    warm_cool_score: float,
    brightness: float,
    expected: str,
) -> None:
    """warm_cool_score far from neutral zone → season determined without hue."""
    result = classify_season_from_hsb_features(
        hue=30.0,  # hue irrelevant when score is unambiguous
        saturation=0.4,
        brightness=brightness,
        warm_cool_score=warm_cool_score,
    )
    assert result == expected


# ---------------------------------------------------------------------------
# Section 3: Brightness boundary
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    ("warm_cool_score", "expected_at_midpoint"),
    [
        (0.15, "autumn"),  # warm + brightness == 0.5 → LOW → 가을
        (-0.15, "summer"),  # cool + brightness == 0.5 → LOW → 여름
    ],
    ids=["autumn_at_midpoint", "summer_at_midpoint"],
)
def test_brightness_at_exact_midpoint_maps_to_low_contrast(
    warm_cool_score: float,
    expected_at_midpoint: str,
) -> None:
    """Exact brightness == 0.5 (midpoint) maps to LOW contrast (가을/여름)."""
    midpoint = DEFAULT_HSB_THRESHOLDS.brightness_midpoint  # 0.5
    result = classify_season_from_hsb_features(
        hue=30.0,
        saturation=0.4,
        brightness=midpoint,
        warm_cool_score=warm_cool_score,
    )
    assert result == expected_at_midpoint


@pytest.mark.unit
def test_brightness_just_above_midpoint_maps_to_high_contrast() -> None:
    """brightness marginally above 0.5 → HIGH contrast → spring (warm)."""
    midpoint = DEFAULT_HSB_THRESHOLDS.brightness_midpoint
    result = classify_season_from_hsb_features(
        hue=30.0,
        saturation=0.4,
        brightness=midpoint + 1e-9,
        warm_cool_score=0.15,
    )
    assert result == "spring"


# ---------------------------------------------------------------------------
# Section 4: Neutral zone tiebreaker — hue resolves the undertone
# ---------------------------------------------------------------------------

_WCS_NEUTRAL = 0.0  # exactly in the centre of the neutral zone


@pytest.mark.unit
@pytest.mark.parametrize(
    ("hue", "brightness", "expected"),
    [
        # Warm hue band: 0–60°
        (30.0, 0.8, "spring"),  # warm hue + bright → 봄
        (30.0, 0.2, "autumn"),  # warm hue + dark  → 가을
        # Warm hue wrap band: >300°
        (320.0, 0.8, "spring"),  # pink/magenta + bright → 봄
        (320.0, 0.2, "autumn"),  # pink/magenta + dark  → 가을
        # Cool hue band: 180–270°
        (240.0, 0.8, "winter"),  # blue + bright → 겨울
        (240.0, 0.2, "summer"),  # blue + dark   → 여름
    ],
    ids=[
        "warm_hue_bright",
        "warm_hue_dark",
        "warm_wrap_bright",
        "warm_wrap_dark",
        "cool_hue_bright",
        "cool_hue_dark",
    ],
)
def test_neutral_zone_resolved_by_hue(
    hue: float,
    brightness: float,
    expected: str,
) -> None:
    """warm_cool_score in neutral zone, sufficient saturation: hue tiebreaker."""
    result = classify_season_from_hsb_features(
        hue=hue,
        saturation=0.4,  # well above saturation_floor=0.08
        brightness=brightness,
        warm_cool_score=_WCS_NEUTRAL,
    )
    assert result == expected


# ---------------------------------------------------------------------------
# Section 5: Neutral zone — ValueError cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_neutral_zone_achromatic_raises_value_error() -> None:
    """Neutral score + saturation below floor → ValueError (no hue signal)."""
    with pytest.raises(ValueError, match="achromatic"):
        classify_season_from_hsb_features(
            hue=30.0,
            saturation=0.01,  # well below floor=0.08
            brightness=0.7,
            warm_cool_score=0.0,
        )


@pytest.mark.unit
@pytest.mark.parametrize(
    "hue",
    [90.0, 150.0, 280.0],  # yellow-green and purple ranges
    ids=["yellow_green_90", "green_150", "purple_280"],
)
def test_neutral_zone_ambiguous_hue_raises_value_error(hue: float) -> None:
    """Neutral score + hue in mid-range band → ValueError (ambiguous undertone)."""
    with pytest.raises(ValueError, match="ambiguous"):
        classify_season_from_hsb_features(
            hue=hue,
            saturation=0.4,
            brightness=0.7,
            warm_cool_score=0.0,
        )


@pytest.mark.unit
def test_exact_warm_threshold_is_neutral() -> None:
    """warm_cool_score exactly at +threshold → neutral zone → hue tiebreaker used."""
    threshold = DEFAULT_HSB_THRESHOLDS.warm_threshold  # 0.02
    # hue=30 (warm band) should resolve to spring
    result = classify_season_from_hsb_features(
        hue=30.0,
        saturation=0.4,
        brightness=0.8,
        warm_cool_score=threshold,  # exactly at boundary → neutral zone
    )
    assert result == "spring"  # resolved via warm hue tiebreaker


@pytest.mark.unit
def test_just_above_warm_threshold_is_warm_direct() -> None:
    """warm_cool_score marginally above threshold → resolved to warm directly."""
    threshold = DEFAULT_HSB_THRESHOLDS.warm_threshold
    result = classify_season_from_hsb_features(
        hue=240.0,  # cool hue — would give winter if score were neutral
        saturation=0.4,
        brightness=0.8,
        warm_cool_score=threshold + 1e-9,  # fractionally above threshold → warm
    )
    # warm_cool_score wins over hue → warm + bright → spring
    assert result == "spring"


# ---------------------------------------------------------------------------
# Section 6: Input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    ("hue", "sat", "bri", "wcs"),
    [
        (-0.1, 0.4, 0.7, 0.1),  # hue below 0
        (361.0, 0.4, 0.7, 0.1),  # hue above 360
        (30.0, -0.1, 0.7, 0.1),  # saturation below 0
        (30.0, 1.1, 0.7, 0.1),  # saturation above 1
        (30.0, 0.4, -0.1, 0.1),  # brightness below 0
        (30.0, 0.4, 1.1, 0.1),  # brightness above 1
        (30.0, 0.4, 0.7, -1.1),  # warm_cool_score below -1
        (30.0, 0.4, 0.7, 1.1),  # warm_cool_score above 1
    ],
    ids=[
        "hue_neg",
        "hue_over360",
        "sat_neg",
        "sat_over1",
        "bri_neg",
        "bri_over1",
        "wcs_neg",
        "wcs_over1",
    ],
)
def test_out_of_range_scalars_raise_value_error(
    hue: float, sat: float, bri: float, wcs: float
) -> None:
    with pytest.raises(ValueError):
        classify_season_from_hsb_features(hue, sat, bri, wcs)


@pytest.mark.unit
def test_bool_hue_raises_type_error() -> None:
    """bool is not accepted as a numeric input (bool is a subclass of int)."""
    with pytest.raises(TypeError, match="hue"):
        classify_season_from_hsb_features(
            True,  # type: ignore[arg-type]
            0.4,
            0.7,
            0.1,
        )


@pytest.mark.unit
def test_string_input_raises_type_error() -> None:
    """String inputs raise TypeError."""
    with pytest.raises(TypeError):
        classify_season_from_hsb_features(
            "30",  # type: ignore[arg-type]
            0.4,
            0.7,
            0.1,
        )


@pytest.mark.unit
def test_wrong_thresholds_type_raises_type_error() -> None:
    """Passing a plain dict instead of HSBClassifierThresholds raises TypeError."""
    with pytest.raises(TypeError, match="HSBClassifierThresholds"):
        classify_season_from_hsb_features(
            30.0,
            0.4,
            0.7,
            0.15,
            thresholds={"warm_threshold": 0.02},  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# Section 7: Threshold overrides
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_custom_warm_threshold_widens_neutral_zone() -> None:
    """With warm_threshold=0.20, warm_cool_score=0.15 lands in neutral zone."""
    wide_neutral = HSBClassifierThresholds(warm_threshold=0.20)
    # score=0.15 would be WARM under the default (0.02) but is neutral under 0.20
    # hue=30 (warm band) resolves it to spring
    result = classify_season_from_hsb_features(
        30.0, 0.4, 0.8, 0.15, thresholds=wide_neutral
    )
    assert result == "spring"  # resolved via hue fallback


@pytest.mark.unit
def test_custom_brightness_midpoint_shifts_contrast_boundary() -> None:
    """With brightness_midpoint=0.7, brightness=0.6 maps to LOW → autumn."""
    high_midpoint = HSBClassifierThresholds(brightness_midpoint=0.7)
    result = classify_season_from_hsb_features(
        30.0,
        0.4,
        0.6,  # 0.6 > 0.5 (default) but 0.6 < 0.7 (custom)
        warm_cool_score=0.15,
        thresholds=high_midpoint,
    )
    assert result == "autumn"  # warm + low brightness under custom threshold


@pytest.mark.unit
def test_custom_saturation_floor_allows_lower_saturation_tiebreaker() -> None:
    """Lower saturation floor allows hue tiebreaker for low-saturation inputs."""
    low_floor = HSBClassifierThresholds(saturation_floor=0.005)
    # saturation=0.02 is below the default floor (0.08) but above 0.005
    result = classify_season_from_hsb_features(
        hue=30.0,
        saturation=0.02,
        brightness=0.8,
        warm_cool_score=0.0,  # neutral score
        thresholds=low_floor,
    )
    assert result == "spring"  # resolved via warm hue (30°) + bright


# ---------------------------------------------------------------------------
# Section 8: Return type contract
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_return_value_is_string() -> None:
    """Function always returns a plain str, not an enum."""
    result = classify_season_from_hsb_features(30.0, 0.4, 0.8, 0.15)
    assert isinstance(result, str)
    assert not hasattr(result, "name")  # not an enum member


@pytest.mark.unit
def test_return_values_are_lowercase_ascii_slugs() -> None:
    """All four return values are lowercase ASCII, matching DB-safe slug contract."""
    vectors = [
        (25.0, 0.45, 0.78, 0.15),  # spring
        (20.0, 0.55, 0.32, 0.22),  # autumn
        (220.0, 0.35, 0.82, -0.12),  # winter
        (200.0, 0.30, 0.42, -0.08),  # summer
    ]
    for hue, sat, bri, wcs in vectors:
        result = classify_season_from_hsb_features(hue, sat, bri, wcs)
        assert result == result.lower()
        assert result.isascii()
        assert result in {"spring", "summer", "autumn", "winter"}
