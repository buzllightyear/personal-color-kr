"""Unit tests for Sub-AC 3b — classify_personal_color.

퍼스널 컬러 카테고리(spring/summer/autumn/winter)와 신뢰도(0~1)를 반환하는
분류 함수를 mock feature 벡터로 검증한다.

검증 항목:
1. 출력 스키마 — PersonalColorResult.category (str), .confidence (float)
2. 4가지 카테고리 매핑 (2×2 진리표)
3. 신뢰도 경계값
   a. 중립 영역 정확히 경계 → ValueError (분류 불가)
   b. 의사결정 경계 바로 위 → confidence ≈ 0.0 (한쪽 축이 경계)
   c. brightness 정확히 midpoint → bright_conf = 0 → confidence = 0.0
   d. 극단값 (|ct|=1.0, brightness=0.0/1.0) → confidence = 1.0
4. 신뢰도 범위 [0.0, 1.0] 항상 준수
5. 입력 타입 오류 전파 (TypeError, ValueError)
6. 임계값 오버라이드 반영
7. saturation 무관 (tone/brightness만 신뢰도에 영향)
"""

from __future__ import annotations

import math

import pytest

from personal_color.color_features import ColorFeatureVector, compute_color_features
from personal_color.feature_vector_classifier import (
    DEFAULT_FEATURE_THRESHOLDS,
    FeatureVectorThresholds,
    PersonalColorResult,
    classify_personal_color,
)

# ---------------------------------------------------------------------------
# Helper — build a feature vector from explicit components.
# ---------------------------------------------------------------------------

_SAT = 0.3  # representative saturation — not used in classifier


def _fv(
    color_temperature: float,
    brightness: float,
    saturation: float = _SAT,
) -> ColorFeatureVector:
    """Convenience constructor for test fixtures (mock feature vector)."""
    return ColorFeatureVector(
        color_temperature=color_temperature,
        brightness=brightness,
        saturation=saturation,
    )


# Default threshold aliases for readable boundary assertions
_WT = DEFAULT_FEATURE_THRESHOLDS.warm_threshold  # 0.02
_MID = DEFAULT_FEATURE_THRESHOLDS.brightness_midpoint  # 0.5


# ---------------------------------------------------------------------------
# Section 1 — Output schema validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_result_is_personal_color_result_instance() -> None:
    """classify_personal_color returns a PersonalColorResult instance."""
    features = _fv(0.15, 0.70)
    result = classify_personal_color(features)
    assert isinstance(result, PersonalColorResult)


@pytest.mark.unit
def test_result_has_category_str() -> None:
    """PersonalColorResult.category is a str."""
    result = classify_personal_color(_fv(0.15, 0.70))
    assert isinstance(result.category, str)


@pytest.mark.unit
def test_result_has_confidence_float() -> None:
    """PersonalColorResult.confidence is a float."""
    result = classify_personal_color(_fv(0.15, 0.70))
    assert isinstance(result.confidence, float)


@pytest.mark.unit
def test_result_is_immutable() -> None:
    """PersonalColorResult is frozen — mutation raises AttributeError."""
    result = classify_personal_color(_fv(0.15, 0.70))
    with pytest.raises(AttributeError):
        result.category = "spring"  # type: ignore[misc]


@pytest.mark.unit
def test_confidence_is_in_unit_interval() -> None:
    """confidence is always in [0.0, 1.0]."""
    for ct, br in [
        (0.15, 0.70),
        (-0.15, 0.70),
        (0.15, 0.30),
        (-0.15, 0.30),
        (0.03, 0.51),  # very close to both boundaries
        (1.0, 0.0),  # extreme warm, very dark
        (-1.0, 1.0),  # extreme cool, very bright
    ]:
        result = classify_personal_color(_fv(ct, br))
        assert (
            0.0 <= result.confidence <= 1.0
        ), f"confidence out of [0, 1] for ct={ct}, br={br}: {result.confidence}"


# ---------------------------------------------------------------------------
# Section 2 — 4-category mapping (2×2 truth table)
# ---------------------------------------------------------------------------

_CATEGORY_TABLE: tuple[tuple[float, float, str], ...] = (
    # warm + high brightness → 봄 (spring)
    (0.15, 0.70, "spring"),
    # warm + low brightness  → 가을 (autumn)
    (0.15, 0.30, "autumn"),
    # cool + high brightness → 겨울 (winter)
    (-0.15, 0.70, "winter"),
    # cool + low brightness  → 여름 (summer)
    (-0.15, 0.30, "summer"),
)


@pytest.mark.unit
@pytest.mark.parametrize(
    ("color_temperature", "brightness", "expected_category"),
    _CATEGORY_TABLE,
    ids=["spring", "autumn", "winter", "summer"],
)
def test_category_mapping_truth_table(
    color_temperature: float,
    brightness: float,
    expected_category: str,
) -> None:
    """All four (undertone × brightness) cells produce the correct category slug."""
    result = classify_personal_color(_fv(color_temperature, brightness))
    assert result.category == expected_category


@pytest.mark.unit
def test_category_slug_is_lowercase_ascii() -> None:
    """category is always a lowercase ASCII slug — no Korean or mixed case."""
    for ct, br, _ in _CATEGORY_TABLE:
        result = classify_personal_color(_fv(ct, br))
        assert result.category == result.category.lower()
        assert result.category.isascii()


@pytest.mark.unit
def test_all_four_categories_are_reachable() -> None:
    """Smoke check: all four category slugs are producible."""
    categories = {
        classify_personal_color(_fv(ct, br)).category for ct, br, _ in _CATEGORY_TABLE
    }
    assert categories == {"spring", "summer", "autumn", "winter"}


# ---------------------------------------------------------------------------
# Section 3a — Neutral zone → ValueError (category cannot be determined)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "color_temperature",
    [
        0.0,  # exact centre of neutral zone
        _WT,  # exact upper boundary (inclusive → neutral)
        -_WT,  # exact lower boundary (inclusive → neutral)
        _WT * 0.5,  # inside the zone
        -_WT * 0.5,  # inside the zone (negative)
    ],
    ids=["zero", "upper_boundary", "lower_boundary", "inner_pos", "inner_neg"],
)
def test_neutral_zone_raises_value_error(color_temperature: float) -> None:
    """color_temperature in neutral zone → ValueError (cannot commit a season)."""
    with pytest.raises(ValueError, match="neutral zone"):
        classify_personal_color(_fv(color_temperature, brightness=0.7))


# ---------------------------------------------------------------------------
# Section 3b — Confidence at decision boundaries
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_confidence_near_zero_just_above_warm_threshold() -> None:
    """Just barely above warm_threshold → tone_conf ≈ 0 → confidence ≈ 0."""
    epsilon = 1e-9
    ct = _WT + epsilon  # infinitesimally past the neutral-zone edge
    result = classify_personal_color(
        _fv(ct, brightness=0.0)
    )  # extreme brightness → bright_conf=1
    # tone_conf = (ct - _WT) / (1 - _WT) ≈ 0, confidence ≈ sqrt(~0 * 1) ≈ 0
    assert result.confidence < 1e-4


@pytest.mark.unit
def test_confidence_is_zero_at_brightness_midpoint() -> None:
    """brightness == midpoint → bright_conf = 0.0 → confidence = 0.0 exactly."""
    # warm tone (unambiguously warm), brightness exactly at midpoint
    result = classify_personal_color(_fv(0.50, brightness=_MID))
    # bright_dist = 0.0 → confidence = sqrt(tone_conf * 0.0) = 0.0
    assert result.confidence == pytest.approx(0.0, abs=1e-12)


@pytest.mark.unit
def test_confidence_is_zero_when_both_axes_on_boundary() -> None:
    """Both axes at their boundaries → confidence = 0.0."""
    # ct just past warm_threshold, brightness exactly at midpoint
    epsilon = 1e-9
    result = classify_personal_color(_fv(_WT + epsilon, brightness=_MID))
    assert result.confidence == pytest.approx(0.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Section 3d — Confidence at extremes (near 1.0)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_confidence_is_one_at_maximum_extreme() -> None:
    """ct = 1.0, brightness = 0.0 → both axis confidences = 1.0 → confidence = 1.0."""
    result = classify_personal_color(_fv(1.0, brightness=0.0))
    assert result.confidence == pytest.approx(1.0, abs=1e-9)


@pytest.mark.unit
def test_confidence_is_one_at_cool_extreme_high_brightness() -> None:
    """ct = -1.0, brightness = 1.0 → both axes extreme → confidence = 1.0."""
    result = classify_personal_color(_fv(-1.0, brightness=1.0))
    assert result.confidence == pytest.approx(1.0, abs=1e-9)


@pytest.mark.unit
def test_confidence_near_one_for_strong_signals() -> None:
    """Very warm, very bright signals produce confidence close to 1.0."""
    result = classify_personal_color(_fv(0.95, brightness=0.95))
    assert result.confidence > 0.90


# ---------------------------------------------------------------------------
# Section 4 — Confidence monotonicity
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_confidence_increases_as_ct_moves_away_from_boundary() -> None:
    """Confidence is monotonically increasing as |ct| moves away from warm_threshold."""
    brightnesses = [0.0, 0.1, 0.3]  # well away from midpoint on the LOW side
    cts = [0.05, 0.15, 0.40, 0.80]  # increasing distance from _WT

    for br in brightnesses:
        prev_conf: float = -1.0
        for ct in cts:
            result = classify_personal_color(_fv(ct, brightness=br))
            assert result.confidence > prev_conf, (
                f"confidence not monotone at ct={ct}, br={br}: "
                f"got {result.confidence}, prev={prev_conf}"
            )
            prev_conf = result.confidence


@pytest.mark.unit
def test_confidence_increases_as_brightness_moves_from_midpoint() -> None:
    """Confidence is monotonically increasing as brightness moves from midpoint."""
    ct = 0.30  # solidly warm
    brightnesses = [0.6, 0.7, 0.8, 0.9, 1.0]  # increasing distance from 0.5

    prev_conf: float = -1.0
    for br in brightnesses:
        result = classify_personal_color(_fv(ct, brightness=br))
        assert result.confidence >= prev_conf, (
            f"confidence not monotone at ct={ct}, br={br}: "
            f"got {result.confidence}, prev={prev_conf}"
        )
        prev_conf = result.confidence


# ---------------------------------------------------------------------------
# Section 5 — Input validation (TypeError / ValueError propagation)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_raises_type_error_for_non_feature_vector() -> None:
    """Passing a dict instead of ColorFeatureVector raises TypeError."""
    with pytest.raises(TypeError, match="ColorFeatureVector"):
        classify_personal_color(  # type: ignore[arg-type]
            {"color_temperature": 0.15, "brightness": 0.7, "saturation": 0.3}
        )


@pytest.mark.unit
def test_raises_type_error_for_non_thresholds() -> None:
    """Passing a dict instead of FeatureVectorThresholds raises TypeError."""
    features = _fv(0.15, brightness=0.7)
    with pytest.raises(TypeError, match="FeatureVectorThresholds"):
        classify_personal_color(features, thresholds={"warm_threshold": 0.02})  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Section 6 — Threshold overrides
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_custom_warm_threshold_widens_neutral_zone() -> None:
    """With warm_threshold=0.20, ct=0.15 is in the neutral zone → ValueError."""
    custom = FeatureVectorThresholds(warm_threshold=0.20, brightness_midpoint=0.5)
    with pytest.raises(ValueError):
        classify_personal_color(_fv(0.15, brightness=0.7), thresholds=custom)


@pytest.mark.unit
def test_custom_warm_threshold_shifts_confidence_scale() -> None:
    """Custom warm_threshold changes how tone_conf is computed.

    With warm_threshold=0.10, ct=0.60 gives tone_conf = (0.60-0.10)/(1-0.10) ≈ 0.556.
    With default threshold=0.02, ct=0.60 gives tone_conf = (0.60-0.02)/(1-0.02) ≈ 0.592.
    The custom threshold should produce a lower tone_conf → lower or equal confidence.
    """
    ct = 0.60
    br = 0.0  # brightness extreme → bright_conf=1, so overall = sqrt(tone_conf)

    custom = FeatureVectorThresholds(warm_threshold=0.10, brightness_midpoint=0.5)
    default_result = classify_personal_color(_fv(ct, brightness=br))
    custom_result = classify_personal_color(_fv(ct, brightness=br), thresholds=custom)

    # wider neutral zone → lower tone_conf → lower confidence
    assert custom_result.confidence < default_result.confidence


@pytest.mark.unit
def test_custom_brightness_midpoint_shifts_confidence_scale() -> None:
    """With brightness_midpoint=0.7, brightness=0.6 has lower bright_conf.

    bright_conf(midpoint=0.7) = |0.6 - 0.7| / max(0.7, 0.3) = 0.1/0.7 ≈ 0.143
    bright_conf(midpoint=0.5) = |0.6 - 0.5| / max(0.5, 0.5) = 0.1/0.5 = 0.200
    → midpoint=0.7 produces lower confidence.
    """
    ct = 0.50  # strongly warm, tone_conf is high
    br = 0.60

    default_result = classify_personal_color(_fv(ct, brightness=br))
    custom = FeatureVectorThresholds(warm_threshold=0.02, brightness_midpoint=0.7)
    custom_result = classify_personal_color(_fv(ct, brightness=br), thresholds=custom)

    # midpoint shifted to 0.7, br=0.6 is now closer to midpoint → lower bright_conf
    assert custom_result.confidence < default_result.confidence


# ---------------------------------------------------------------------------
# Section 7 — saturation does not affect confidence or category
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "saturation",
    [0.0, 0.01, 0.30, 0.99, 1.0],
    ids=["s0", "s01", "s30", "s99", "s100"],
)
def test_saturation_does_not_change_category(saturation: float) -> None:
    """Any saturation value with the same temperature and brightness gives the
    same category — saturation is informational in this classifier."""
    ct, br = 0.15, 0.70
    result = classify_personal_color(_fv(ct, br, saturation=saturation))
    assert result.category == "spring"


@pytest.mark.unit
@pytest.mark.parametrize(
    "saturation",
    [0.0, 0.01, 0.30, 0.99, 1.0],
    ids=["s0", "s01", "s30", "s99", "s100"],
)
def test_saturation_does_not_change_confidence(saturation: float) -> None:
    """saturation is not used in confidence computation — same confidence regardless."""
    ct, br = 0.15, 0.70
    reference = classify_personal_color(_fv(ct, br, saturation=0.3))
    variant = classify_personal_color(_fv(ct, br, saturation=saturation))
    assert variant.confidence == pytest.approx(reference.confidence, abs=1e-12)


# ---------------------------------------------------------------------------
# Section 8 — Confidence formula: exact numerical verification
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_confidence_formula_exact_spring() -> None:
    """Exact numerical check for a known warm+high feature vector (봄).

    ct=0.20, br=0.80, default thresholds:
      tone_conf = (0.20 - 0.02) / (1.0 - 0.02) = 0.18 / 0.98
      bright_conf = (0.80 - 0.50) / max(0.50, 0.50) = 0.30 / 0.50
      confidence = sqrt(tone_conf * bright_conf)
    """
    ct = 0.20
    br = 0.80
    tone_conf = (ct - _WT) / (1.0 - _WT)
    bright_conf = (br - _MID) / max(_MID, 1.0 - _MID)
    expected = math.sqrt(tone_conf * bright_conf)

    result = classify_personal_color(_fv(ct, br))
    assert result.category == "spring"
    assert result.confidence == pytest.approx(expected, rel=1e-9)


@pytest.mark.unit
def test_confidence_formula_exact_summer() -> None:
    """Exact numerical check for a known cool+low feature vector (여름).

    ct=-0.30, br=0.20, default thresholds:
      tone_conf = (0.30 - 0.02) / 0.98
      bright_conf = (0.50 - 0.20) / 0.50
      confidence = sqrt(tone_conf * bright_conf)
    """
    ct = -0.30
    br = 0.20
    tone_conf = (abs(ct) - _WT) / (1.0 - _WT)
    bright_conf = (_MID - br) / max(_MID, 1.0 - _MID)
    expected = math.sqrt(tone_conf * bright_conf)

    result = classify_personal_color(_fv(ct, br))
    assert result.category == "summer"
    assert result.confidence == pytest.approx(expected, rel=1e-9)


@pytest.mark.unit
def test_confidence_formula_exact_winter() -> None:
    """Exact numerical check for a known cool+high feature vector (겨울).

    ct=-0.60, br=0.90:
      tone_conf = (0.60 - 0.02) / 0.98
      bright_conf = (0.90 - 0.50) / 0.50
      confidence = sqrt(tone_conf * bright_conf)
    """
    ct = -0.60
    br = 0.90
    tone_conf = (abs(ct) - _WT) / (1.0 - _WT)
    bright_conf = (br - _MID) / max(_MID, 1.0 - _MID)
    expected = math.sqrt(tone_conf * bright_conf)

    result = classify_personal_color(_fv(ct, br))
    assert result.category == "winter"
    assert result.confidence == pytest.approx(expected, rel=1e-9)


@pytest.mark.unit
def test_confidence_formula_exact_autumn() -> None:
    """Exact numerical check for a known warm+low feature vector (가을).

    ct=0.40, br=0.10:
      tone_conf = (0.40 - 0.02) / 0.98
      bright_conf = (0.50 - 0.10) / 0.50
      confidence = sqrt(tone_conf * bright_conf)
    """
    ct = 0.40
    br = 0.10
    tone_conf = (abs(ct) - _WT) / (1.0 - _WT)
    bright_conf = (_MID - br) / max(_MID, 1.0 - _MID)
    expected = math.sqrt(tone_conf * bright_conf)

    result = classify_personal_color(_fv(ct, br))
    assert result.category == "autumn"
    assert result.confidence == pytest.approx(expected, rel=1e-9)


# ---------------------------------------------------------------------------
# Section 9 — Integration: compute_color_features round-trip
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_round_trip_warm_bright_pixels_spring_high_confidence() -> None:
    """Warm-biased, high-brightness pixels round-trip to 봄 with positive confidence.

    Simulates the production path: skin pixels → compute_color_features →
    classify_personal_color.  Reddish-peach pixels (R >> B, high luma) are the
    prototypical Spring (봄웜) skin signature.
    """
    # (220, 185, 155): ct = (220-155)/255 ≈ 0.255, brightness (Rec601) ≈ 0.80
    warm_bright = tuple((220, 185, 155) for _ in range(10))
    features = compute_color_features(warm_bright)

    result = classify_personal_color(features)
    assert result.category == "spring"
    assert result.confidence > 0.0


@pytest.mark.unit
def test_round_trip_cool_dark_pixels_summer_high_confidence() -> None:
    """Cool-biased, low-brightness pixels round-trip to 여름 with positive confidence.

    (110, 105, 130): ct = (110-130)/255 ≈ -0.078, brightness ≈ 0.429 (< 0.5).
    """
    cool_dark = tuple((110, 105, 130) for _ in range(10))
    features = compute_color_features(cool_dark)

    result = classify_personal_color(features)
    assert result.category == "summer"
    assert result.confidence > 0.0


@pytest.mark.unit
def test_round_trip_warm_dark_pixels_autumn_high_confidence() -> None:
    """Warm-biased, low-brightness pixels round-trip to 가을 with positive confidence.

    (140, 100, 80): ct = (140-80)/255 ≈ 0.235, brightness ≈ 0.430 (< 0.5).
    """
    warm_dark = tuple((140, 100, 80) for _ in range(10))
    features = compute_color_features(warm_dark)

    result = classify_personal_color(features)
    assert result.category == "autumn"
    assert result.confidence > 0.0


@pytest.mark.unit
def test_round_trip_cool_bright_pixels_winter_high_confidence() -> None:
    """Cool-biased, high-brightness pixels round-trip to 겨울 with positive confidence.

    (195, 205, 230): ct = (195-230)/255 ≈ -0.137, brightness ≈ 0.80 (> 0.5).
    """
    cool_bright = tuple((195, 205, 230) for _ in range(10))
    features = compute_color_features(cool_bright)

    result = classify_personal_color(features)
    assert result.category == "winter"
    assert result.confidence > 0.0
