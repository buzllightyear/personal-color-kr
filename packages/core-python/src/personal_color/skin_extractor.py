"""Rule-based skin-pixel extractor for personal-color diagnosis (Sub-AC 12.1.2).

Given a face-region cropped image (the ``Image`` type from
:mod:`personal_color.region_extractor`) this module returns a binary skin
mask and a flat tuple of skin-only pixel values.  The algorithm is
*fully rule-based* — no learned model is involved — which satisfies the
Seed constraint: "학습된 선호/취향 모델 금지 … identity_similarity_score =
face-landmark 기반 *rule-based* 유사도이며 학습된 취향 모델 아님 → 허용".

Algorithm — YCbCr channel thresholding
--------------------------------------
The YCbCr color space separates luminance (Y) from chroma (Cb, Cr).
Skin pixels across a wide range of human skin tones occupy a compact
cluster in the Cb×Cr plane that is largely luminance-independent:

    77 ≤ Cb ≤ 127   and   133 ≤ Cr ≤ 173

These bounds originate from the Chai / Peer established literature and
are validated against Korean fair-to-medium skin tones (봄웜·가을웜 warm
tones and 여름쿨·겨울쿨 cool tones) — see the unit tests for verified
pixel fixtures.

Conversion used (BT.601 full-swing):
    Y  =  0.299R + 0.587G + 0.114B
    Cb = -0.168736R − 0.331264G + 0.5B + 128
    Cr =  0.5R − 0.418688G − 0.081312B + 128

Design constraints (same as the rest of the diagnosis primitive layer):
  * Pure Python only — no numpy, no PIL, no binary extensions.
    This keeps the test suite fast and the CI baseline cheap.
  * No silent clamping, no permissive coercion.  Bad input is a
    programmer error and surfaces immediately at the boundary.
  * Immutable output (frozen dataclass + tuples) — consistent with
    every other dataclass in the diagnosis stack.
"""

from __future__ import annotations

from dataclasses import dataclass

from personal_color.region_extractor import RGB, Image


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SkinExtractionResult:
    """Immutable result from :func:`extract_skin_pixels`.

    Attributes
    ----------
    mask:
        2-D boolean mask whose shape matches the input image.
        ``mask[y][x]`` is ``True`` when pixel ``(x, y)`` is classified
        as a skin pixel, ``False`` otherwise.
    pixels:
        Flat tuple of the RGB values for every skin-classified pixel
        in row-major order.  An empty tuple means no skin pixels were
        found.  Clients that only need aggregate color (e.g. the
        personal-color season classifier) can median-pool ``pixels``
        directly without inspecting ``mask``.
    """

    mask: tuple[tuple[bool, ...], ...]
    pixels: tuple[RGB, ...]


# ---------------------------------------------------------------------------
# YCbCr skin-detection thresholds
# ---------------------------------------------------------------------------

# Chai / Peer established bounds — validated against Korean skin tones.
# The Y (luminance) channel is *not* gated so the detector works across
# the full brightness range (dark environments, flash over-exposure, etc.)
_CB_MIN: float = 77.0
_CB_MAX: float = 127.0
_CR_MIN: float = 133.0
_CR_MAX: float = 173.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_skin_pixels(image: Image) -> SkinExtractionResult:
    """Extract skin pixels from a face-region cropped image.

    Classifies each pixel as *skin* or *non-skin* using rule-based
    YCbCr channel thresholds.  No model inference occurs — the
    classification is a deterministic arithmetic predicate applied
    independently to every pixel.

    The function accepts the same ``Image`` type used throughout the
    personal-color diagnosis stack (a rows-first ``Sequence[Sequence[RGB]]``
    of ``(r, g, b)`` int-tuples, top-left origin) so it plugs into the
    existing pipeline without adapter code.

    Parameters
    ----------
    image:
        A decoded face-region cropped image.  Typically the output of
        :func:`personal_color.image_decoder.decode_image` cropped to
        the bounding box returned by
        :func:`personal_color.face_detector.face_detect`.

    Returns
    -------
    SkinExtractionResult
        * ``mask`` — same shape as ``image``, ``True`` where skin.
        * ``pixels`` — flat tuple of skin RGB values (row-major order).

    Raises
    ------
    TypeError:
        If ``image`` is not a ``Sequence``, any row is not a
        ``Sequence``, or any pixel is not a 3-tuple of ints.
    ValueError:
        If ``image`` has no rows, any row is empty, the image is
        jagged (rows differ in length), or any channel value lies
        outside 0–255.
    """
    height, width = _validate_image(image)

    mask_rows: list[tuple[bool, ...]] = []
    skin_pixels: list[RGB] = []

    for y in range(height):
        row = image[y]
        row_mask: list[bool] = []
        for x in range(width):
            pixel = _validate_pixel(row[x], x=x, y=y)
            is_skin = _classify_skin(pixel[0], pixel[1], pixel[2])
            row_mask.append(is_skin)
            if is_skin:
                skin_pixels.append(pixel)
        mask_rows.append(tuple(row_mask))

    return SkinExtractionResult(
        mask=tuple(mask_rows),
        pixels=tuple(skin_pixels),
    )


# ---------------------------------------------------------------------------
# Internal helpers — skin classification
# ---------------------------------------------------------------------------


def _rgb_to_ycbcr(r: int, g: int, b: int) -> tuple[float, float, float]:
    """Convert an RGB pixel to YCbCr (BT.601 full-swing).

    The returned values are in floating-point to preserve fractional
    precision for the threshold comparison.  Cb and Cr are offset to
    the [0, 255] digital range by the +128 bias term.
    """
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128.0
    cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128.0
    return (y, cb, cr)


def _classify_skin(r: int, g: int, b: int) -> bool:
    """Return ``True`` if ``(r, g, b)`` falls in the skin-tone cluster.

    Classification criterion (Cb × Cr plane, luminance-independent):

        77 ≤ Cb ≤ 127   and   133 ≤ Cr ≤ 173

    Independently validated for:
    * 봄웜 (Spring Warm)  — high-chroma warm, e.g. (220, 185, 150)
    * 가을웜 (Autumn Warm) — muted warm, e.g. (200, 160, 130)
    * 여름쿨 (Summer Cool) — cool pink, e.g. (190, 170, 170)
    * 겨울쿨 (Winter Cool) — high-contrast cool, e.g. (195, 180, 175)
    """
    _, cb, cr = _rgb_to_ycbcr(r, g, b)
    return _CB_MIN <= cb <= _CB_MAX and _CR_MIN <= cr <= _CR_MAX


# ---------------------------------------------------------------------------
# Internal helpers — input validation
# ---------------------------------------------------------------------------


def _validate_image(image: object) -> tuple[int, int]:
    """Validate ``image`` shape; return ``(height, width)``.

    Mirrors the validation discipline from
    :func:`personal_color.region_extractor._validate_image` — same
    TypeError / ValueError taxonomy so the whole primitive layer speaks
    the same language.
    """
    from collections.abc import Sequence  # noqa: PLC0415 — local import avoids circular

    if isinstance(image, (str, bytes)) or not isinstance(image, Sequence):
        raise TypeError(
            f"image must be a 2-D Sequence of RGB tuples, "
            f"got {type(image).__name__}",
        )
    height = len(image)
    if height == 0:
        raise ValueError("image must have at least 1 row")

    width: int | None = None
    for row_idx, row in enumerate(image):
        if isinstance(row, (str, bytes)) or not isinstance(row, Sequence):
            raise TypeError(
                f"image row {row_idx} must be a Sequence of RGB tuples, "
                f"got {type(row).__name__}",
            )
        row_len = len(row)
        if width is None:
            if row_len == 0:
                raise ValueError("image rows must have at least 1 column")
            width = row_len
        elif row_len != width:
            raise ValueError(
                f"image is jagged: row {row_idx} has length {row_len}, "
                f"row 0 has length {width}",
            )

    assert width is not None  # loop ran ≥ once because height > 0
    return height, width


def _validate_pixel(pixel: object, *, x: int, y: int) -> RGB:
    """Validate a single pixel tuple; return it typed as ``RGB``."""
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
    return pixel  # type: ignore[return-value]


__all__ = [
    "SkinExtractionResult",
    "extract_skin_pixels",
]
