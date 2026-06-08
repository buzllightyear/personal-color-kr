"""Unit tests for feature_vector_classifier (Sub-AC 12.2).

색 특성 벡터(warm/cool 언더톤, light/dark 밸류 등)를 입력받아
봄/여름/가을/겨울 4개 카테고리 중 하나로 매핑하는 분류 함수를 검증한다.

Test strategy
-------------
Every test exercises a *known* feature→label pair so that the mapping can
be audited by inspection (not only by running the suite).  The parametrized
truth-table section covers all four (undertone × brightness) cells; the
remaining sections handle edge-cases, input validation, and threshold
overrides.

Korean personal-colour truth table under test:

  +---------------------------+--------------------+--------------------+
  | color_temperature         | brightness HIGH    | brightness LOW     |
  |                           | (> 0.5 default)    | (<= 0.5 default)   |
  +---------------------------+--------------------+--------------------+
  | WARM  (ct > +0.02)        | 봄  (SPRING)        | 가을 (AUTUMN)       |
  | COOL  (ct < -0.02)        | 겨울 (WINTER)        | 여름 (SUMMER)       |
  +---------------------------+--------------------+--------------------+

Test sections
-------------
1. Four known (feature, Season) pairs — exhaustive 2×2 coverage.
2. Neutral zone — rejection when |color_temperature| <= warm_threshold.
3. Brightness boundary — exact midpoint maps to LOW (not HIGH).
4. Warm threshold boundary — exact threshold maps to NEUTRAL.
5. Input validation — TypeError / ValueError on bad inputs.
6. Threshold overrides — custom FeatureVectorThresholds respected.
7. saturation — informational axis, never changes the season result.
8. Integration with compute_color_features — round-trip from pixels.
"""

from __future__ import annotations

import pytest

from personal_color.color_features import ColorFeatureVector, compute_color_features
from personal_color.feature_vector_classifier import (
    DEFAULT_FEATURE_THRESHOLDS,
    FeatureVectorThresholds,
    classify_season_from_feature_vector,
)
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Helper — build a feature vector with the given temperature and brightness,
# saturation fixed at a neutral mid-value so the warm/cool / light/dark
# signals are the only variables.
# ---------------------------------------------------------------------------

_SAT = 0.3  # representative saturation — not used in the classifier


def _fv(
    color_temperature: float,
    brightness: float,
    saturation: float = _SAT,
) -> ColorFeatureVector:
    """Convenience constructor for test fixtures."""
    return ColorFeatureVector(
        color_temperature=color_temperature,
        brightness=brightness,
        saturation=saturation,
    )


# ---------------------------------------------------------------------------
# Section 1 — Four known feature→label pairs (2×2 exhaustive truth table)
#
# Each tuple is (color_temperature, brightness, expected_season).
# Values are deliberately *well inside* the decision boundaries so they
# are immune to threshold calibration changes that stay within a ±0.1
# margin around the defaults.
# ---------------------------------------------------------------------------

_TRUTH_TABLE: tuple[tuple[float, float, Season], ...] = (
    # warm + high brightness → 봄 (Spring): bright, clear, golden
    (0.15, 0.70, Season.SPRING),
    # warm + low brightness  → 가을 (Autumn): deep, muted, earthy
    (0.15, 0.30, Season.AUTUMN),
    # cool + high brightness → 겨울 (Winter): clear, cool, high-contrast
    (-0.15, 0.70, Season.WINTER),
    # cool + low brightness  → 여름 (Summer): light, muted, cool
    (-0.15, 0.30, Season.SUMMER),
)


@pytest.mark.unit
@pytest.mark.parametrize(
    ("color_temperature", "brightness", "expected_season"),
    _TRUTH_TABLE,
    ids=["spring", "autumn", "winter", "summer"],
)
def test_truth_table_known_feature_label_pairs(
    color_temperature: float,
    brightness: float,
    expected_season: Season,
) -> None:
    """All four (undertone × brightness) cells produce the expected season."""
    features = _fv(color_temperature, brightness)
    assert classify_season_from_feature_vector(features) is expected_season


@pytest.mark.unit
def test_truth_table_all_four_seasons_are_distinct() -> None:
    """The function is a bijection on the 2×2 feature space — no two cells
    collapse to the same season."""
    seasons = {
        classify_season_from_feature_vector(_fv(ct, br)) for ct, br, _ in _TRUTH_TABLE
    }
    assert len(seasons) == 4, (
        "truth table does not produce four distinct seasons — "
        f"got {sorted(s.name for s in seasons)}"
    )
    assert seasons == set(Season)


# ---------------------------------------------------------------------------
# Section 2 — Neutral zone: |color_temperature| <= warm_threshold raises
# ---------------------------------------------------------------------------

_WARM_THRESHOLD = DEFAULT_FEATURE_THRESHOLDS.warm_threshold  # 0.02


@pytest.mark.unit
@pytest.mark.parametrize(
    "color_temperature",
    [
        0.0,  # exact centre
        _WARM_THRESHOLD,  # exact upper boundary (exclusive → neutral)
        -_WARM_THRESHOLD,  # exact lower boundary (exclusive → neutral)
        _WARM_THRESHOLD * 0.5,  # inside the zone
        -_WARM_THRESHOLD * 0.5,  # inside the zone
    ],
    ids=["zero", "upper_boundary", "lower_boundary", "inner_pos", "inner_neg"],
)
def test_neutral_zone_raises_value_error(color_temperature: float) -> None:
    """color_temperature in (-warm_threshold, +warm_threshold) inclusive must
    raise ValueError — the classifier refuses to commit a season."""
    features = _fv(color_temperature, brightness=0.7)
    with pytest.raises(ValueError, match="neutral zone"):
        classify_season_from_feature_vector(features)


@pytest.mark.unit
def test_just_above_warm_threshold_is_warm() -> None:
    """color_temperature strictly above warm_threshold → WARM branch."""
    ct = _WARM_THRESHOLD + 1e-9  # infinitesimally above the boundary
    features = _fv(ct, brightness=0.7)
    assert classify_season_from_feature_vector(features) is Season.SPRING


@pytest.mark.unit
def test_just_below_neg_warm_threshold_is_cool() -> None:
    """color_temperature strictly below -warm_threshold → COOL branch."""
    ct = -_WARM_THRESHOLD - 1e-9
    features = _fv(ct, brightness=0.7)
    assert classify_season_from_feature_vector(features) is Season.WINTER


# ---------------------------------------------------------------------------
# Section 3 — Brightness boundary: exact midpoint → LOW contrast → 가을/여름
# ---------------------------------------------------------------------------

_MIDPOINT = DEFAULT_FEATURE_THRESHOLDS.brightness_midpoint  # 0.5


@pytest.mark.unit
@pytest.mark.parametrize(
    ("color_temperature", "expected_season"),
    [
        (0.15, Season.AUTUMN),  # warm, brightness == midpoint → LOW → 가을
        (-0.15, Season.SUMMER),  # cool, brightness == midpoint → LOW → 여름
    ],
    ids=["autumn", "summer"],
)
def test_brightness_at_exact_midpoint_maps_to_low_contrast(
    color_temperature: float,
    expected_season: Season,
) -> None:
    """Exact brightness == midpoint → Contrast.LOW (strict greater-than rule)."""
    features = _fv(color_temperature, brightness=_MIDPOINT)
    assert classify_season_from_feature_vector(features) is expected_season


@pytest.mark.unit
def test_brightness_just_above_midpoint_maps_to_high_contrast() -> None:
    """brightness > midpoint by the smallest representable float → HIGH."""
    features = _fv(0.15, brightness=_MIDPOINT + 1e-9)
    assert classify_season_from_feature_vector(features) is Season.SPRING


# ---------------------------------------------------------------------------
# Section 4 — Input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_raises_type_error_for_non_feature_vector() -> None:
    """Passing a plain dict instead of ColorFeatureVector raises TypeError."""
    with pytest.raises(TypeError, match="ColorFeatureVector"):
        classify_season_from_feature_vector(  # type: ignore[arg-type]
            {"color_temperature": 0.15, "brightness": 0.7, "saturation": 0.3}
        )


@pytest.mark.unit
def test_raises_type_error_for_non_thresholds() -> None:
    """Passing a plain dict instead of FeatureVectorThresholds raises TypeError."""
    features = _fv(0.15, brightness=0.7)
    with pytest.raises(TypeError, match="FeatureVectorThresholds"):
        classify_season_from_feature_vector(features, thresholds={"warm_threshold": 0.02})  # type: ignore[arg-type]


@pytest.mark.unit
@pytest.mark.parametrize(
    ("color_temperature", "brightness"),
    [
        (2.0, 0.5),  # color_temperature > 1.0 (out of [-1, 1])
        (-2.0, 0.5),  # color_temperature < -1.0
        (0.3, 1.5),  # brightness > 1.0 (out of [0, 1])
        (0.3, -0.1),  # brightness < 0.0
    ],
    ids=["ct_too_high", "ct_too_low", "br_too_high", "br_too_low"],
)
def test_out_of_range_values_are_still_classifiable_if_in_valid_domain(
    color_temperature: float,
    brightness: float,
) -> None:
    """ColorFeatureVector accepts any float — out-of-range is an application
    concern, not a classifier concern.  If the value is out of the formal
    domain, the function still produces a season (it does not re-validate
    the vector internals).  This test documents current behaviour — callers
    that need domain-safe values should validate upstream."""
    # color_temperature == 2.0 is unambiguously warm, brightness == 1.5 is
    # unambiguously high — no ValueError expected.
    if abs(color_temperature) <= DEFAULT_FEATURE_THRESHOLDS.warm_threshold:
        pytest.skip("test value lands in neutral zone — separate test section")
    features = ColorFeatureVector(
        color_temperature=color_temperature,
        brightness=brightness,
        saturation=0.3,
    )
    result = classify_season_from_feature_vector(features)
    assert isinstance(result, Season)


# ---------------------------------------------------------------------------
# Section 5 — Threshold overrides
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_custom_warm_threshold_widens_neutral_zone() -> None:
    """With warm_threshold=0.20, color_temperature=0.15 is in the neutral zone."""
    custom = FeatureVectorThresholds(warm_threshold=0.20, brightness_midpoint=0.5)
    features = _fv(0.15, brightness=0.7)
    with pytest.raises(ValueError):
        classify_season_from_feature_vector(features, thresholds=custom)


@pytest.mark.unit
def test_custom_warm_threshold_passes_for_value_above_it() -> None:
    """With warm_threshold=0.20, color_temperature=0.25 → WARM (봄 or 가을)."""
    custom = FeatureVectorThresholds(warm_threshold=0.20, brightness_midpoint=0.5)
    features = _fv(0.25, brightness=0.7)
    assert (
        classify_season_from_feature_vector(features, thresholds=custom)
        is Season.SPRING
    )


@pytest.mark.unit
def test_custom_brightness_midpoint_shifts_contrast_boundary() -> None:
    """With brightness_midpoint=0.7, brightness=0.6 → LOW contrast (가을)."""
    custom = FeatureVectorThresholds(warm_threshold=0.02, brightness_midpoint=0.7)
    features = _fv(0.15, brightness=0.6)
    assert (
        classify_season_from_feature_vector(features, thresholds=custom)
        is Season.AUTUMN
    )


# ---------------------------------------------------------------------------
# Section 6 — saturation is informational (does not affect season)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "saturation",
    [0.0, 0.01, 0.5, 0.99, 1.0],
    ids=["s0", "s01", "s05", "s099", "s1"],
)
def test_saturation_does_not_change_season(saturation: float) -> None:
    """Any saturation value with the same temperature and brightness gives the
    same season — saturation is informational in this classifier."""
    features = _fv(0.15, brightness=0.7, saturation=saturation)
    assert classify_season_from_feature_vector(features) is Season.SPRING


# ---------------------------------------------------------------------------
# Section 7 — Integration: compute_color_features → classify_season
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_round_trip_warm_high_key_pixels_spring() -> None:
    """Warm-biased, high-brightness pixels round-trip to 봄 (Spring).

    Simulates what the pipeline does: extract skin pixels → compute features
    → classify season.  Reddish-peach pixels with high brightness are the
    prototypical Spring (봄웜) skin signature.
    """
    # High-key peach pixels: R >> B, bright (brightness ≈ 0.80 > 0.5)
    warm_bright_pixels = tuple((220, 185, 155) for _ in range(10))
    features = compute_color_features(warm_bright_pixels)
    assert features.color_temperature > DEFAULT_FEATURE_THRESHOLDS.warm_threshold
    assert features.brightness > DEFAULT_FEATURE_THRESHOLDS.brightness_midpoint
    assert classify_season_from_feature_vector(features) is Season.SPRING


@pytest.mark.unit
def test_round_trip_cool_high_key_pixels_winter() -> None:
    """Cool-biased, high-brightness pixels round-trip to 겨울 (Winter).

    Pinkish-cool high-key pixels are the prototypical Winter (겨울쿨) skin
    signature: porcelain/ivory with a blue-pink undertone.
    """
    cool_bright_pixels = tuple((195, 205, 230) for _ in range(10))
    features = compute_color_features(cool_bright_pixels)
    assert features.color_temperature < -DEFAULT_FEATURE_THRESHOLDS.warm_threshold
    assert features.brightness > DEFAULT_FEATURE_THRESHOLDS.brightness_midpoint
    assert classify_season_from_feature_vector(features) is Season.WINTER


@pytest.mark.unit
def test_round_trip_warm_low_key_pixels_autumn() -> None:
    """Warm-biased, low-brightness pixels round-trip to 가을 (Autumn).

    Deep amber-olive pixels are the prototypical Autumn (가을웜) skin
    signature: rich, dark, muted warm tone.
    """
    # (140, 100, 80): ct = (140-80)/255 ≈ 0.235 (warm), brightness ≈ 0.430 (< 0.5)
    warm_dark_pixels = tuple((140, 100, 80) for _ in range(10))
    features = compute_color_features(warm_dark_pixels)
    assert features.color_temperature > DEFAULT_FEATURE_THRESHOLDS.warm_threshold
    assert features.brightness <= DEFAULT_FEATURE_THRESHOLDS.brightness_midpoint
    assert classify_season_from_feature_vector(features) is Season.AUTUMN


@pytest.mark.unit
def test_round_trip_cool_low_key_pixels_summer() -> None:
    """Cool-biased, low-brightness pixels round-trip to 여름 (Summer).

    Muted rose-beige pixels with a pink/blue undertone are the prototypical
    Summer (여름쿨) skin signature: soft, muted, cool.
    """
    # (110, 105, 130): ct = (110-130)/255 ≈ -0.078 (cool), brightness ≈ 0.429 (< 0.5)
    cool_muted_pixels = tuple((110, 105, 130) for _ in range(10))
    features = compute_color_features(cool_muted_pixels)
    assert features.color_temperature < -DEFAULT_FEATURE_THRESHOLDS.warm_threshold
    assert features.brightness <= DEFAULT_FEATURE_THRESHOLDS.brightness_midpoint
    assert classify_season_from_feature_vector(features) is Season.SUMMER


# ---------------------------------------------------------------------------
# Section 8 — Season enum completeness check (no regression)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classifier_can_produce_all_four_seasons() -> None:
    """Smoke check: every Season member is reachable via this classifier."""
    cases = [
        (0.10, 0.70),  # SPRING
        (-0.10, 0.70),  # WINTER
        (0.10, 0.30),  # AUTUMN
        (-0.10, 0.30),  # SUMMER
    ]
    produced = {classify_season_from_feature_vector(_fv(ct, br)) for ct, br in cases}
    assert produced == set(Season)
