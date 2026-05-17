"""Unit tests for high/low contrast classification.

Sub-AC 10.2: 밝기(value/lightness) 값을 입력받아 high/low contrast를 판별하는
함수. 임계값 경계 케이스 포함.

Korean personal color (퍼스널 컬러) second axis = contrast tier:
  - High contrast (고대비): clear/vivid families — 봄(Spring) and 겨울(Winter)
  - Low  contrast (저대비): muted/soft families  — 여름(Summer) and 가을(Autumn)

Branch coverage targets:
  - single-lightness HIGH branch
  - single-lightness LOW branch
  - single-lightness exact-midpoint boundary branch
  - pair-delta HIGH branch
  - pair-delta LOW branch
  - pair-delta exact-threshold boundary branch
  - custom thresholds branch
  - input validation branch (range + type, including bool)
"""

from __future__ import annotations

import pytest

from personal_color.contrast_classifier import (
    Contrast,
    ContrastThresholds,
    classify_contrast_from_delta,
    classify_contrast_from_lightness,
)


# ---------------------------------------------------------------------------
# Single-lightness — HIGH branch (high-key, above midpoint)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "lightness",
    [
        0.51,   # just above default midpoint (0.5)
        0.6,
        0.75,
        0.9,
        1.0,    # max — pure white
    ],
)
def test_classify_contrast_from_lightness_high(lightness: float) -> None:
    assert classify_contrast_from_lightness(lightness) is Contrast.HIGH


# ---------------------------------------------------------------------------
# Single-lightness — LOW branch (low-key, at-or-below midpoint)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "lightness",
    [
        0.0,    # min — pure black
        0.1,
        0.25,
        0.4,
        0.49,   # just below default midpoint
    ],
)
def test_classify_contrast_from_lightness_low(lightness: float) -> None:
    assert classify_contrast_from_lightness(lightness) is Contrast.LOW


# ---------------------------------------------------------------------------
# Single-lightness — boundary case (exact midpoint)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_contrast_from_lightness_boundary_is_low() -> None:
    """Exactly at the midpoint maps to LOW.

    Predicate is strict `>` so HIGH requires a clearly above-midpoint signal.
    Documenting the choice here pins behaviour against accidental regressions
    (e.g., a future refactor switching to `>=`).
    """
    assert classify_contrast_from_lightness(0.5) is Contrast.LOW


@pytest.mark.unit
def test_classify_contrast_from_lightness_just_above_boundary_is_high() -> None:
    # The smallest representable bump above 0.5 should flip the verdict.
    assert classify_contrast_from_lightness(0.500001) is Contrast.HIGH


# ---------------------------------------------------------------------------
# Single-lightness — custom threshold branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_contrast_from_lightness_respects_custom_threshold() -> None:
    th = ContrastThresholds(lightness_midpoint=0.7)
    # 0.65 was HIGH under default 0.5, now LOW under 0.7
    assert classify_contrast_from_lightness(0.65, thresholds=th) is Contrast.LOW
    # 0.71 above custom midpoint
    assert classify_contrast_from_lightness(0.71, thresholds=th) is Contrast.HIGH


# ---------------------------------------------------------------------------
# Single-lightness — input validation branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("lightness", [-0.01, 1.01, -1.0, 2.0])
def test_classify_contrast_from_lightness_rejects_out_of_range(
    lightness: float,
) -> None:
    with pytest.raises(ValueError):
        classify_contrast_from_lightness(lightness)


@pytest.mark.unit
def test_classify_contrast_from_lightness_rejects_non_numeric() -> None:
    with pytest.raises(TypeError):
        classify_contrast_from_lightness("0.5")  # type: ignore[arg-type]


@pytest.mark.unit
def test_classify_contrast_from_lightness_rejects_bool() -> None:
    # Bool is a subclass of int — must be rejected explicitly so True/False
    # don't silently classify as HIGH/LOW.
    with pytest.raises(TypeError):
        classify_contrast_from_lightness(True)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        classify_contrast_from_lightness(False)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Pair-delta — HIGH branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "pair",
    [
        (1.0, 0.0),   # max delta — pure white skin vs pure black hair
        (0.9, 0.2),   # delta 0.7 — clearly high contrast
        (0.85, 0.4),  # delta 0.45 — just above default 0.4 threshold
        (0.95, 0.1),  # delta 0.85 — winter-type signature
    ],
)
def test_classify_contrast_from_delta_high(
    pair: tuple[float, float],
) -> None:
    assert classify_contrast_from_delta(*pair) is Contrast.HIGH


# ---------------------------------------------------------------------------
# Pair-delta — LOW branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "pair",
    [
        (0.5, 0.5),   # zero delta — identical samples
        (0.6, 0.4),   # delta 0.2 — clearly low contrast
        (0.7, 0.4),   # delta 0.3 — soft summer-type
        (0.4, 0.1),   # delta 0.3 — dark-on-dark muted autumn
        (0.3, 0.15),  # delta 0.15 — deep skin, deep features
    ],
)
def test_classify_contrast_from_delta_low(
    pair: tuple[float, float],
) -> None:
    assert classify_contrast_from_delta(*pair) is Contrast.LOW


# ---------------------------------------------------------------------------
# Pair-delta — boundary case (exact threshold)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_contrast_from_delta_boundary_is_low() -> None:
    """Exact threshold delta (0.4) maps to LOW.

    Predicate is strict `>` so HIGH requires a delta clearly above the
    threshold. Pinning this prevents a `>=` refactor from silently flipping
    borderline cases.
    """
    # 0.8 - 0.4 = 0.4 exactly
    assert classify_contrast_from_delta(0.8, 0.4) is Contrast.LOW


@pytest.mark.unit
def test_classify_contrast_from_delta_just_above_boundary_is_high() -> None:
    # 0.81 - 0.4 = 0.41 > 0.4
    assert classify_contrast_from_delta(0.81, 0.4) is Contrast.HIGH


# ---------------------------------------------------------------------------
# Pair-delta — order-independence (uses absolute value)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_contrast_from_delta_uses_absolute_value() -> None:
    # Swapped order produces same verdict.
    forward = classify_contrast_from_delta(0.9, 0.2)
    swapped = classify_contrast_from_delta(0.2, 0.9)
    assert forward is swapped is Contrast.HIGH


# ---------------------------------------------------------------------------
# Pair-delta — custom threshold branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_contrast_from_delta_respects_custom_threshold() -> None:
    th = ContrastThresholds(delta_threshold=0.2)
    # delta 0.15 — LOW under tighter 0.2 threshold
    assert classify_contrast_from_delta(0.5, 0.35, thresholds=th) is Contrast.LOW
    # delta 0.25 — HIGH under 0.2 (would have been LOW under default 0.4)
    assert classify_contrast_from_delta(0.5, 0.25, thresholds=th) is Contrast.HIGH


# ---------------------------------------------------------------------------
# Pair-delta — input validation branch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "pair",
    [
        (-0.01, 0.5),
        (1.01, 0.5),
        (0.5, -0.01),
        (0.5, 1.01),
        (-1.0, 2.0),
    ],
)
def test_classify_contrast_from_delta_rejects_out_of_range(
    pair: tuple[float, float],
) -> None:
    with pytest.raises(ValueError):
        classify_contrast_from_delta(*pair)


@pytest.mark.unit
def test_classify_contrast_from_delta_rejects_non_numeric() -> None:
    with pytest.raises(TypeError):
        classify_contrast_from_delta("0.5", 0.0)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        classify_contrast_from_delta(0.5, None)  # type: ignore[arg-type]


@pytest.mark.unit
def test_classify_contrast_from_delta_rejects_bool() -> None:
    with pytest.raises(TypeError):
        classify_contrast_from_delta(True, 0.0)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        classify_contrast_from_delta(0.5, False)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Cross-primitive composition smoke (anchors for the 4-category classifier
# in Sub-AC 10.3+).
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_high_key_single_lightness_is_high_contrast_tier() -> None:
    # Very light skin alone reads HIGH on the single-lightness primitive.
    assert classify_contrast_from_lightness(0.95) is Contrast.HIGH


@pytest.mark.unit
def test_dark_on_dark_pair_is_low_contrast() -> None:
    # Dark skin against dark hair = LOW contrast even though both samples
    # are low-key. Confirms the pair-based primitive is not redundant with
    # the single-lightness one.
    assert classify_contrast_from_delta(0.3, 0.15) is Contrast.LOW


@pytest.mark.unit
def test_int_inputs_accepted() -> None:
    # 0 and 1 as ints (within range) must work — keeps the API ergonomic
    # for callers using normalized integer arithmetic upstream.
    assert classify_contrast_from_lightness(0) is Contrast.LOW
    assert classify_contrast_from_lightness(1) is Contrast.HIGH
    assert classify_contrast_from_delta(1, 0) is Contrast.HIGH
