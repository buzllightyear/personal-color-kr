"""Face-region-bounded skin pixel sampler (Sub-AC 17-1b).

Provides :func:`sample_skin_pixels` — the narrow entry point for sampling
rule-based skin-classified pixels exclusively from within a detected face
bounding box.

Relationship to :mod:`personal_color.skin_extractor`
-----------------------------------------------------
* :func:`~personal_color.skin_extractor.extract_skin_pixels` accepts a
  full decoded image and scans the **entire** frame.
* :func:`sample_skin_pixels` (this module) accepts a full image *and* a
  face bounding box, restricts sampling to pixels inside that box, and
  guarantees a minimum sample count via a graceful fallback.

The restriction to face-region pixels is essential for the generation-pipeline
reject filter and the identity-similarity scorer: both need skin-tone evidence
that is representative of the *face*, not the background or clothing.

Minimum-sample guarantee
------------------------
YCbCr thresholding may miss some skin pixels under extreme lighting or heavy
camera-filter effects. When the detected skin-pixel count falls below
``min_samples``, the function returns *all* pixels in the face region as a
fallback — pixels within a detected face bounding box are valid candidates
for colour analysis even if they fall outside the thresholded skin cluster.

Design constraints (shared with the rest of the diagnosis primitive layer)
--------------------------------------------------------------------------
* Pure Python — no numpy, no PIL, no binary extensions inside this module.
* Rule-based only — no learned model, no inference call.
* Immutable intermediate types; output is a mutable ``list`` so the caller
  can concatenate or slice without copying.
* No silent clamping: bad input raises at the boundary.
"""

from __future__ import annotations

from collections.abc import Sequence

from personal_color.face_detector import FaceBoundingBox
from personal_color.region_extractor import RGB, Image
from personal_color.skin_extractor import extract_skin_pixels

#: Default minimum sample count for :func:`sample_skin_pixels`.
#: When the YCbCr-classified skin pixel count falls below this threshold
#: the function falls back to returning all pixels in the face region.
MIN_SKIN_SAMPLE_COUNT: int = 10


def sample_skin_pixels(
    image: Image,
    face_region: FaceBoundingBox,
    *,
    min_samples: int = MIN_SKIN_SAMPLE_COUNT,
) -> list[RGB]:
    """Sample skin pixels from within a detected face bounding box.

    Only pixels whose coordinates fall inside ``face_region`` are ever
    included in the return value. Pixels outside the bounding box are
    unconditionally excluded regardless of their skin classification.

    Algorithm
    ---------
    1. Validate ``image`` shape and ``face_region`` bounds.
    2. Crop the image to ``face_region`` — build a sub-image of shape
       ``face_region.height × face_region.width``.
    3. Run :func:`~personal_color.skin_extractor.extract_skin_pixels` on
       the sub-image to classify each pixel using YCbCr thresholding.
    4. If the skin pixel count ≥ ``min_samples``, return those pixels.
    5. Otherwise return *all* pixels in the face region (fallback).

    Parameters
    ----------
    image:
        Full decoded selfie as a rows-first ``Sequence[Sequence[RGB]]``
        (the ``Image`` type from :mod:`personal_color.region_extractor`).
        Must be rectangular and non-empty.
    face_region:
        Face bounding box in absolute pixel coordinates — typically the
        output of :func:`~personal_color.face_detector.face_detect` or
        :func:`~personal_color.face_detector.detect_face_region`.
        Must lie fully inside ``image``.
    min_samples:
        Minimum number of pixels to return. Defaults to
        :data:`MIN_SKIN_SAMPLE_COUNT`. If fewer skin pixels are found
        the function returns all face-region pixels instead.

    Returns
    -------
    list[RGB]
        A list of ``(r, g, b)`` int-tuples containing skin-classified
        pixels (or all face-region pixels when the skin count falls below
        ``min_samples``). All returned pixels come exclusively from within
        ``face_region``.

        When skin pixels are sufficient:
            ``len(result) == number_of_skin_pixels_in_face_region``
            (which is ``>= min_samples``)

        When falling back:
            ``len(result) == face_region.width * face_region.height``

    Raises
    ------
    TypeError:
        If ``image`` is not a ``Sequence``, ``face_region`` is not a
        :class:`~personal_color.face_detector.FaceBoundingBox`, or any
        pixel inside the region is not a 3-tuple of ints.
    ValueError:
        If ``image`` is empty, ``face_region`` extends outside the image
        bounds, ``face_region.width`` or ``face_region.height`` is ≤ 0,
        ``min_samples`` is negative, or any pixel channel is outside 0–255.
    """
    _validate_inputs(image, face_region, min_samples=min_samples)

    # Build a sub-image restricted to face_region pixels only.
    sub_image: list[list[RGB]] = _crop_to_region(image, face_region)

    # Run rule-based YCbCr skin extraction on the cropped sub-image.
    skin_result = extract_skin_pixels(sub_image)
    skin_pixels: list[RGB] = list(skin_result.pixels)

    # Return skin pixels when we have enough.
    if len(skin_pixels) >= min_samples:
        return skin_pixels

    # Fallback: return all pixels in the face region. Pixels within a
    # detected face bounding box carry colour evidence about the subject's
    # skin even if the YCbCr gate rejected them (e.g. under-exposed or
    # heavy-filtered selfies).
    return [pixel for row in sub_image for pixel in row]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _crop_to_region(image: Image, region: FaceBoundingBox) -> list[list[RGB]]:
    """Return a sub-image cropped to *region* in absolute pixel coordinates.

    The returned sub-image is a plain Python list-of-lists so it satisfies
    the ``Image`` type alias (``Sequence[Sequence[RGB]]``) consumed by
    :func:`~personal_color.skin_extractor.extract_skin_pixels`.

    Precondition: ``_validate_inputs`` has already confirmed that the region
    lies fully within the image bounds, so no bounds check is repeated here.
    """
    return [
        [image[y][x] for x in range(region.x, region.x + region.width)]
        for y in range(region.y, region.y + region.height)
    ]


def _validate_inputs(
    image: Image,
    face_region: FaceBoundingBox,
    *,
    min_samples: int,
) -> None:
    """Validate image shape, face_region bounds, and min_samples.

    Raises ``TypeError`` / ``ValueError`` on constraint violation. Mirrors
    the validation discipline of the rest of the diagnosis primitive layer:
    no silent clamping, no permissive coercion.
    """
    # --- image type ---
    if isinstance(image, (str, bytes)) or not isinstance(image, Sequence):
        raise TypeError(
            f"image must be a 2-D Sequence of RGB tuples, "
            f"got {type(image).__name__}",
        )

    height = len(image)
    if height == 0:
        raise ValueError("image must have at least 1 row")

    first_row = image[0]
    if isinstance(first_row, (str, bytes)) or not isinstance(first_row, Sequence):
        raise TypeError(
            f"image row 0 must be a Sequence of RGB tuples, "
            f"got {type(first_row).__name__}",
        )
    width = len(first_row)
    if width == 0:
        raise ValueError("image rows must have at least 1 column")

    # --- face_region type ---
    if not isinstance(face_region, FaceBoundingBox):
        raise TypeError(
            f"face_region must be a FaceBoundingBox instance, "
            f"got {type(face_region).__name__}",
        )

    # --- face_region size ---
    if face_region.width <= 0 or face_region.height <= 0:
        raise ValueError(
            f"face_region width/height must be > 0, "
            f"got width={face_region.width}, height={face_region.height}",
        )

    # --- face_region origin ---
    if face_region.x < 0 or face_region.y < 0:
        raise ValueError(
            f"face_region origin must be non-negative, "
            f"got x={face_region.x}, y={face_region.y}",
        )

    # --- face_region bounds inside image ---
    if face_region.x + face_region.width > width:
        raise ValueError(
            f"face_region extends outside image width: "
            f"x={face_region.x} + width={face_region.width} > image_width={width}",
        )
    if face_region.y + face_region.height > height:
        raise ValueError(
            f"face_region extends outside image height: "
            f"y={face_region.y} + height={face_region.height} > image_height={height}",
        )

    # --- min_samples ---
    if min_samples < 0:
        raise ValueError(
            f"min_samples must be non-negative, got {min_samples}",
        )


__all__ = [
    "MIN_SKIN_SAMPLE_COUNT",
    "sample_skin_pixels",
]
