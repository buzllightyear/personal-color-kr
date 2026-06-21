"""Personal-colour diagnosis service — end-to-end pipeline (Sub-AC 3c).

This module is the **single public entry point** for personal-colour diagnosis:
it accepts a selfie image (as a file path *or* raw bytes), wires together the
Sub-AC 3a feature extractor and the Sub-AC 3b category classifier, and returns
a :class:`PersonalColorResult` containing the category slug and confidence score.

Pipeline
--------
1. **Load** — if the caller passes a file path (``str`` or
   :class:`~pathlib.Path`), read the file bytes; if raw bytes are passed,
   use them directly.
2. **Extract** (Sub-AC 3a) — :func:`extract_selfie_color_features` decodes
   the PNG/JPEG bytes, detects skin pixels via YCbCr thresholding, and
   returns a three-component :class:`~personal_color.color_features.ColorFeatureVector`
   (``color_temperature``, ``brightness``, ``saturation``).
3. **Classify** (Sub-AC 3b) — :func:`classify_personal_color` maps the
   feature vector to one of the four Korean personal-colour seasons
   (봄/여름/가을/겨울) and computes a geometric-mean confidence score in
   ``[0.0, 1.0]``.
4. **Return** — the :class:`~personal_color.feature_vector_classifier.PersonalColorResult`
   (``category``, ``confidence``) is returned to the caller unchanged.

Design constraints
------------------
* **Rule-based only.** No learned model, no fine-tuning, no inference call
  on any step of the pipeline.  Satisfies the Seed constraint
  "자체 AI 모델 학습 금지".
* **Single responsibility.** This module only wires step 1-3 together; it
  does not duplicate any logic from 3a or 3b.
* **Accepts path or bytes.** Mobile callers pass file paths; server callers
  pass raw bytes.  Both are supported without requiring the caller to read
  the file itself.
* **Error contract preserved.** Exceptions from 3a (``InvalidSelfieError``,
  ``NoSkinPixelsError``) and 3b (``ValueError`` for neutral undertone) are
  propagated unchanged.  ``FileNotFoundError`` / ``OSError`` are raised
  when the provided path does not exist or cannot be read.

Example
-------
>>> from personal_color.personal_color_service import diagnose_selfie
>>> result = diagnose_selfie("selfie.png")
>>> result.category   # "spring" | "summer" | "autumn" | "winter"
>>> result.confidence  # float in [0.0, 1.0]
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

from personal_color.feature_vector_classifier import (
    PersonalColorResult,
    classify_personal_color,
)
from personal_color.selfie_feature_extractor import extract_selfie_color_features

# ---------------------------------------------------------------------------
# Public type alias
# ---------------------------------------------------------------------------

#: Accepted input types for the service function.
SelfieInput = Union[str, Path, bytes, bytearray]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def diagnose_selfie(
    selfie_input: SelfieInput,
) -> PersonalColorResult:
    """Diagnose the personal colour category from a selfie image.

    Orchestrates the full pipeline:
    ``(path or bytes) → bytes → ColorFeatureVector → PersonalColorResult``.

    Parameters
    ----------
    selfie_input:
        Either a file path (``str`` or :class:`~pathlib.Path`) pointing to a
        PNG or JPEG selfie, or the raw image bytes (``bytes`` or
        ``bytearray``).  When a path is provided the file is read in binary
        mode; the bytes are never written back to disk.

    Returns
    -------
    PersonalColorResult
        Frozen dataclass with two fields:

        * ``category`` — lowercase ASCII season slug:
          ``"spring" | "summer" | "autumn" | "winter"``.
        * ``confidence`` — geometric-mean confidence in ``[0.0, 1.0]``.
          ``0.0`` means the feature vector is exactly on a decision boundary;
          ``1.0`` means both axes point unambiguously to the returned season.

    Raises
    ------
    FileNotFoundError
        The provided path does not exist on disk.
    OSError
        The provided path exists but cannot be read (permissions, I/O error).
    InvalidSelfieError
        Propagated from Sub-AC 3a when ``selfie_input`` is empty bytes,
        is not a valid PNG/JPEG payload, or fails Pillow decode.  Maps to
        HTTP 400 Bad Request at the Phase 4 layer.
    NoSkinPixelsError
        Propagated from Sub-AC 3a when the decoded image contains no
        skin-classified pixels under YCbCr thresholding.  Maps to HTTP 422
        Unprocessable Entity at the Phase 4 layer.
    ValueError
        Propagated from Sub-AC 3b when the feature vector's
        ``color_temperature`` falls in the neutral zone and the season
        cannot be determined.  Caller should prompt the user to retake the
        selfie.
    TypeError
        Propagated from the primitive layer on structural contract violations
        (programmer error).
    """
    # Step 1 — load bytes if a path was given.
    if isinstance(selfie_input, (str, Path)):
        selfie_bytes: bytes = Path(selfie_input).read_bytes()
    else:
        selfie_bytes = bytes(selfie_input)

    # Step 2 — Sub-AC 3a: bytes → ColorFeatureVector.
    features = extract_selfie_color_features(selfie_bytes)

    # Step 3 — Sub-AC 3b: ColorFeatureVector → PersonalColorResult.
    return classify_personal_color(features)


__all__ = [
    "SelfieInput",
    "PersonalColorResult",
    "diagnose_selfie",
]
