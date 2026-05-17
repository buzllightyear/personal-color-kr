"""Face-region representative color extractor (Sub-AC 10.4).

Given a face image (as a 2D array of RGB pixels) plus rectangular region
specs for the three diagnosis features — 피부(skin) / 눈동자(eyes/iris) /
머리카락(hair) — return a single representative RGB color per region. The
output feeds directly into the warm/cool primitive (10.1) and the
contrast primitive (10.2) that the season classifier (10.3) composes.

Why a separate region-extraction module:
  - Decouples *which pixels to sample* (this module) from *how to classify*
    (the 10.1/10.2/10.3 primitives). Sub-AC 10.5 will plug a landmark
    detector (MediaPipe / Face++) on top of this contract — that swap must
    not require changes to the classifier primitives.
  - Keeps the diagnosis primitive stack on commoditized math only. No
    self-trained model anywhere on the path (Seed constraint:
    "자체 AI 모델 학습 금지").

Design notes:
  - Image representation: any Sequence of Sequences of (r, g, b) tuples
    (rows-first, top-left origin: image[y][x] = (r, g, b)). Pure Python,
    no numpy/PIL dependency — this keeps the diagnosis primitive layer
    fast to test and free of binary deps that complicate CI.
  - Region representation: a frozen dataclass with (x, y, width, height)
    pixel rectangle. Out-of-bounds, zero-size, and negative regions are
    programmer errors and raise immediately.
  - Aggregation: MEDIAN per channel by default — robust to stray pixels
    (eyelashes inside a skin patch, sclera bleed inside an iris box,
    flyaway hairs over the forehead). MEAN is exposed for callers that
    need a smoother estimator on already-clean masks.
  - FaceRegions bundles the three diagnosis regions so callers (and the
    eventual landmark adapter) work with one self-documenting argument.

Input validation philosophy mirrors the rest of the diagnosis primitives
(10.1 / 10.2 / 10.3): no silent clamping, no permissive coercion. Bad
input is a programmer error and surfaces at the boundary.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum


# ---------------------------------------------------------------------------
# Public type aliases — kept in this module so downstream code (the future
# landmark adapter at Sub-AC 10.5) can import the same names instead of
# re-spelling the structural types at every call site.
# ---------------------------------------------------------------------------


RGB = tuple[int, int, int]
Image = Sequence[Sequence[RGB]]


class RegionName(Enum):
    """Identifier for the three diagnosis-relevant face regions."""

    SKIN = "skin"
    EYES = "eyes"
    HAIR = "hair"


@dataclass(frozen=True)
class Region:
    """Rectangular pixel-coordinate region on a face image.

    Coordinates use top-left origin: x grows right, y grows down. The
    rectangle covers pixels [x, x+width) × [y, y+height).
    """

    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class FaceRegions:
    """Bundle of the three diagnosis-relevant regions on a single face."""

    skin: Region
    eyes: Region
    hair: Region


class Aggregation(Enum):
    """How to collapse a region's pixels into one representative color."""

    MEAN = "mean"
    MEDIAN = "median"


@dataclass(frozen=True)
class RegionColors:
    """Representative RGB color per diagnosis region.

    Shape mirrors `FaceRegions` so the downstream funnel layer can iterate
    or destructure either type symmetrically.
    """

    skin: RGB
    eyes: RGB
    hair: RGB


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_region_color(
    image: Image,
    region: Region,
    *,
    aggregation: Aggregation = Aggregation.MEDIAN,
) -> RGB:
    """Extract a single representative RGB color from a rectangular region.

    Args:
        image: 2D rows-first array of RGB tuples. Must be rectangular
            (every row the same width) and non-empty.
        region: Rectangle to sample. Must lie fully inside the image and
            have strictly positive width and height.
        aggregation: MEDIAN (default, robust) or MEAN.

    Returns:
        Representative `(r, g, b)` tuple. Each channel is an int in 0-255.

    Raises:
        TypeError: if `image`, `region`, or `aggregation` has the wrong
            type, or any pixel inside the region is not a 3-tuple of ints.
        ValueError: if the image is empty / jagged, the region is empty
            or has negative origin, the region extends outside the image,
            or any pixel channel is outside 0-255.
    """
    _validate_aggregation(aggregation)
    width, height = _validate_image(image)
    _validate_region(region, width=width, height=height)

    pixels = _gather_pixels(image, region)

    if aggregation is Aggregation.MEDIAN:
        return _median_rgb(pixels)
    # _validate_aggregation already excluded anything else, so the only
    # remaining branch is MEAN. Encoded explicitly for readability.
    return _mean_rgb(pixels)


def extract_face_region_colors(
    image: Image,
    regions: FaceRegions,
    *,
    aggregation: Aggregation = Aggregation.MEDIAN,
) -> RegionColors:
    """Extract representative colors for skin / eyes / hair in one pass.

    Convenience wrapper over `extract_region_color`. Keyword-only
    `aggregation` for parity with the season-classifier API style.

    Args:
        image: 2D rows-first array of RGB tuples.
        regions: `FaceRegions` bundle with the three rectangular regions.
        aggregation: MEDIAN (default) or MEAN.

    Returns:
        `RegionColors` with one representative `(r, g, b)` per region.

    Raises:
        TypeError: if `regions` is not a `FaceRegions` instance (other
            type errors propagate from `extract_region_color`).
        ValueError: propagated from `extract_region_color`.
    """
    if not isinstance(regions, FaceRegions):
        raise TypeError(
            f"regions must be a FaceRegions instance, "
            f"got {type(regions).__name__}",
        )
    return RegionColors(
        skin=extract_region_color(image, regions.skin, aggregation=aggregation),
        eyes=extract_region_color(image, regions.eyes, aggregation=aggregation),
        hair=extract_region_color(image, regions.hair, aggregation=aggregation),
    )


# ---------------------------------------------------------------------------
# Internal helpers — validation
# ---------------------------------------------------------------------------


def _validate_aggregation(aggregation: Aggregation) -> None:
    if not isinstance(aggregation, Aggregation):
        raise TypeError(
            f"aggregation must be an Aggregation enum, "
            f"got {type(aggregation).__name__}",
        )


def _validate_image(image: Image) -> tuple[int, int]:
    """Validate the image shape and return (width, height)."""
    if isinstance(image, (str, bytes)) or not isinstance(image, Sequence):
        raise TypeError(
            f"image must be a 2D Sequence of RGB tuples, "
            f"got {type(image).__name__}",
        )
    height = len(image)
    if height == 0:
        raise ValueError("image must have at least 1 row")

    width: int | None = None
    for y, row in enumerate(image):
        if isinstance(row, (str, bytes)) or not isinstance(row, Sequence):
            raise TypeError(
                f"image row {y} must be a Sequence of RGB tuples, "
                f"got {type(row).__name__}",
            )
        if width is None:
            width = len(row)
            if width == 0:
                raise ValueError("image rows must have at least 1 column")
        elif len(row) != width:
            raise ValueError(
                f"image is jagged: row {y} has length {len(row)}, "
                f"row 0 has length {width}",
            )

    # The `width is None` case is unreachable because height > 0 was
    # already enforced and the loop ran at least once, so width is set.
    assert width is not None  # for type-checker
    return width, height


def _validate_region(region: Region, *, width: int, height: int) -> None:
    if not isinstance(region, Region):
        raise TypeError(
            f"region must be a Region instance, "
            f"got {type(region).__name__}",
        )
    # Reject bools that snuck in as ints (bool is a subclass of int) — the
    # primitive classifiers reject bool channels for the same reason, and
    # mixed boolean/int region coords are a known caller bug source.
    for field_name in ("x", "y", "width", "height"):
        value = getattr(region, field_name)
        if isinstance(value, bool) or not isinstance(value, int):
            raise TypeError(
                f"Region.{field_name} must be int, "
                f"got {type(value).__name__}",
            )

    if region.width <= 0 or region.height <= 0:
        raise ValueError(
            f"Region width/height must be > 0, "
            f"got width={region.width}, height={region.height}",
        )
    if region.x < 0 or region.y < 0:
        raise ValueError(
            f"Region origin must be non-negative, "
            f"got x={region.x}, y={region.y}",
        )
    if region.x + region.width > width or region.y + region.height > height:
        raise ValueError(
            f"Region {region} extends outside image bounds "
            f"({width}x{height})",
        )


def _validate_pixel(pixel: object, *, x: int, y: int) -> RGB:
    if not isinstance(pixel, tuple) or len(pixel) != 3:
        raise TypeError(
            f"pixel at (x={x}, y={y}) must be a 3-tuple (r, g, b), "
            f"got {type(pixel).__name__}",
        )
    for ch_name, ch in zip("rgb", pixel, strict=True):
        if isinstance(ch, bool) or not isinstance(ch, int):
            raise TypeError(
                f"channel '{ch_name}' at (x={x}, y={y}) must be int, "
                f"got {type(ch).__name__}",
            )
        if not 0 <= ch <= 255:
            raise ValueError(
                f"channel '{ch_name}' at (x={x}, y={y}) must be 0-255, "
                f"got {ch}",
            )
    # Cast — the structural checks above guarantee the shape.
    return pixel  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Internal helpers — pixel gathering and aggregation
# ---------------------------------------------------------------------------


def _gather_pixels(image: Image, region: Region) -> list[RGB]:
    out: list[RGB] = []
    for y in range(region.y, region.y + region.height):
        row = image[y]
        for x in range(region.x, region.x + region.width):
            out.append(_validate_pixel(row[x], x=x, y=y))
    return out


def _mean_rgb(pixels: list[RGB]) -> RGB:
    n = len(pixels)
    # n >= 1 is guaranteed because _validate_region enforces width*height>=1.
    r = round(sum(p[0] for p in pixels) / n)
    g = round(sum(p[1] for p in pixels) / n)
    b = round(sum(p[2] for p in pixels) / n)
    return (r, g, b)


def _median_rgb(pixels: list[RGB]) -> RGB:
    rs = sorted(p[0] for p in pixels)
    gs = sorted(p[1] for p in pixels)
    bs = sorted(p[2] for p in pixels)
    return (_median_int(rs), _median_int(gs), _median_int(bs))


def _median_int(sorted_values: list[int]) -> int:
    n = len(sorted_values)
    mid = n // 2
    if n % 2 == 1:
        return sorted_values[mid]
    # Even count — return the rounded average of the two middle values.
    return round((sorted_values[mid - 1] + sorted_values[mid]) / 2)
