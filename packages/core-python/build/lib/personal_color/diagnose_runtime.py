"""Production runtime entry point for Phase 0.x personal-color diagnosis.

This module is the bytes-in / :class:`DiagnosisResult`-out seam that
the Phase 4 HTTP server (and any future caller) uses to convert a raw
selfie payload into the four-category Korean personal-color verdict.
It composes three previously decoupled layers into a single call:

  1. **Pillow decode** — :func:`personal_color.image_decoder.decode_image`
     turns the raw PNG/JPEG bytes into the structural :class:`Image`
     type. This is the only place we hold the binary image data.
  2. **MediaPipe detection** —
     :func:`personal_color.face_detector.detect_face_regions` finds the
     primary face and emits the three diagnosis-relevant region
     rectangles (skin / eyes / hair).
  3. **Diagnosis composition** —
     :func:`personal_color.diagnosis_orchestrator.diagnose_from_image`
     consumes the decoded image and the rectangles, runs the tone /
     contrast / season primitives, and returns the immutable
     :class:`DiagnosisResult`.

Design constraints (Seed):

  * **Single decode.** The bytes are decoded exactly once; the resulting
    :class:`Image` reference is shared between the face detector and
    the diagnosis call. Re-decoding would waste latency and risk
    behavioural drift between the two consumers.
  * **Callable DI.** Both the decoder and the detector are injected
    through private keyword arguments (``_decoder`` / ``_detector``)
    with the production defaults wired in. Unit tests substitute
    stubs that need no native dependencies — Pillow and MediaPipe stay
    behind their isolation boundaries.
  * **Zero stub gap.** This function is end-to-end callable from the
    first commit. No ``NotImplementedError``, no pass-only body, no
    feature flag (Phase 3.1 ``__call__`` scaffold-gap lesson).
  * **PII safety.** No log line and no exception message in this file
    references any caller-side request identifier. The runtime sees
    only the raw byte payload and the structural pipeline values.

Error contract (re-exported for convenience):

  * :class:`InvalidSelfieError` — raised by the decoder. The bytes
    were not a PNG/JPEG, were truncated, or were empty. Phase 4 maps
    to **HTTP 400**.
  * :class:`FaceNotDetectedError` — raised by the detector. The bytes
    decoded successfully but no face was found. Phase 4 maps to
    **HTTP 422**.
"""

from __future__ import annotations

from typing import Callable

from personal_color.diagnosis_orchestrator import (
    DiagnosisResult,
    diagnose_from_image,
)
from personal_color.face_detector import FaceNotDetectedError, detect_face_regions
from personal_color.image_decoder import InvalidSelfieError, decode_image
from personal_color.region_extractor import FaceRegions, Image

# ---------------------------------------------------------------------------
# Type aliases — callable shapes for the injectable seams.
# ---------------------------------------------------------------------------
#
# ``Decoder`` and ``Detector`` are intentionally named at module scope so
# that unit tests can express their stubs against a stable, documented
# protocol shape without re-typing the bare ``Callable[[...], ...]``.
Decoder = Callable[[bytes], Image]
Detector = Callable[[Image], FaceRegions]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def diagnose_personal_color(
    selfie_bytes: bytes,
    *,
    _decoder: Decoder = decode_image,
    _detector: Detector = detect_face_regions,
) -> DiagnosisResult:
    """Run the full Phase 0.x pipeline on a raw selfie payload.

    Composes ``_decoder`` → ``_detector`` →
    :func:`diagnose_from_image` and returns the immutable
    :class:`DiagnosisResult` containing the season verdict plus the
    eight intermediate signals (tone, contrast, per-axis confidences,
    per-region luma) the analytics layer pins on.

    The function takes ``selfie_bytes`` by value so callers do not need
    to keep a parallel buffer alive. No copy of the bytes (or any
    pixel data derived from them) is retained after the call returns —
    the decoded :class:`Image` is referenced through local bindings
    only.

    Args:
        selfie_bytes: Raw PNG or JPEG image bytes uploaded by the user.
            Decoded in memory; never persisted.
        _decoder: Injected decoder callable. Defaults to the production
            Pillow-backed :func:`personal_color.image_decoder.decode_image`.
            Unit tests pass a stub that returns a pre-built :class:`Image`
            so the test layer needs no native dependencies.
        _detector: Injected detector callable. Defaults to the
            production MediaPipe-backed
            :func:`personal_color.face_detector.detect_face_regions`.
            Unit tests pass a stub that returns a pre-built
            :class:`FaceRegions`.

    Returns:
        A :class:`DiagnosisResult` frozen dataclass with the season
        verdict and all intermediate signals — see
        :class:`personal_color.diagnosis_orchestrator.DiagnosisResult`
        for the per-field documentation.

    Raises:
        InvalidSelfieError: Propagated from the decoder when
            ``selfie_bytes`` is empty, of the wrong type, not a
            PNG/JPEG payload, or fails to decode. Phase 4 maps to
            HTTP 400.
        FaceNotDetectedError: Propagated from the detector when no
            face is found in the decoded image. Phase 4 maps to
            HTTP 422.
        ValueError / TypeError: Propagated from the diagnosis
            primitives if their structural preconditions are violated
            (these indicate programmer error in the decoder or
            detector contract, not user error).
    """
    # Step 1 — bytes → Image. Decoded exactly once. The returned
    # ``Image`` reference is shared with both the detector and the
    # diagnosis call below; we never re-decode the bytes.
    image: Image = _decoder(selfie_bytes)

    # Step 2 — Image → FaceRegions. The detector may raise
    # ``FaceNotDetectedError`` for valid-but-faceless images; we let it
    # propagate so the HTTP layer can map it to 422 directly without
    # this module needing to know about HTTP at all.
    regions: FaceRegions = _detector(image)

    # Step 3 — Image + FaceRegions → DiagnosisResult. The orchestrator
    # owns the tone / contrast / season primitives and the confidence
    # shaping; we accept its result as-is so the diagnosis behaviour is
    # defined by exactly one source of truth.
    return diagnose_from_image(image, regions)


__all__ = [
    "Decoder",
    "Detector",
    "DiagnosisResult",
    "FaceNotDetectedError",
    "InvalidSelfieError",
    "diagnose_personal_color",
]
