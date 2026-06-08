"""Selfie → skin-tone color feature vector extraction (Sub-AC 3a).

Top-level entry point that composes the raw-bytes decode, rule-based
skin-pixel detection, and arithmetic color-feature computation into a
single function call:

  1. **Decode** — raw PNG/JPEG bytes → :data:`~personal_color.region_extractor.Image`
     (Pillow-backed, isolated behind the injectable ``_decoder`` seam).
  2. **Skin extract** — Image → flat tuple of skin-classified pixels using
     YCbCr channel thresholding (rule-based, no native dep beyond Pillow).
  3. **Feature compute** — skin pixels → :class:`~personal_color.color_features.ColorFeatureVector`
     (pure arithmetic, zero external dependencies).

The returned :class:`~personal_color.color_features.ColorFeatureVector`
carries three float components:

  * ``color_temperature`` ∈ ``[-1.0, 1.0]`` — warm/cool undertone signal
    derived from ``(mean_R − mean_B) / 255``.  Positive values indicate
    warm skin undertones (봄웜, 가을웜); negative values indicate cool
    undertones (여름쿨, 겨울쿨).
  * ``brightness`` ∈ ``[0.0, 1.0]``  — Rec. 601 luma of the mean skin
    colour.
  * ``saturation`` ∈ ``[0.0, 1.0]``  — HSV saturation of the mean skin
    colour.

These three features are the same values consumed by
:func:`~personal_color.feature_vector_classifier.classify_season_from_feature_vector`
for downstream Korean personal-colour season classification.

Design constraints
------------------
* **Rule-based only.** No learned model, no inference call anywhere on
  the execution path.  Satisfies the Seed constraint
  "자체 AI 모델 학습 금지" and its explicit carve-out:
  "identity_similarity_score = face-landmark 기반 *rule-based* 유사도
  … → 허용".
* **Single Pillow boundary.** The ``_decoder`` default is the only place
  that imports Pillow. Unit tests inject a stub that returns a pre-built
  :class:`~personal_color.region_extractor.Image`, so the entire test
  suite runs without native dependencies.
* **Raises on no-skin.** :class:`NoSkinPixelsError` (a ``ValueError``
  subclass) is raised when YCbCr thresholding finds zero skin pixels —
  consistent with the permanent-error taxonomy established by
  :class:`~personal_color.image_decoder.InvalidSelfieError` and
  :class:`~personal_color.face_detector.FaceNotDetectedError`.
"""

from __future__ import annotations

from typing import Callable

from personal_color.color_features import ColorFeatureVector, compute_color_features
from personal_color.image_decoder import InvalidSelfieError, decode_image
from personal_color.region_extractor import Image
from personal_color.skin_extractor import extract_skin_pixels


# ---------------------------------------------------------------------------
# Public error type
# ---------------------------------------------------------------------------


class NoSkinPixelsError(ValueError):
    """Raised when no skin pixels are found in the decoded selfie image.

    This is a permanent input failure — the same payload will not yield
    skin pixels on retry. Concrete trigger conditions:

    * A landscape, product, or text-only photo with no human face.
    * A selfie in extreme lighting (full shadow or flash overexposure)
      where no pixel falls within the YCbCr skin-tone cluster.
    * A digitally generated or heavily filtered image that bypassed the
      skin-tone range.

    The Phase 4 HTTP layer maps this to **422 Unprocessable Entity**,
    matching the ``FaceNotDetectedError`` precedent (the payload decoded
    successfully but the image is semantically unprocessable for personal-
    colour diagnosis purposes).
    """


# ---------------------------------------------------------------------------
# Type alias — injectable seam protocol (mirrors diagnose_runtime.Decoder)
# ---------------------------------------------------------------------------

Decoder = Callable[[bytes], Image]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_selfie_color_features(
    selfie_bytes: bytes,
    *,
    _decoder: Decoder = decode_image,
) -> ColorFeatureVector:
    """Extract skin-tone color features from raw selfie bytes.

    Orchestrates the three-stage pipeline (decode → skin-detect →
    feature-compute) into a single bytes-in / feature-vector-out call.
    No model inference occurs anywhere; the full pipeline is rule-based
    and deterministic.

    Parameters
    ----------
    selfie_bytes:
        Raw PNG or JPEG bytes from the mobile client.  Decoded entirely
        in memory; never written to disk.  Identical to the
        ``selfie_bytes`` accepted by
        :func:`~personal_color.diagnose_runtime.diagnose_personal_color`.
    _decoder:
        Injectable decode callable.  Defaults to the production
        Pillow-backed
        :func:`~personal_color.image_decoder.decode_image`.  Unit tests
        inject a stub that returns a pre-built
        :class:`~personal_color.region_extractor.Image` so the test
        layer needs no native dependencies installed.

    Returns
    -------
    ColorFeatureVector
        Immutable frozen dataclass with three float fields:

        * ``color_temperature`` — warm/cool signal in ``[-1.0, 1.0]``.
        * ``brightness``        — Rec. 601 luma in ``[0.0, 1.0]``.
        * ``saturation``        — HSV saturation in ``[0.0, 1.0]``.

    Raises
    ------
    InvalidSelfieError
        Propagated from ``_decoder`` when ``selfie_bytes`` is empty,
        wrong type, or not a valid PNG/JPEG payload.  Phase 4 maps to
        **HTTP 400 Bad Request**.
    NoSkinPixelsError
        No skin pixels were detected in the decoded image after YCbCr
        thresholding.  Phase 4 maps to **HTTP 422 Unprocessable Entity**.
    TypeError
        Propagated from the primitive layer on structural contract
        violations (programmer error in the decoder contract, not a user
        error).
    ValueError
        Propagated from the primitive layer for out-of-range pixel
        values (same programmer-error taxonomy as ``TypeError`` above).
    """
    # Stage 1 — bytes → Image.
    # The decoder is the only place in this call path that holds binary
    # data; once it returns the ``Image``, the bytes are no longer needed.
    image: Image = _decoder(selfie_bytes)

    # Stage 2 — Image → skin pixels.
    # YCbCr rule-based classification — no model, no network call.
    # The whole image is scanned; no face-detection step is required for
    # this feature-extraction layer (face detection is a separate stage
    # in the generation funnel's reject filter).
    skin_result = extract_skin_pixels(image)

    if len(skin_result.pixels) == 0:
        raise NoSkinPixelsError(
            "no skin pixels detected in selfie — "
            "image may not contain a human face or skin region",
        )

    # Stage 3 — skin pixels → ColorFeatureVector.
    # Aggregates all skin-classified pixels into three scalar features
    # via closed-form arithmetic formulas.  Deterministic; same pixels →
    # same vector.
    return compute_color_features(skin_result.pixels)


__all__ = [
    "ColorFeatureVector",
    "Decoder",
    "InvalidSelfieError",
    "NoSkinPixelsError",
    "extract_selfie_color_features",
]
