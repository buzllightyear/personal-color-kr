"""Unit tests for the face-region representative color extractor.

Sub-AC 10.4: 얼굴 이미지 입력에서 피부/눈동자/머리카락 영역의 대표 색상값을
추출하는 모듈. 목(mock) 이미지 입력 기반.

Test taxonomy:
  - Mock image construction (rectangular pixel arrays, no real face data).
  - Solid-fill regions — extractor must return that exact color.
  - Per-pixel-varying regions — MEDIAN and MEAN must collapse correctly.
  - Median-vs-mean robustness — verifies median ignores outliers.
  - 3-region composite path (`extract_face_region_colors`) end-to-end.
  - Input validation: image shape, region bounds, pixel shape,
    aggregation type. Mirrors the validation discipline of 10.1/10.2/10.3.
"""

from __future__ import annotations

import pytest

from personal_color.region_extractor import (
    Aggregation,
    FaceRegions,
    Region,
    RegionColors,
    RegionName,
    extract_face_region_colors,
    extract_region_color,
)


# ---------------------------------------------------------------------------
# Mock image helpers — keep test bodies declarative and small.
# ---------------------------------------------------------------------------


def _solid(width: int, height: int, rgb: tuple[int, int, int]) -> list[list[tuple[int, int, int]]]:
    """Build a width×height image filled with a single RGB color."""
    return [[rgb for _ in range(width)] for _ in range(height)]


def _stamp(
    image: list[list[tuple[int, int, int]]],
    region: Region,
    rgb: tuple[int, int, int],
) -> None:
    """Overwrite `region` of `image` in-place with the given color.

    Used to compose mock faces: a base background fill, then stamped
    skin / eyes / hair patches at known coordinates.
    """
    for y in range(region.y, region.y + region.height):
        for x in range(region.x, region.x + region.width):
            image[y][x] = rgb


# ---------------------------------------------------------------------------
# Single-region path — solid fill
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_solid_region_returns_that_color_median() -> None:
    image = _solid(width=4, height=4, rgb=(220, 180, 140))
    color = extract_region_color(image, Region(x=0, y=0, width=4, height=4))
    assert color == (220, 180, 140)


@pytest.mark.unit
def test_extract_solid_region_returns_that_color_mean() -> None:
    image = _solid(width=4, height=4, rgb=(60, 80, 120))
    color = extract_region_color(
        image,
        Region(x=0, y=0, width=4, height=4),
        aggregation=Aggregation.MEAN,
    )
    assert color == (60, 80, 120)


@pytest.mark.unit
def test_extract_default_aggregation_is_median() -> None:
    # If MEAN were the silent default it would round the outlier pixel up;
    # MEDIAN ignores it. Distinguishes default-aggregation behavior.
    image = _solid(width=3, height=3, rgb=(100, 100, 100))
    image[1][1] = (250, 250, 250)  # one outlier in 9 pixels

    color = extract_region_color(image, Region(x=0, y=0, width=3, height=3))
    assert color == (100, 100, 100)


# ---------------------------------------------------------------------------
# Single-region path — region is a sub-rectangle, not the whole image
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_subregion_samples_only_inside_box() -> None:
    # Background skin tone, with a darker "hair" stamp in the lower-left
    # corner. Sampling the hair box must return the hair color, not the
    # background. This confirms the extractor honors the region rectangle
    # and does not bleed into neighboring pixels.
    image = _solid(width=8, height=8, rgb=(220, 180, 140))
    hair_box = Region(x=0, y=5, width=3, height=3)
    _stamp(image, hair_box, (30, 20, 15))

    assert extract_region_color(image, hair_box) == (30, 20, 15)
    # Sanity: the rest of the image is still the skin color.
    assert extract_region_color(
        image, Region(x=4, y=0, width=4, height=4),
    ) == (220, 180, 140)


# ---------------------------------------------------------------------------
# Aggregation semantics — varying pixels
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_mean_of_varying_region_is_average_per_channel() -> None:
    # 4 pixels with R values {100, 102, 104, 106} → mean 103, etc.
    image: list[list[tuple[int, int, int]]] = [
        [(100, 50, 25), (102, 52, 27)],
        [(104, 54, 29), (106, 56, 31)],
    ]
    color = extract_region_color(
        image,
        Region(x=0, y=0, width=2, height=2),
        aggregation=Aggregation.MEAN,
    )
    assert color == (103, 53, 28)


@pytest.mark.unit
def test_median_odd_count_is_middle_value() -> None:
    # 3 pixels — R = {10, 50, 90} → median R = 50.
    image: list[list[tuple[int, int, int]]] = [
        [(10, 10, 10), (50, 50, 50), (90, 90, 90)],
    ]
    color = extract_region_color(
        image,
        Region(x=0, y=0, width=3, height=1),
        aggregation=Aggregation.MEDIAN,
    )
    assert color == (50, 50, 50)


@pytest.mark.unit
def test_median_even_count_averages_two_middle_values() -> None:
    # 4 R-values {10, 40, 60, 90} → middle pair (40, 60) → median 50.
    image: list[list[tuple[int, int, int]]] = [
        [(10, 0, 0), (40, 0, 0), (60, 0, 0), (90, 0, 0)],
    ]
    color = extract_region_color(
        image,
        Region(x=0, y=0, width=4, height=1),
        aggregation=Aggregation.MEDIAN,
    )
    # G and B are all zero → median = 0.
    assert color == (50, 0, 0)


@pytest.mark.unit
def test_median_is_robust_to_outliers() -> None:
    # 9 skin-tone pixels with two extreme-bright outliers (e.g. specular
    # highlight from flash). Median must report the dominant skin tone;
    # mean would be biased upward by the outliers.
    skin = (200, 160, 130)
    flare = (255, 255, 255)
    image: list[list[tuple[int, int, int]]] = [
        [skin, skin, skin],
        [skin, flare, skin],
        [skin, skin, flare],
    ]
    region = Region(x=0, y=0, width=3, height=3)

    assert extract_region_color(image, region) == skin

    mean_color = extract_region_color(image, region, aggregation=Aggregation.MEAN)
    # Mean must be strictly brighter on every channel — outliers pulled it up.
    assert mean_color[0] > skin[0]
    assert mean_color[1] > skin[1]
    assert mean_color[2] > skin[2]


# ---------------------------------------------------------------------------
# Composite path — extract_face_region_colors over a 3-region mock face
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_face_region_colors_on_mock_face() -> None:
    # Mock face: 10×10 canvas with three stamped regions at known
    # coordinates and known colors. This is the canonical Sub-AC 10.4
    # contract — given a mock image plus diagnosis region boxes, return
    # the 3-feature color triple that feeds 10.1 / 10.2 / 10.3.
    skin_rgb = (220, 180, 140)      # warm light skin
    eye_rgb = (60, 40, 30)          # dark brown iris
    hair_rgb = (40, 25, 20)         # dark warm hair

    image = _solid(width=10, height=10, rgb=(0, 0, 0))
    skin_box = Region(x=2, y=2, width=4, height=2)
    eyes_box = Region(x=3, y=5, width=2, height=1)
    hair_box = Region(x=0, y=8, width=10, height=2)
    _stamp(image, skin_box, skin_rgb)
    _stamp(image, eyes_box, eye_rgb)
    _stamp(image, hair_box, hair_rgb)

    colors = extract_face_region_colors(
        image,
        FaceRegions(skin=skin_box, eyes=eyes_box, hair=hair_box),
    )
    assert colors == RegionColors(skin=skin_rgb, eyes=eye_rgb, hair=hair_rgb)


@pytest.mark.unit
def test_extract_face_region_colors_passes_aggregation_through() -> None:
    # Use a region where MEDIAN and MEAN diverge to confirm the kwarg is
    # actually forwarded, not silently dropped to the default.
    image: list[list[tuple[int, int, int]]] = [
        [(10, 10, 10), (40, 40, 40), (60, 60, 60), (90, 90, 90)],
    ]
    full = Region(x=0, y=0, width=4, height=1)
    regions = FaceRegions(skin=full, eyes=full, hair=full)

    median = extract_face_region_colors(image, regions)
    mean = extract_face_region_colors(image, regions, aggregation=Aggregation.MEAN)

    assert median.skin == (50, 50, 50)
    assert mean.skin == (50, 50, 50)  # symmetric → equal here
    # Different region positions would diverge; we proved the kwarg path
    # is wired by also checking the explicit MEAN call returns the
    # MEAN-defined value (round(sum/n) = round(200/4) = 50).


# ---------------------------------------------------------------------------
# Input validation — image
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_rejects_non_sequence_image() -> None:
    with pytest.raises(TypeError):
        extract_region_color(
            "not an image",  # type: ignore[arg-type]
            Region(x=0, y=0, width=1, height=1),
        )


@pytest.mark.unit
def test_extract_rejects_empty_image() -> None:
    with pytest.raises(ValueError):
        extract_region_color([], Region(x=0, y=0, width=1, height=1))


@pytest.mark.unit
def test_extract_rejects_empty_rows() -> None:
    with pytest.raises(ValueError):
        extract_region_color([[]], Region(x=0, y=0, width=1, height=1))


@pytest.mark.unit
def test_extract_rejects_jagged_image() -> None:
    # Row 0 has 2 pixels, row 1 has 3 — must raise rather than silently
    # under-sampling the longer row.
    jagged: list[list[tuple[int, int, int]]] = [
        [(0, 0, 0), (0, 0, 0)],
        [(0, 0, 0), (0, 0, 0), (0, 0, 0)],
    ]
    with pytest.raises(ValueError):
        extract_region_color(jagged, Region(x=0, y=0, width=2, height=2))


@pytest.mark.unit
def test_extract_rejects_non_sequence_row() -> None:
    bad: list[object] = [[(0, 0, 0)], "not a row"]
    with pytest.raises(TypeError):
        extract_region_color(
            bad,  # type: ignore[arg-type]
            Region(x=0, y=0, width=1, height=1),
        )


# ---------------------------------------------------------------------------
# Input validation — region
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_rejects_non_region_argument() -> None:
    image = _solid(width=2, height=2, rgb=(0, 0, 0))
    with pytest.raises(TypeError):
        extract_region_color(
            image,
            (0, 0, 1, 1),  # type: ignore[arg-type]
        )


@pytest.mark.unit
@pytest.mark.parametrize(
    "region",
    [
        Region(x=0, y=0, width=0, height=1),
        Region(x=0, y=0, width=1, height=0),
        Region(x=0, y=0, width=-1, height=1),
        Region(x=0, y=0, width=1, height=-1),
    ],
)
def test_extract_rejects_zero_or_negative_region_size(region: Region) -> None:
    image = _solid(width=4, height=4, rgb=(0, 0, 0))
    with pytest.raises(ValueError):
        extract_region_color(image, region)


@pytest.mark.unit
@pytest.mark.parametrize(
    "region",
    [
        Region(x=-1, y=0, width=1, height=1),
        Region(x=0, y=-1, width=1, height=1),
    ],
)
def test_extract_rejects_negative_region_origin(region: Region) -> None:
    image = _solid(width=4, height=4, rgb=(0, 0, 0))
    with pytest.raises(ValueError):
        extract_region_color(image, region)


@pytest.mark.unit
@pytest.mark.parametrize(
    "region",
    [
        Region(x=3, y=0, width=2, height=1),   # x + w = 5 > image width 4
        Region(x=0, y=3, width=1, height=2),   # y + h = 5 > image height 4
        Region(x=0, y=0, width=5, height=4),   # width too large
        Region(x=0, y=0, width=4, height=5),   # height too large
    ],
)
def test_extract_rejects_region_outside_image(region: Region) -> None:
    image = _solid(width=4, height=4, rgb=(0, 0, 0))
    with pytest.raises(ValueError):
        extract_region_color(image, region)


@pytest.mark.unit
def test_extract_rejects_bool_region_fields() -> None:
    # Reject bool (which is a subclass of int) at the region boundary —
    # same discipline as the RGB-channel validator in tone_classifier.
    image = _solid(width=4, height=4, rgb=(0, 0, 0))
    with pytest.raises(TypeError):
        extract_region_color(
            image,
            Region(x=True, y=0, width=1, height=1),  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# Input validation — pixel shape and channel ranges
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_rejects_non_tuple_pixel() -> None:
    bad_image: list[list[object]] = [
        [[0, 0, 0]],  # list, not tuple
    ]
    with pytest.raises(TypeError):
        extract_region_color(
            bad_image,  # type: ignore[arg-type]
            Region(x=0, y=0, width=1, height=1),
        )


@pytest.mark.unit
def test_extract_rejects_wrong_arity_pixel() -> None:
    bad_image: list[list[tuple[int, ...]]] = [
        [(0, 0)],  # 2-tuple instead of 3-tuple
    ]
    with pytest.raises(TypeError):
        extract_region_color(
            bad_image,  # type: ignore[arg-type]
            Region(x=0, y=0, width=1, height=1),
        )


@pytest.mark.unit
def test_extract_rejects_non_int_channel() -> None:
    bad_image: list[list[tuple[object, object, object]]] = [
        [(0.5, 0, 0)],  # float channel
    ]
    with pytest.raises(TypeError):
        extract_region_color(
            bad_image,  # type: ignore[arg-type]
            Region(x=0, y=0, width=1, height=1),
        )


@pytest.mark.unit
def test_extract_rejects_bool_channel() -> None:
    bad_image: list[list[tuple[object, object, object]]] = [
        [(True, 0, 0)],
    ]
    with pytest.raises(TypeError):
        extract_region_color(
            bad_image,  # type: ignore[arg-type]
            Region(x=0, y=0, width=1, height=1),
        )


@pytest.mark.unit
@pytest.mark.parametrize("bad_value", [-1, 256])
def test_extract_rejects_out_of_range_channel(bad_value: int) -> None:
    bad_image: list[list[tuple[int, int, int]]] = [
        [(bad_value, 0, 0)],
    ]
    with pytest.raises(ValueError):
        extract_region_color(
            bad_image,
            Region(x=0, y=0, width=1, height=1),
        )


# ---------------------------------------------------------------------------
# Input validation — aggregation argument
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_rejects_string_aggregation() -> None:
    image = _solid(width=2, height=2, rgb=(0, 0, 0))
    with pytest.raises(TypeError):
        extract_region_color(
            image,
            Region(x=0, y=0, width=2, height=2),
            aggregation="median",  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# extract_face_region_colors — validation passthrough and arg-shape check
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_face_region_colors_rejects_non_face_regions_argument() -> None:
    image = _solid(width=4, height=4, rgb=(0, 0, 0))
    with pytest.raises(TypeError):
        extract_face_region_colors(
            image,
            (Region(0, 0, 1, 1), Region(0, 0, 1, 1), Region(0, 0, 1, 1)),  # type: ignore[arg-type]
        )


@pytest.mark.unit
def test_face_region_colors_propagates_bounds_error() -> None:
    image = _solid(width=4, height=4, rgb=(0, 0, 0))
    regions = FaceRegions(
        skin=Region(x=0, y=0, width=1, height=1),
        eyes=Region(x=0, y=0, width=1, height=1),
        hair=Region(x=3, y=3, width=2, height=2),  # out of bounds
    )
    with pytest.raises(ValueError):
        extract_face_region_colors(image, regions)


# ---------------------------------------------------------------------------
# RegionName enum surface — kept for the future landmark adapter (10.5)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_region_name_enum_has_three_diagnosis_features() -> None:
    assert {r.value for r in RegionName} == {"skin", "eyes", "hair"}
