"""Unit tests for ``compute_warm_cool_score`` (Sub-AC 17-1d).

검증 요구사항:
  * 웜톤 픽셀 집합(높은 red/yellow) 입력 시 양수 반환
  * 쿨톤 픽셀 집합(높은 blue) 입력 시 음수 반환

All tests are *unit* tests — no Pillow, no MediaPipe, no filesystem access.
Input arrays are built inline using simple RGB fixtures.  The function is
pure-Python and deterministic (rule-based formula only, no model inference).

Test taxonomy
-------------
Section 1 — Core AC contract: warm→positive, cool→negative
Section 2 — Boundary values: pure primaries, achromatic
Section 3 — Multi-pixel averaging: mean is correctly computed
Section 4 — Output type / range invariants
Section 5 — Input validation: TypeError and ValueError boundaries
"""

from __future__ import annotations

import math

import pytest

from personal_color.color_features import compute_warm_cool_score

# ---------------------------------------------------------------------------
# Shared tolerance
# ---------------------------------------------------------------------------

_TOL = 1e-9


def _approx(expected: float, actual: float, *, tol: float = _TOL) -> bool:
    return math.isclose(actual, expected, abs_tol=tol, rel_tol=0)


# ===========================================================================
# Section 1 — Core AC contract: warm → positive, cool → negative
# ===========================================================================


@pytest.mark.unit
def test_warm_cool_score_high_red_is_positive() -> None:
    """웜톤: 높은 red 픽셀 집합 → 양수.

    Pure red (255, 0, 0): mean_R=255, mean_B=0 → score = 1.0 > 0.
    """
    pixels = ((255, 0, 0),)
    score = compute_warm_cool_score(pixels)
    assert score > 0, f"High-red pixels must yield positive score, got {score}"


@pytest.mark.unit
def test_warm_cool_score_high_yellow_is_positive() -> None:
    """웜톤: 높은 yellow 픽셀 집합 → 양수.

    Pure yellow (255, 255, 0): high R+G, low B.
    mean_R=255, mean_B=0 → score = 1.0 > 0.
    """
    pixels = ((255, 255, 0),)
    score = compute_warm_cool_score(pixels)
    assert score > 0, f"High-yellow pixels must yield positive score, got {score}"


@pytest.mark.unit
def test_warm_cool_score_high_blue_is_negative() -> None:
    """쿨톤: 높은 blue 픽셀 집합 → 음수.

    Pure blue (0, 0, 255): mean_R=0, mean_B=255 → score = -1.0 < 0.
    """
    pixels = ((0, 0, 255),)
    score = compute_warm_cool_score(pixels)
    assert score < 0, f"High-blue pixels must yield negative score, got {score}"


@pytest.mark.unit
def test_warm_cool_score_spring_warm_is_positive() -> None:
    """봄웜 대표 피부색 (220, 185, 150): R > B → 양수."""
    pixels = ((220, 185, 150),)  # Spring Warm
    score = compute_warm_cool_score(pixels)
    assert score > 0, f"봄웜 (spring warm) pixels must yield positive score, got {score}"


@pytest.mark.unit
def test_warm_cool_score_autumn_warm_is_positive() -> None:
    """가을웜 대표 피부색 (200, 160, 130): R > B → 양수."""
    pixels = ((200, 160, 130),)  # Autumn Warm
    score = compute_warm_cool_score(pixels)
    assert score > 0, f"가을웜 (autumn warm) pixels must yield positive score, got {score}"


@pytest.mark.unit
def test_warm_cool_score_summer_cool_is_positive_but_less_than_spring() -> None:
    """여름쿨 (190, 170, 170): R=190, B=170 → score > 0 (R still > B for this fixture).

    The key property is that summer-cool has a *lower* warm signal than spring-warm.
    여름쿨의 웜/쿨 점수는 봄웜보다 낮아야 한다.
    """
    spring_pixels = ((220, 185, 150),)
    summer_pixels = ((190, 170, 170),)

    spring_score = compute_warm_cool_score(spring_pixels)
    summer_score = compute_warm_cool_score(summer_pixels)

    assert spring_score > summer_score, (
        f"봄웜 score ({spring_score:.4f}) must exceed 여름쿨 score ({summer_score:.4f})"
    )


@pytest.mark.unit
def test_warm_cool_score_strongly_cool_blue_dominant_is_negative() -> None:
    """강한 쿨톤 픽셀 (70, 120, 200): B dominates R → 음수."""
    pixels = ((70, 120, 200),)
    score = compute_warm_cool_score(pixels)
    assert score < 0, (
        f"Blue-dominant cool pixel must yield negative score, got {score}"
    )


@pytest.mark.unit
def test_warm_cool_score_warm_multi_pixel_set_is_positive() -> None:
    """웜톤 픽셀 집합(여러 픽셀): 모두 R > B → 양수."""
    warm_pixels = (
        (220, 185, 150),  # spring warm
        (200, 160, 130),  # autumn warm
        (240, 190, 160),  # warm highlight
        (180, 140, 110),  # warm shadow
    )
    score = compute_warm_cool_score(warm_pixels)
    assert score > 0, f"Multi-pixel warm set must yield positive score, got {score}"


@pytest.mark.unit
def test_warm_cool_score_cool_multi_pixel_set_is_negative() -> None:
    """쿨톤 픽셀 집합(여러 픽셀): B > R 우세 → 음수."""
    cool_pixels = (
        (0, 0, 255),    # pure blue
        (50, 100, 200), # blue-dominant
        (80, 130, 210), # blue-dominant
        (30, 80, 180),  # blue-dominant
    )
    score = compute_warm_cool_score(cool_pixels)
    assert score < 0, f"Multi-pixel cool set must yield negative score, got {score}"


# ===========================================================================
# Section 2 — Boundary / special values
# ===========================================================================


@pytest.mark.unit
def test_warm_cool_score_pure_red_is_plus_one() -> None:
    """Pure red (255, 0, 0) → maximum warm score = +1.0."""
    pixels = ((255, 0, 0),)
    score = compute_warm_cool_score(pixels)
    assert _approx(1.0, score), f"Pure red must yield score = 1.0, got {score}"


@pytest.mark.unit
def test_warm_cool_score_pure_blue_is_minus_one() -> None:
    """Pure blue (0, 0, 255) → maximum cool score = -1.0."""
    pixels = ((0, 0, 255),)
    score = compute_warm_cool_score(pixels)
    assert _approx(-1.0, score), f"Pure blue must yield score = -1.0, got {score}"


@pytest.mark.unit
def test_warm_cool_score_neutral_grey_is_zero() -> None:
    """Neutral grey (128, 128, 128): R = B → score = 0.0."""
    pixels = ((128, 128, 128),)
    score = compute_warm_cool_score(pixels)
    assert _approx(0.0, score), f"Neutral grey must yield score = 0.0, got {score}"


@pytest.mark.unit
def test_warm_cool_score_pure_white_is_zero() -> None:
    """Pure white (255, 255, 255): R = B → score = 0.0."""
    pixels = ((255, 255, 255),)
    score = compute_warm_cool_score(pixels)
    assert _approx(0.0, score), f"Pure white must yield score = 0.0, got {score}"


@pytest.mark.unit
def test_warm_cool_score_black_is_zero() -> None:
    """Black (0, 0, 0): R = B = 0 → score = 0.0."""
    pixels = ((0, 0, 0),)
    score = compute_warm_cool_score(pixels)
    assert _approx(0.0, score), f"Black must yield score = 0.0, got {score}"


@pytest.mark.unit
def test_warm_cool_score_pure_yellow_equals_pure_red_score() -> None:
    """Pure yellow (255, 255, 0) and pure red (255, 0, 0) share same R and B values.

    Both have mean_R=255, mean_B=0 → both yield +1.0.
    """
    red_score = compute_warm_cool_score(((255, 0, 0),))
    yellow_score = compute_warm_cool_score(((255, 255, 0),))
    assert _approx(1.0, red_score)
    assert _approx(1.0, yellow_score)


# ===========================================================================
# Section 3 — Multi-pixel averaging
# ===========================================================================


@pytest.mark.unit
def test_warm_cool_score_equal_warm_cool_mix_is_zero() -> None:
    """Mixing equal warm and cool pixels cancels to near-zero score.

    (255, 0, 0) + (0, 0, 255) → mean_R = 127.5, mean_B = 127.5 → score ≈ 0.
    """
    pixels = ((255, 0, 0), (0, 0, 255))
    score = compute_warm_cool_score(pixels)
    assert _approx(0.0, score), (
        f"Equal warm+cool mix must yield score ≈ 0.0, got {score}"
    )


@pytest.mark.unit
def test_warm_cool_score_two_warm_pixels_expected_value() -> None:
    """두 웜 픽셀 평균 검증.

    Pixels: (200, 100, 50) and (100, 100, 150)
    mean_R = (200 + 100) / 2 = 150.0
    mean_B = (50 + 150) / 2  = 100.0
    score  = (150 - 100) / 255 = 50/255
    """
    pixels = ((200, 100, 50), (100, 100, 150))
    score = compute_warm_cool_score(pixels)
    expected = 50 / 255
    assert _approx(expected, score), (
        f"Two-pixel warm score: expected {expected:.6f}, got {score:.6f}"
    )


@pytest.mark.unit
def test_warm_cool_score_identical_pixels_same_as_single() -> None:
    """N identical pixels must yield the same score as a 1-pixel array."""
    pixel = (220, 185, 150)
    single = compute_warm_cool_score((pixel,))
    triple = compute_warm_cool_score((pixel, pixel, pixel))
    assert _approx(single, triple), (
        f"Identical pixels: single={single:.6f}, triple={triple:.6f}"
    )


# ===========================================================================
# Section 4 — Output type / range invariants
# ===========================================================================


@pytest.mark.unit
def test_warm_cool_score_returns_float() -> None:
    """Return value must be a Python float."""
    score = compute_warm_cool_score(((220, 185, 150),))
    assert isinstance(score, float), (
        f"compute_warm_cool_score must return float, got {type(score).__name__}"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    "pixel",
    [
        (0, 0, 0),
        (255, 255, 255),
        (128, 128, 128),
        (220, 185, 150),
        (200, 160, 130),
        (0, 0, 255),
        (255, 0, 0),
        (255, 255, 0),
    ],
    ids=["black", "white", "grey", "spring_warm", "autumn_warm", "pure_blue", "pure_red", "yellow"],
)
def test_warm_cool_score_in_valid_range(pixel: tuple[int, int, int]) -> None:
    """Score must lie within [-1.0, 1.0] for any valid pixel input."""
    score = compute_warm_cool_score((pixel,))
    assert -1.0 <= score <= 1.0, (
        f"Score {score:.6f} out of [-1.0, 1.0] for pixel {pixel}"
    )


# ===========================================================================
# Section 5 — Input validation: TypeError and ValueError boundaries
# ===========================================================================


@pytest.mark.unit
def test_warm_cool_score_empty_tuple_raises_value_error() -> None:
    """An empty pixel tuple must raise ValueError."""
    with pytest.raises(ValueError, match="empty"):
        compute_warm_cool_score(())


@pytest.mark.unit
def test_warm_cool_score_string_input_raises_type_error() -> None:
    """A string must be rejected as a non-pixel Sequence."""
    with pytest.raises(TypeError):
        compute_warm_cool_score("rgb")  # type: ignore[arg-type]


@pytest.mark.unit
def test_warm_cool_score_non_tuple_pixel_raises_type_error() -> None:
    """A pixel that is a list instead of a tuple must raise TypeError."""
    with pytest.raises(TypeError, match="3-tuple"):
        compute_warm_cool_score(([255, 0, 0],))  # type: ignore[arg-type]


@pytest.mark.unit
def test_warm_cool_score_channel_above_255_raises_value_error() -> None:
    """A channel value > 255 must raise ValueError."""
    with pytest.raises(ValueError, match="0-255"):
        compute_warm_cool_score(((256, 0, 0),))


@pytest.mark.unit
def test_warm_cool_score_negative_channel_raises_value_error() -> None:
    """A negative channel value must raise ValueError."""
    with pytest.raises(ValueError, match="0-255"):
        compute_warm_cool_score(((-1, 0, 0),))


@pytest.mark.unit
def test_warm_cool_score_float_channel_raises_type_error() -> None:
    """A float channel value must raise TypeError (int required)."""
    with pytest.raises(TypeError, match="channel"):
        compute_warm_cool_score(((255.0, 0, 0),))  # type: ignore[arg-type]


@pytest.mark.unit
def test_warm_cool_score_bool_channel_raises_type_error() -> None:
    """A boolean channel value must raise TypeError (bool subclass of int is disallowed)."""
    with pytest.raises(TypeError, match="channel"):
        compute_warm_cool_score(((True, 0, 0),))  # type: ignore[arg-type]
