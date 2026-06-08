"""Unit tests for sample_skin_pixels (Sub-AC 17-1b).

Validates two core invariants:
    1. face_region 내부 픽셀만 반환 — only pixels inside face_region are returned.
    2. 최소 샘플 수 보장 검증 — minimum sample count guarantee is honoured.

All tests are pure unit tests — no Pillow, no MediaPipe, no filesystem access.
Pixel arrays are constructed inline using the ``_solid`` / ``_stamp`` helpers
following the convention established by ``test_skin_extractor.py``.

Pixel fixtures (pre-computed via BT.601 YCbCr):
    봄웜 (220, 185, 150):  Cb ≈ 104.6  Cr ≈ 148.3  → skin ✓
    가을웜 (200, 160, 130): Cb ≈ 106.3  Cr ≈ 150.4  → skin ✓
    여름쿨 (190, 170, 170): Cb ≈ 124.6  Cr ≈ 138.0  → skin ✓
    겨울쿨 (195, 180, 175): Cb ≈ 123.0  Cr ≈ 135.9  → skin ✓
    blue sky (50, 100, 200): Cb ≈ 186.4  Cr ≈ 94.9   → NOT skin ✓
    dark bg  (20, 20, 20):   Cb = 128    Cr = 128     → NOT skin ✓
    white    (255, 255, 255): Cb = 128   Cr = 128     → NOT skin ✓

Test taxonomy
-------------
Section 1 — face_region boundary: only pixels inside face_region are returned
Section 2 — minimum sample count guarantee: fallback and satisfied paths
Section 3 — output type invariants: list of (r, g, b) int-tuples
Section 4 — input validation: TypeError and ValueError boundaries
"""

from __future__ import annotations

import pytest

from personal_color.face_detector import FaceBoundingBox
from personal_color.skin_sampler import MIN_SKIN_SAMPLE_COUNT, sample_skin_pixels

# ---------------------------------------------------------------------------
# Known pixel fixtures
# ---------------------------------------------------------------------------

_SPRING_WARM: tuple[int, int, int] = (220, 185, 150)  # 봄웜 — skin ✓
_AUTUMN_WARM: tuple[int, int, int] = (200, 160, 130)  # 가을웜 — skin ✓
_SUMMER_COOL: tuple[int, int, int] = (190, 170, 170)  # 여름쿨 — skin ✓
_WINTER_COOL: tuple[int, int, int] = (195, 180, 175)  # 겨울쿨 — skin ✓

_BLUE_SKY: tuple[int, int, int] = (50, 100, 200)  # NOT skin
_DARK_BG: tuple[int, int, int] = (20, 20, 20)  # NOT skin
_WHITE: tuple[int, int, int] = (255, 255, 255)  # NOT skin


# ---------------------------------------------------------------------------
# Image helpers — same convention as test_skin_extractor.py
# ---------------------------------------------------------------------------


def _solid(
    width: int,
    height: int,
    rgb: tuple[int, int, int],
) -> list[list[tuple[int, int, int]]]:
    """Build a width×height image filled with a single RGB colour."""
    return [[rgb for _ in range(width)] for _ in range(height)]


def _stamp(
    image: list[list[tuple[int, int, int]]],
    *,
    x: int,
    y: int,
    width: int,
    height: int,
    rgb: tuple[int, int, int],
) -> None:
    """Overwrite a rectangular region of *image* in-place with *rgb*."""
    for row in range(y, y + height):
        for col in range(x, x + width):
            image[row][col] = rgb


# ===========================================================================
# Section 1 — face_region 내부 픽셀만 반환
#             (only pixels inside face_region are returned)
# ===========================================================================


@pytest.mark.unit
def test_sample_skin_pixels_only_pixels_inside_face_region_returned() -> None:
    """Pixels outside face_region must never appear in the result.

    Image layout (8×6):
        Background: blue_sky (NOT skin)
        face_region: 4×3 block at (2, 1) filled with spring_warm (skin ✓)

    Expected: only spring_warm pixels returned; blue_sky absent.
    """
    image = _solid(width=8, height=6, rgb=_BLUE_SKY)
    _stamp(image, x=2, y=1, width=4, height=3, rgb=_SPRING_WARM)

    face_region = FaceBoundingBox(x=2, y=1, width=4, height=3)
    result = sample_skin_pixels(image, face_region)

    assert all(
        p == _SPRING_WARM for p in result
    ), f"Expected all pixels to be {_SPRING_WARM}, got {result!r}"
    assert (
        _BLUE_SKY not in result
    ), f"Background pixel {_BLUE_SKY} must not appear in result"


@pytest.mark.unit
def test_sample_skin_pixels_non_skin_outside_region_is_excluded() -> None:
    """Non-skin pixels outside face_region are excluded; skin inside is included.

    Image layout (10×10):
        Full image: dark background (NOT skin)
        face_region top-left 2×2: spring_warm (skin ✓)
        face_region top-right 2×2: blue_sky (NOT skin)

    face_region = 4×4 at origin.  With min_samples=2, skin pixels (4) >= 2
    → skin-only path.  dark_bg from outside the region must be absent.
    """
    image = _solid(width=10, height=10, rgb=_DARK_BG)
    # 2×2 skin patch inside face_region
    _stamp(image, x=0, y=0, width=2, height=2, rgb=_SPRING_WARM)
    # 2×2 non-skin patch inside face_region
    _stamp(image, x=2, y=0, width=2, height=2, rgb=_BLUE_SKY)
    # rows 2-3 inside face_region → dark_bg (already filled)

    face_region = FaceBoundingBox(x=0, y=0, width=4, height=4)
    result = sample_skin_pixels(image, face_region, min_samples=2)

    # skin pixels inside region = 4 >= min_samples 2 → skin-only path.
    assert all(p == _SPRING_WARM for p in result), (
        f"Result must contain only skin pixels from inside face_region, "
        f"got {result!r}"
    )
    assert (
        _DARK_BG not in result
    ), f"Pixel from outside face_region ({_DARK_BG}) must not appear in result"


@pytest.mark.unit
def test_sample_skin_pixels_face_region_at_image_bottom_right_edge() -> None:
    """face_region flush against the bottom-right edge includes only boundary pixels.

    Image (5×5): full white (NOT skin); bottom-right 3×2 stamped spring_warm.
    face_region = bottom-right 3×2.
    """
    image = _solid(width=5, height=5, rgb=_WHITE)
    _stamp(image, x=2, y=3, width=3, height=2, rgb=_SPRING_WARM)

    face_region = FaceBoundingBox(x=2, y=3, width=3, height=2)
    result = sample_skin_pixels(image, face_region)

    assert all(
        p == _SPRING_WARM for p in result
    ), f"Expected only spring_warm from bottom-right corner, got {result!r}"
    assert (
        _WHITE not in result
    ), "White pixel outside face_region must not appear in result"


@pytest.mark.unit
def test_sample_skin_pixels_face_region_at_image_top_left_origin() -> None:
    """face_region anchored at origin (0, 0) returns only that region's pixels.

    Image (6×6): full blue_sky (NOT skin) except 2×2 at origin = summer_cool.
    face_region = 2×2 at (0, 0).
    """
    image = _solid(width=6, height=6, rgb=_BLUE_SKY)
    _stamp(image, x=0, y=0, width=2, height=2, rgb=_SUMMER_COOL)

    face_region = FaceBoundingBox(x=0, y=0, width=2, height=2)
    result = sample_skin_pixels(image, face_region)

    assert all(
        p == _SUMMER_COOL for p in result
    ), f"Expected only summer_cool pixels at origin, got {result!r}"
    assert _BLUE_SKY not in result


@pytest.mark.unit
def test_sample_skin_pixels_all_four_korean_skin_tones_within_region() -> None:
    """All four Korean skin tone fixtures are detected when inside face_region.

    Image (2×2), face_region = entire image:
        (0,0)=봄웜, (1,0)=가을웜
        (0,1)=여름쿨, (1,1)=겨울쿨
    All four are skin ✓ → result contains all four.
    """
    image = [
        [_SPRING_WARM, _AUTUMN_WARM],
        [_SUMMER_COOL, _WINTER_COOL],
    ]
    face_region = FaceBoundingBox(x=0, y=0, width=2, height=2)
    result = sample_skin_pixels(image, face_region, min_samples=4)

    assert len(result) == 4, f"Expected 4 skin pixels, got {len(result)}"
    assert set(result) == {_SPRING_WARM, _AUTUMN_WARM, _SUMMER_COOL, _WINTER_COOL}


# ===========================================================================
# Section 2 — 최소 샘플 수 보장 검증
#             (minimum sample count guarantee verification)
# ===========================================================================


@pytest.mark.unit
def test_sample_skin_pixels_sufficient_skin_pixels_meet_minimum() -> None:
    """When enough skin pixels are found, result count >= min_samples.

    face_region = 4×4 = 16 spring_warm pixels.  min_samples = 10.
    skin count (16) >= 10 → skin-only path; len(result) == 16 >= 10.
    """
    image = _solid(width=4, height=4, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=4, height=4)
    result = sample_skin_pixels(image, face_region, min_samples=10)

    assert (
        len(result) >= 10
    ), f"Expected >= 10 samples (min_samples=10), got {len(result)}"


@pytest.mark.unit
def test_sample_skin_pixels_no_skin_triggers_fallback_to_all_region_pixels() -> None:
    """When no skin pixels exist in region, fallback returns all region pixels.

    face_region = 2×3 = 6 blue_sky pixels (NOT skin).  min_samples = 1.
    skin count (0) < 1 → fallback → all 6 region pixels returned.
    """
    image = _solid(width=6, height=6, rgb=_BLUE_SKY)
    face_region = FaceBoundingBox(x=2, y=2, width=2, height=3)
    result = sample_skin_pixels(image, face_region, min_samples=1)

    region_area = face_region.width * face_region.height  # 6
    assert (
        len(result) == region_area
    ), f"Fallback must return all {region_area} region pixels, got {len(result)}"
    assert all(
        p == _BLUE_SKY for p in result
    ), f"All fallback pixels must be blue_sky, got {result!r}"


@pytest.mark.unit
def test_sample_skin_pixels_partial_skin_below_minimum_triggers_fallback() -> None:
    """When skin pixels exist but count < min_samples, fallback returns all region pixels.

    face_region = 4×4 = 16 pixels.  Only 1 is skin (spring_warm at (0,0)).
    min_samples = 5.  skin count (1) < 5 → fallback → all 16 pixels.
    """
    image = _solid(width=4, height=4, rgb=_BLUE_SKY)
    _stamp(image, x=0, y=0, width=1, height=1, rgb=_SPRING_WARM)

    face_region = FaceBoundingBox(x=0, y=0, width=4, height=4)
    result = sample_skin_pixels(image, face_region, min_samples=5)

    region_area = face_region.width * face_region.height  # 16
    assert (
        len(result) == region_area
    ), f"Fallback must return all {region_area} region pixels, got {len(result)}"


@pytest.mark.unit
def test_sample_skin_pixels_skin_exactly_at_minimum_satisfies_guarantee() -> None:
    """When skin pixel count equals min_samples exactly, skin-only path is taken.

    face_region = 1×5 = 5 spring_warm pixels.  min_samples = 5.
    skin count (5) == 5 >= 5 → skin-only; result has exactly 5 pixels.
    """
    image = _solid(width=5, height=1, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=5, height=1)
    result = sample_skin_pixels(image, face_region, min_samples=5)

    assert (
        len(result) == 5
    ), f"Expected exactly 5 skin pixels (count == min_samples), got {len(result)}"
    assert all(p == _SPRING_WARM for p in result)


@pytest.mark.unit
def test_sample_skin_pixels_zero_min_samples_returns_empty_when_no_skin() -> None:
    """With min_samples=0, skin path taken; empty list returned for no-skin image."""
    image = _solid(width=3, height=3, rgb=_WHITE)  # NOT skin
    face_region = FaceBoundingBox(x=0, y=0, width=3, height=3)
    result = sample_skin_pixels(image, face_region, min_samples=0)

    # 0 skin pixels >= min_samples 0 → skin-only path → empty list.
    assert (
        result == []
    ), f"Expected empty list for no-skin image with min_samples=0, got {result!r}"


@pytest.mark.unit
def test_sample_skin_pixels_default_min_samples_matches_constant() -> None:
    """Calling without min_samples uses MIN_SKIN_SAMPLE_COUNT as default.

    face_region = 4×4 = 16 skin pixels.  DEFAULT min_samples = 10.
    16 >= 10 → result >= MIN_SKIN_SAMPLE_COUNT.
    """
    image = _solid(width=4, height=4, rgb=_AUTUMN_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=4, height=4)
    result = sample_skin_pixels(image, face_region)

    assert len(result) >= MIN_SKIN_SAMPLE_COUNT, (
        f"Expected >= {MIN_SKIN_SAMPLE_COUNT} samples with default min, "
        f"got {len(result)}"
    )


@pytest.mark.unit
def test_sample_skin_pixels_mixed_region_skin_enough_returns_skin_only() -> None:
    """Mixed region: top half skin, bottom half non-skin; skin >= min → skin-only.

    face_region = 4×4 = 16 pixels.
    Top 2 rows (8 pixels): spring_warm (skin ✓).
    Bottom 2 rows (8 pixels): dark_bg (NOT skin).
    min_samples = 5.  skin count (8) >= 5 → skin-only path.
    """
    image = _solid(width=4, height=4, rgb=_DARK_BG)
    _stamp(image, x=0, y=0, width=4, height=2, rgb=_SPRING_WARM)

    face_region = FaceBoundingBox(x=0, y=0, width=4, height=4)
    result = sample_skin_pixels(image, face_region, min_samples=5)

    assert len(result) >= 5, f"Expected >= 5 skin samples, got {len(result)}"
    assert all(
        p == _SPRING_WARM for p in result
    ), f"Result must contain only skin pixels, got {result!r}"


@pytest.mark.unit
def test_sample_skin_pixels_large_region_guarantees_minimum() -> None:
    """Large face_region with all skin pixels guarantees minimum is always met.

    A realistic selfie face region: 20×20 = 400 skin pixels.
    min_samples = 10.  400 >= 10 → well above minimum.
    """
    image = _solid(width=20, height=20, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=20, height=20)
    result = sample_skin_pixels(image, face_region, min_samples=10)

    assert (
        len(result) >= 10
    ), f"Large all-skin region must return >= 10 samples, got {len(result)}"


# ===========================================================================
# Section 3 — Output type invariants
# ===========================================================================


@pytest.mark.unit
def test_sample_skin_pixels_returns_list() -> None:
    """Return type must be a ``list``, not a tuple or generator."""
    image = _solid(width=2, height=2, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=2, height=2)
    result = sample_skin_pixels(image, face_region)

    assert isinstance(result, list), f"Expected list, got {type(result).__name__}"


@pytest.mark.unit
def test_sample_skin_pixels_elements_are_rgb_tuples() -> None:
    """Every element in the result must be a ``(r, g, b)`` int-tuple."""
    image = _solid(width=2, height=2, rgb=_AUTUMN_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=2, height=2)
    result = sample_skin_pixels(image, face_region)

    for idx, pixel in enumerate(result):
        assert (
            isinstance(pixel, tuple) and len(pixel) == 3
        ), f"result[{idx}] must be a 3-tuple, got {pixel!r}"
        for ch in pixel:
            assert (
                isinstance(ch, int) and 0 <= ch <= 255
            ), f"Channel must be int in 0-255, got {ch!r}"


@pytest.mark.unit
def test_sample_skin_pixels_result_is_mutable() -> None:
    """The returned list must be mutable (callers may append / slice)."""
    image = _solid(width=2, height=2, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=2, height=2)
    result = sample_skin_pixels(image, face_region)

    # Mutation must not raise.
    original_len = len(result)
    result.append(_SPRING_WARM)
    assert len(result) == original_len + 1


@pytest.mark.unit
def test_sample_skin_pixels_row_major_order_preserved_in_skin_path() -> None:
    """Skin pixels are returned in row-major (top-to-bottom, left-to-right) order.

    face_region = 3×1 row: [autumn_warm, blue_sky, spring_warm].
    Skin pixels in order: autumn_warm, spring_warm.
    """
    image = [[_AUTUMN_WARM, _BLUE_SKY, _SPRING_WARM, _WHITE, _DARK_BG]]
    face_region = FaceBoundingBox(x=0, y=0, width=3, height=1)
    result = sample_skin_pixels(image, face_region, min_samples=1)

    # autumn_warm and spring_warm are skin ✓; blue_sky is NOT skin.
    assert result == [
        _AUTUMN_WARM,
        _SPRING_WARM,
    ], f"Expected row-major order [autumn_warm, spring_warm], got {result!r}"


# ===========================================================================
# Section 4 — Input validation
# ===========================================================================


@pytest.mark.unit
def test_sample_skin_pixels_empty_image_raises_value_error() -> None:
    """Empty image list must raise ValueError."""
    face_region = FaceBoundingBox(x=0, y=0, width=1, height=1)
    with pytest.raises(ValueError, match="at least 1 row"):
        sample_skin_pixels([], face_region)


@pytest.mark.unit
def test_sample_skin_pixels_string_image_raises_type_error() -> None:
    """Non-sequence image must raise TypeError."""
    face_region = FaceBoundingBox(x=0, y=0, width=1, height=1)
    with pytest.raises(TypeError):
        sample_skin_pixels("not an image", face_region)  # type: ignore[arg-type]


@pytest.mark.unit
def test_sample_skin_pixels_face_region_extends_beyond_image_width_raises() -> None:
    """face_region that extends beyond image width must raise ValueError."""
    image = _solid(width=4, height=4, rgb=_SPRING_WARM)
    # x=2, width=5 → 2+5=7 > 4
    face_region = FaceBoundingBox(x=2, y=0, width=5, height=2)
    with pytest.raises(ValueError, match="image_width"):
        sample_skin_pixels(image, face_region)


@pytest.mark.unit
def test_sample_skin_pixels_face_region_extends_beyond_image_height_raises() -> None:
    """face_region that extends beyond image height must raise ValueError."""
    image = _solid(width=4, height=4, rgb=_SPRING_WARM)
    # y=3, height=3 → 3+3=6 > 4
    face_region = FaceBoundingBox(x=0, y=3, width=2, height=3)
    with pytest.raises(ValueError, match="image_height"):
        sample_skin_pixels(image, face_region)


@pytest.mark.unit
def test_sample_skin_pixels_wrong_face_region_type_raises_type_error() -> None:
    """Passing a non-FaceBoundingBox face_region must raise TypeError."""
    image = _solid(width=4, height=4, rgb=_SPRING_WARM)
    with pytest.raises(TypeError, match="FaceBoundingBox"):
        sample_skin_pixels(image, (0, 0, 4, 4))  # type: ignore[arg-type]


@pytest.mark.unit
def test_sample_skin_pixels_negative_min_samples_raises_value_error() -> None:
    """Negative min_samples must raise ValueError."""
    image = _solid(width=3, height=3, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=3, height=3)
    with pytest.raises(ValueError, match="min_samples"):
        sample_skin_pixels(image, face_region, min_samples=-1)


@pytest.mark.unit
def test_sample_skin_pixels_negative_face_region_origin_raises_value_error() -> None:
    """face_region with negative x must raise ValueError."""
    image = _solid(width=4, height=4, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=-1, y=0, width=3, height=3)
    with pytest.raises(ValueError, match="non-negative"):
        sample_skin_pixels(image, face_region)


@pytest.mark.unit
def test_sample_skin_pixels_zero_face_region_width_raises_value_error() -> None:
    """face_region with width=0 must raise ValueError."""
    image = _solid(width=4, height=4, rgb=_SPRING_WARM)
    face_region = FaceBoundingBox(x=0, y=0, width=0, height=3)
    with pytest.raises(ValueError, match="width/height"):
        sample_skin_pixels(image, face_region)
