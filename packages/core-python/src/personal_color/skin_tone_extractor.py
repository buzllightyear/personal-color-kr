"""전체 파이프라인 통합 함수 — extract_skin_tone_features (Sub-AC 17-1e).

Provides :func:`extract_skin_tone_features`, the single entry point that
combines skin-pixel detection, HSB conversion, and warm/cool scoring into
one Image → SkinToneFeature call.

Pipeline stages (all rule-based, no learned model)
----------------------------------------------------
1. **Skin extract** — Image → flat tuple of skin-classified pixels
   using YCbCr channel thresholding
   (:func:`~personal_color.skin_extractor.extract_skin_pixels`).
2. **HSB convert** — skin pixels → ``(hue, saturation, brightness)``
   via the standard HSV algorithm
   (:func:`~personal_color.color_features.pixels_to_hsb`).
3. **Warm/cool score** — skin pixels → scalar ``warm_cool_score``
   derived from ``(mean_R - mean_B) / 255``
   (:func:`~personal_color.color_features.compute_warm_cool_score`).

Output type
-----------
:class:`SkinToneFeature` is a frozen dataclass with four float fields:

* ``hue``             — hue angle in ``[0.0, 360.0)`` degrees.
* ``saturation``      — HSV chroma ratio in ``[0.0, 1.0]``.
* ``brightness``      — HSV value (max channel) in ``[0.0, 1.0]``.
* ``warm_cool_score`` — warm/cool signal in ``[-1.0, 1.0]``.
  Positive → warm undertone (봄웜 / 가을웜);
  negative → cool undertone (여름쿨 / 겨울쿨).

Error contract
--------------
:class:`NoSkinPixelsError`
    Raised when the YCbCr skin classifier finds zero skin pixels in the
    input image.  This covers two concrete failure cases the AC names:

    * **알려진 피부색 이미지** (known skin-colour image) → passes; all
      four fields are returned in their guaranteed ranges.
    * **얼굴 없는 이미지** (no-face / no-skin image) → raises
      ``NoSkinPixelsError`` so the caller can surface a meaningful error
      rather than computing over an empty pixel set.

    ``NoSkinPixelsError`` is a ``ValueError`` subclass, matching the
    permanent-error taxonomy used throughout the Phase 0.x diagnosis stack.

Design constraints
------------------
* **Rule-based only.** No learned model, no inference call, no external
  vendor.  Every computation is closed-form arithmetic applied to the
  raw pixel values.  Satisfies "자체 AI 모델 학습 금지" and the
  explicit carve-out for rule-based identity/skin scoring.
* **Pure-Python image path.** The ``image`` parameter is the already-
  decoded :data:`~personal_color.region_extractor.Image` type (a
  ``Sequence[Sequence[RGB]]``).  No Pillow boundary is crossed here;
  decoding is the caller's responsibility, which keeps the unit-test
  layer free of native dependencies.
* **Immutable output.** :class:`SkinToneFeature` is ``frozen=True`` —
  consistent with every other dataclass in the diagnosis stack.
"""

from __future__ import annotations

from dataclasses import dataclass

from personal_color.color_features import compute_warm_cool_score, pixels_to_hsb
from personal_color.region_extractor import Image
from personal_color.skin_extractor import extract_skin_pixels


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SkinToneFeature:
    """Immutable four-component skin-tone feature for a decoded image.

    Combines the HSB representation of the mean skin colour with the
    warm/cool temperature signal into a single output type, covering
    all four fields specified by Sub-AC 17-1e.

    Attributes
    ----------
    hue:
        Hue angle of the mean skin colour in ``[0.0, 360.0)`` degrees.
        0°/360° = red, 60° = yellow, 120° = green, 180° = cyan,
        240° = blue, 300° = magenta.  For achromatic inputs (saturation = 0)
        the hue is defined as 0.0.
    saturation:
        HSV chroma ratio of the mean skin colour in ``[0.0, 1.0]``.
        0.0 = fully desaturated (grey/white/black); 1.0 = fully saturated.
    brightness:
        Maximum RGB channel value normalised to ``[0.0, 1.0]``.
        0.0 = black; 1.0 = full brightness.
    warm_cool_score:
        Scalar warm/cool undertone signal in ``[-1.0, 1.0]``.
        Derived from ``(mean_R - mean_B) / 255``.
        Positive → warm undertone (봄웜 / 가을웜);
        negative → cool undertone (여름쿨 / 겨울쿨);
        zero → neutral (R == B).
    """

    hue: float
    saturation: float
    brightness: float
    warm_cool_score: float


# ---------------------------------------------------------------------------
# Public error type
# ---------------------------------------------------------------------------


class NoSkinPixelsError(ValueError):
    """Raised when no skin pixels are found in the supplied image.

    This is a permanent input failure — the same image will not yield skin
    pixels on retry.  Concrete trigger conditions that map to "얼굴 없는 이미지":

    * A landscape, product, or text-only image with no human skin region.
    * A heavily filtered selfie where all pixels fall outside the YCbCr
      skin-tone cluster (77 ≤ Cb ≤ 127 AND 133 ≤ Cr ≤ 173).
    * An achromatic / monochrome image (e.g. greyscale photos).
    * A digitally generated image that bypassed the skin-tone range.

    Callers that want to surface this as an HTTP error should map it to
    **422 Unprocessable Entity** — the image decoded successfully but is
    semantically unprocessable for skin-tone feature extraction.
    """


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_skin_tone_features(image: Image) -> SkinToneFeature:
    """Extract skin-tone features from a decoded image.

    Orchestrates the three-stage pipeline (skin-detect → HSB-convert →
    warm/cool-score) into a single Image-in / SkinToneFeature-out call.
    No model inference occurs anywhere; the full pipeline is rule-based
    and deterministic.

    Parameters
    ----------
    image:
        Decoded selfie as a rows-first ``Sequence[Sequence[RGB]]``
        (the :data:`~personal_color.region_extractor.Image` type).
        Top-left origin; must be rectangular and non-empty.  Identical
        to the ``Image`` type consumed by
        :func:`~personal_color.skin_extractor.extract_skin_pixels`.

    Returns
    -------
    SkinToneFeature
        Immutable frozen dataclass with four float fields:

        * ``hue``             — hue angle in ``[0.0, 360.0)`` degrees.
        * ``saturation``      — HSV chroma ratio in ``[0.0, 1.0]``.
        * ``brightness``      — HSV value in ``[0.0, 1.0]``.
        * ``warm_cool_score`` — warm/cool signal in ``[-1.0, 1.0]``.

    Raises
    ------
    NoSkinPixelsError
        No skin pixels were detected in ``image`` after YCbCr thresholding.
        The caller should surface this as a permanent input failure (HTTP 422).
    TypeError
        ``image`` is not a ``Sequence``, any row is not a ``Sequence``,
        or any pixel is not a 3-tuple of ints.  Propagated from
        :func:`~personal_color.skin_extractor.extract_skin_pixels`.
    ValueError
        ``image`` has no rows, any row is empty, the image is jagged,
        or any channel value lies outside 0–255.  Propagated from
        :func:`~personal_color.skin_extractor.extract_skin_pixels`.
    """
    # Stage 1 — Image → skin pixels (rule-based YCbCr thresholding).
    # Delegates all image-shape validation to extract_skin_pixels.
    skin_result = extract_skin_pixels(image)

    if len(skin_result.pixels) == 0:
        raise NoSkinPixelsError(
            "no skin pixels detected in image — "
            "image may not contain a human face or visible skin region",
        )

    skin_pixels: tuple = skin_result.pixels

    # Stage 2 — skin pixels → HSB (hue, saturation, brightness).
    # Standard HSV algorithm applied to the mean skin colour; fully
    # deterministic, no model, no network call.
    hsb = pixels_to_hsb(skin_pixels)

    # Stage 3 — skin pixels → warm/cool score.
    # Scalar projection: (mean_R − mean_B) / 255.
    warm_cool = compute_warm_cool_score(skin_pixels)

    return SkinToneFeature(
        hue=hsb.hue,
        saturation=hsb.saturation,
        brightness=hsb.brightness,
        warm_cool_score=warm_cool,
    )


__all__ = [
    "NoSkinPixelsError",
    "SkinToneFeature",
    "extract_skin_tone_features",
]
