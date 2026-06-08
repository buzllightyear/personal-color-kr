"""Unit tests for the rule-based skin-pixel extractor (Sub-AC 12.1.2).

얼굴 영역 크롭 이미지를 입력받아 피부 픽셀만 분리한 마스크(또는 픽셀 배열)를
반환하는 ``extract_skin_pixels`` 함수를 알려진 픽셀 구성의 픽스처로 검증.

All tests in this file are *unit* tests — no Pillow, no MediaPipe, no
filesystem access.  Pixel arrays are built inline using the same
``_solid`` / ``_stamp`` helpers that ``test_region_extractor.py``
established as the project convention for mock-image fixtures.

Test taxonomy
-------------
Section 1 — Known-pixel classification: individual skin / non-skin pixels
Section 2 — All-skin image: full mask, all pixels returned
Section 3 — All-non-skin image: empty mask, empty pixel tuple
Section 4 — Mixed image: partial mask, only skin pixels in tuple
Section 5 — Output invariants: shape, length, immutability, types
Section 6 — Input validation: TypeError and ValueError boundaries
"""

from __future__ import annotations

import pytest

from personal_color.skin_extractor import (
    SkinExtractionResult,
    extract_skin_pixels,
)

# ---------------------------------------------------------------------------
# Known pixel fixtures — verified against the BT.601 YCbCr formula.
#
# Skin pixels (77 ≤ Cb ≤ 127 AND 133 ≤ Cr ≤ 173):
#   봄웜 (220, 185, 150):  Cb ≈ 104.6  Cr ≈ 148.3  → skin ✓
#   가을웜 (200, 160, 130): Cb ≈ 106.3  Cr ≈ 150.4  → skin ✓
#   여름쿨 (190, 170, 170): Cb ≈ 124.6  Cr ≈ 138.0  → skin ✓
#   겨울쿨 (195, 180, 175): Cb ≈ 123.0  Cr ≈ 135.9  → skin ✓
#
# Non-skin pixels:
#   blue sky  (50, 100, 200): Cb ≈ 186.4  Cr ≈ 94.9   → NOT skin ✓
#   dark bg   (20, 20, 20):   Cb = 128    Cr = 128     → NOT skin ✓
#   white     (255, 255, 255):Cb = 128    Cr = 128     → NOT skin ✓
#   pure red  (255, 0, 0):    Cb ≈ 85.0   Cr ≈ 255.5  → NOT skin ✓
# ---------------------------------------------------------------------------

_SPRING_WARM: tuple[int, int, int] = (220, 185, 150)   # 봄웜 — skin ✓
_AUTUMN_WARM: tuple[int, int, int] = (200, 160, 130)   # 가을웜 — skin ✓
_SUMMER_COOL: tuple[int, int, int] = (190, 170, 170)   # 여름쿨 — skin ✓
_WINTER_COOL: tuple[int, int, int] = (195, 180, 175)   # 겨울쿨 — skin ✓

_BLUE_SKY: tuple[int, int, int] = (50, 100, 200)    # NOT skin
_DARK_BG: tuple[int, int, int] = (20, 20, 20)       # NOT skin
_WHITE: tuple[int, int, int] = (255, 255, 255)      # NOT skin
_PURE_RED: tuple[int, int, int] = (255, 0, 0)       # NOT skin


# ---------------------------------------------------------------------------
# Mock image helpers — same convention as test_region_extractor.py
# ---------------------------------------------------------------------------


def _solid(
    width: int,
    height: int,
    rgb: tuple[int, int, int],
) -> list[list[tuple[int, int, int]]]:
    """Build a width×height image filled with a single RGB color."""
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
# Section 1 — Known-pixel classification: individual skin / non-skin pixels
# ===========================================================================


@pytest.mark.unit
@pytest.mark.parametrize(
    "skin_pixel",
    [
        _SPRING_WARM,
        _AUTUMN_WARM,
        _SUMMER_COOL,
        _WINTER_COOL,
    ],
    ids=["spring_warm", "autumn_warm", "summer_cool", "winter_cool"],
)
def test_extract_skin_pixels_known_skin_pixel_is_in_result(
    skin_pixel: tuple[int, int, int],
) -> None:
    """A 1×1 image of a known Korean skin tone must yield exactly one pixel.

    The fixture pixel is pre-computed from the BT.601 YCbCr formula to
    lie within [77, 127] × [133, 173].  One True cell in the mask and one
    entry in pixels confirms end-to-end extraction.
    """
    image = [[skin_pixel]]
    result = extract_skin_pixels(image)

    assert result.mask == ((True,),), (
        f"Expected mask=((True,)) for skin pixel {skin_pixel}, "
        f"got {result.mask}"
    )
    assert result.pixels == (skin_pixel,), (
        f"Expected pixels=({skin_pixel},) for skin pixel {skin_pixel}, "
        f"got {result.pixels}"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    "non_skin_pixel",
    [
        _BLUE_SKY,
        _DARK_BG,
        _WHITE,
        _PURE_RED,
    ],
    ids=["blue_sky", "dark_bg", "white", "pure_red"],
)
def test_extract_skin_pixels_known_non_skin_pixel_is_absent(
    non_skin_pixel: tuple[int, int, int],
) -> None:
    """A 1×1 image of a known non-skin pixel must yield zero skin pixels.

    The fixture pixel is pre-computed from the BT.601 YCbCr formula to
    lie *outside* the [77, 127] × [133, 173] cluster.
    """
    image = [[non_skin_pixel]]
    result = extract_skin_pixels(image)

    assert result.mask == ((False,),), (
        f"Expected mask=((False,)) for non-skin pixel {non_skin_pixel}, "
        f"got {result.mask}"
    )
    assert result.pixels == (), (
        f"Expected pixels=() for non-skin pixel {non_skin_pixel}, "
        f"got {result.pixels}"
    )


# ===========================================================================
# Section 2 — All-skin image: full mask, all pixels returned
# ===========================================================================


@pytest.mark.unit
def test_extract_skin_pixels_all_skin_image_full_mask() -> None:
    """4×3 image filled entirely with a warm Korean skin tone.

    Every mask cell must be True and every pixel must appear in the
    pixels tuple (12 pixels total, row-major order).
    """
    image = _solid(width=4, height=3, rgb=_SPRING_WARM)
    result = extract_skin_pixels(image)

    for row_idx, row in enumerate(result.mask):
        for col_idx, cell in enumerate(row):
            assert cell is True, (
                f"Expected True at mask[{row_idx}][{col_idx}], got False"
            )
    assert len(result.pixels) == 12, (
        f"Expected 12 skin pixels (4×3 all-skin), got {len(result.pixels)}"
    )
    # All entries in pixels must equal the uniform fill color.
    assert all(p == _SPRING_WARM for p in result.pixels), (
        f"All pixels should be {_SPRING_WARM}"
    )


@pytest.mark.unit
def test_extract_skin_pixels_single_warm_pixel_mask_all_true() -> None:
    """3×2 image of autumn-warm skin — all 6 cells in mask should be True."""
    image = _solid(width=3, height=2, rgb=_AUTUMN_WARM)
    result = extract_skin_pixels(image)

    assert len(result.mask) == 2
    assert all(len(row) == 3 for row in result.mask)
    assert all(cell is True for row in result.mask for cell in row)
    assert len(result.pixels) == 6


# ===========================================================================
# Section 3 — All-non-skin image: empty mask, empty pixel tuple
# ===========================================================================


@pytest.mark.unit
def test_extract_skin_pixels_all_non_skin_image_empty_mask() -> None:
    """4×3 image filled entirely with blue sky — zero skin pixels."""
    image = _solid(width=4, height=3, rgb=_BLUE_SKY)
    result = extract_skin_pixels(image)

    for row_idx, row in enumerate(result.mask):
        for col_idx, cell in enumerate(row):
            assert cell is False, (
                f"Expected False at mask[{row_idx}][{col_idx}], got True"
            )
    assert result.pixels == (), (
        f"Expected empty pixels tuple for all-non-skin image, got {result.pixels}"
    )


@pytest.mark.unit
def test_extract_skin_pixels_dark_background_no_skin() -> None:
    """5×5 dark background image must yield zero skin pixels."""
    image = _solid(width=5, height=5, rgb=_DARK_BG)
    result = extract_skin_pixels(image)

    assert result.pixels == ()
    assert all(cell is False for row in result.mask for cell in row)


# ===========================================================================
# Section 4 — Mixed image: partial mask, only skin pixels in tuple
# ===========================================================================


@pytest.mark.unit
def test_extract_skin_pixels_mixed_image_partial_mask() -> None:
    """4×4 image: top 2 rows = skin, bottom 2 rows = non-skin.

    Mask layout (T = True / skin, F = False / non-skin):

        Row 0: [T, T, T, T]
        Row 1: [T, T, T, T]
        Row 2: [F, F, F, F]
        Row 3: [F, F, F, F]

    8 skin pixels total; pixels tuple contains only the spring-warm values.
    """
    image = _solid(width=4, height=4, rgb=_BLUE_SKY)
    # Overwrite top 2 rows with skin-tone pixels.
    _stamp(image, x=0, y=0, width=4, height=2, rgb=_SPRING_WARM)

    result = extract_skin_pixels(image)

    # Top 2 rows → True
    for col in range(4):
        assert result.mask[0][col] is True, f"mask[0][{col}] must be True (skin)"
        assert result.mask[1][col] is True, f"mask[1][{col}] must be True (skin)"
    # Bottom 2 rows → False
    for col in range(4):
        assert result.mask[2][col] is False, f"mask[2][{col}] must be False (non-skin)"
        assert result.mask[3][col] is False, f"mask[3][{col}] must be False (non-skin)"

    assert len(result.pixels) == 8, (
        f"Expected 8 skin pixels (top 4×2), got {len(result.pixels)}"
    )
    assert all(p == _SPRING_WARM for p in result.pixels)


@pytest.mark.unit
def test_extract_skin_pixels_mixed_image_central_skin_patch() -> None:
    """6×6 image with a 2×2 skin patch in the centre (rows 2-3, cols 2-3).

    All 4 cells in the 2×2 patch → True; remaining 32 cells → False.
    pixels tuple must contain exactly 4 entries.
    """
    image = _solid(width=6, height=6, rgb=_DARK_BG)
    _stamp(image, x=2, y=2, width=2, height=2, rgb=_AUTUMN_WARM)

    result = extract_skin_pixels(image)

    # The 2×2 patch at rows 2-3, cols 2-3 should be skin.
    assert result.mask[2][2] is True
    assert result.mask[2][3] is True
    assert result.mask[3][2] is True
    assert result.mask[3][3] is True

    # Spot-check a few non-skin cells.
    assert result.mask[0][0] is False
    assert result.mask[5][5] is False

    assert len(result.pixels) == 4
    assert all(p == _AUTUMN_WARM for p in result.pixels)


@pytest.mark.unit
def test_extract_skin_pixels_cool_tone_patch_in_non_skin_background() -> None:
    """Cool Korean skin tone (summer cool) is detected among white background.

    A 3×1 horizontal strip of summer-cool pixels amid white cells.
    """
    # Row 0: [summer_cool, white, white, summer_cool, summer_cool]
    image = [
        [_SUMMER_COOL, _WHITE, _WHITE, _SUMMER_COOL, _SUMMER_COOL],
    ]
    result = extract_skin_pixels(image)

    assert result.mask[0] == (True, False, False, True, True)
    assert len(result.pixels) == 3
    assert all(p == _SUMMER_COOL for p in result.pixels)


# ===========================================================================
# Section 5 — Output invariants
# ===========================================================================


@pytest.mark.unit
def test_extract_skin_pixels_mask_shape_matches_image_shape() -> None:
    """The mask dimensions must exactly match the image dimensions."""
    width, height = 7, 5
    image = _solid(width=width, height=height, rgb=_SPRING_WARM)
    result = extract_skin_pixels(image)

    assert len(result.mask) == height, (
        f"Expected {height} mask rows, got {len(result.mask)}"
    )
    for row_idx, row in enumerate(result.mask):
        assert len(row) == width, (
            f"Expected {width} columns in mask row {row_idx}, got {len(row)}"
        )


@pytest.mark.unit
def test_extract_skin_pixels_pixels_count_equals_true_in_mask() -> None:
    """``len(result.pixels)`` must equal the number of True values in mask."""
    image = _solid(width=4, height=4, rgb=_BLUE_SKY)
    _stamp(image, x=1, y=1, width=2, height=2, rgb=_WINTER_COOL)

    result = extract_skin_pixels(image)

    true_count = sum(cell for row in result.mask for cell in row)
    assert len(result.pixels) == true_count, (
        f"pixels count ({len(result.pixels)}) must match True count "
        f"in mask ({true_count})"
    )


@pytest.mark.unit
def test_extract_skin_pixels_result_is_frozen_dataclass() -> None:
    """SkinExtractionResult must be immutable (frozen dataclass)."""
    image = [[_SPRING_WARM]]
    result = extract_skin_pixels(image)

    assert isinstance(result, SkinExtractionResult)
    with pytest.raises((AttributeError, TypeError)):
        result.mask = ()  # type: ignore[misc]
    with pytest.raises((AttributeError, TypeError)):
        result.pixels = ()  # type: ignore[misc]


@pytest.mark.unit
def test_extract_skin_pixels_mask_is_tuple_of_tuples_of_bools() -> None:
    """mask must be a tuple of tuples of Python bools, not lists or ints."""
    image = _solid(width=2, height=2, rgb=_SUMMER_COOL)
    result = extract_skin_pixels(image)

    assert isinstance(result.mask, tuple), "mask must be a tuple"
    for row in result.mask:
        assert isinstance(row, tuple), f"mask row must be a tuple, got {type(row)}"
        for cell in row:
            assert isinstance(cell, bool), f"mask cell must be bool, got {type(cell)}"


@pytest.mark.unit
def test_extract_skin_pixels_pixels_is_tuple_of_rgb_tuples() -> None:
    """pixels must be a tuple of (r, g, b) int-tuples."""
    image = [[_AUTUMN_WARM, _BLUE_SKY]]
    result = extract_skin_pixels(image)

    assert isinstance(result.pixels, tuple), "pixels must be a tuple"
    for pixel in result.pixels:
        assert isinstance(pixel, tuple) and len(pixel) == 3, (
            f"Each pixel must be a 3-tuple, got {pixel!r}"
        )
        for ch in pixel:
            assert isinstance(ch, int) and 0 <= ch <= 255, (
                f"Each channel must be int in 0-255, got {ch!r}"
            )


@pytest.mark.unit
def test_extract_skin_pixels_1x1_non_skin_returns_empty_pixels_tuple() -> None:
    """1×1 non-skin image: pixels must be the empty tuple, not None or []."""
    result = extract_skin_pixels([[_WHITE]])
    assert result.pixels == ()
    assert isinstance(result.pixels, tuple)


@pytest.mark.unit
def test_extract_skin_pixels_row_major_order_preserved() -> None:
    """pixels appear in row-major (top-to-bottom, left-to-right) order.

    Image:
        Row 0: [autumn_warm, blue_sky, spring_warm]   → autumn_warm, spring_warm
        Row 1: [blue_sky,    dark_bg,  summer_cool]   → summer_cool
        Row 2: [winter_cool, blue_sky, blue_sky]      → winter_cool

    Expected pixels tuple: (autumn_warm, spring_warm, summer_cool, winter_cool)
    """
    image = [
        [_AUTUMN_WARM, _BLUE_SKY, _SPRING_WARM],
        [_BLUE_SKY, _DARK_BG, _SUMMER_COOL],
        [_WINTER_COOL, _BLUE_SKY, _BLUE_SKY],
    ]
    result = extract_skin_pixels(image)

    expected = (_AUTUMN_WARM, _SPRING_WARM, _SUMMER_COOL, _WINTER_COOL)
    assert result.pixels == expected, (
        f"Expected row-major order {expected}, got {result.pixels}"
    )


# ===========================================================================
# Section 6 — Input validation: TypeError and ValueError boundaries
# ===========================================================================


@pytest.mark.unit
def test_extract_skin_pixels_empty_image_raises_value_error() -> None:
    """An empty image list must raise ValueError."""
    with pytest.raises(ValueError, match="at least 1 row"):
        extract_skin_pixels([])


@pytest.mark.unit
def test_extract_skin_pixels_empty_row_raises_value_error() -> None:
    """An image with at least one empty row must raise ValueError."""
    with pytest.raises(ValueError, match="at least 1 column"):
        extract_skin_pixels([[]])


@pytest.mark.unit
def test_extract_skin_pixels_string_image_raises_type_error() -> None:
    """A plain string must be rejected as a non-Sequence image type."""
    with pytest.raises(TypeError):
        extract_skin_pixels("not an image")  # type: ignore[arg-type]


@pytest.mark.unit
def test_extract_skin_pixels_jagged_image_raises_value_error() -> None:
    """An image where row lengths differ must raise ValueError."""
    jagged = [
        [(220, 185, 150), (220, 185, 150)],
        [(220, 185, 150)],  # shorter row → jagged
    ]
    with pytest.raises(ValueError, match="jagged"):
        extract_skin_pixels(jagged)


@pytest.mark.unit
def test_extract_skin_pixels_non_tuple_pixel_raises_type_error() -> None:
    """A pixel that is not a 3-tuple must raise TypeError."""
    bad_image = [[[255, 200, 180]]]  # list instead of tuple
    with pytest.raises(TypeError, match="3-tuple"):
        extract_skin_pixels(bad_image)


@pytest.mark.unit
def test_extract_skin_pixels_pixel_with_wrong_channel_count_raises_type_error() -> None:
    """A pixel tuple with != 3 elements must raise TypeError."""
    bad_image = [[(255, 200)]]  # only 2 channels
    with pytest.raises(TypeError, match="3-tuple"):
        extract_skin_pixels(bad_image)


@pytest.mark.unit
def test_extract_skin_pixels_float_channel_raises_type_error() -> None:
    """Float channel values must be rejected (int required)."""
    bad_image = [[(220.0, 185, 150)]]  # type: ignore[list-item]
    with pytest.raises(TypeError, match="channel"):
        extract_skin_pixels(bad_image)


@pytest.mark.unit
def test_extract_skin_pixels_bool_channel_raises_type_error() -> None:
    """Boolean channel values must be rejected (bool is int subclass but disallowed)."""
    bad_image = [[(True, 185, 150)]]  # type: ignore[list-item]
    with pytest.raises(TypeError, match="channel"):
        extract_skin_pixels(bad_image)


@pytest.mark.unit
def test_extract_skin_pixels_out_of_range_channel_raises_value_error() -> None:
    """Channel values outside 0-255 must raise ValueError."""
    bad_image = [[(256, 185, 150)]]
    with pytest.raises(ValueError, match="0-255"):
        extract_skin_pixels(bad_image)


@pytest.mark.unit
def test_extract_skin_pixels_negative_channel_raises_value_error() -> None:
    """Negative channel values must raise ValueError."""
    bad_image = [[(-1, 185, 150)]]
    with pytest.raises(ValueError, match="0-255"):
        extract_skin_pixels(bad_image)
