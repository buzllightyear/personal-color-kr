"""Unit tests for `face_detect` — Sub-AC 1.

Verifies that the :func:`~personal_color.face_detector.face_detect`
function:

  1. Returns a :class:`~personal_color.face_detector.FaceBoundingBox`
     with correct pixel coordinates when a face is detected.
  2. Raises :class:`~personal_color.face_detector.FaceNotDetectedError`
     when no face is detected (MediaPipe returns zero detections).

Both scenarios are exercised against fixture images so the contract is
clear: the function accepts selfie-shaped image data and produces or
rejects on the basis of face presence — not image format.

**Unit tests** (the majority below) run without ``mediapipe`` or
``numpy`` installed. The detector is stubbed via the same
``_FakeDetector`` + ``_import_numpy`` monkeypatch pattern that the
existing ``test_face_detector.py`` suite established.

**Integration tests** (``@pytest.mark.integration`` section) require
``Pillow`` to load the PNG fixtures and ``mediapipe`` / ``numpy`` for
the real detector. They are skipped in the baseline CI lane.

Fixture images (in ``tests/fixtures/``):

  * ``no_face.png``   — 128×128 mid-grey canvas; no face geometry.
  * ``face_selfie.png`` — 128×128 warm-tone canvas; unit tests control
    what the detector "sees" via stubs; integration tests let the real
    MediaPipe attempt detection (expected: no real face → no-face path).
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from personal_color import face_detector
from personal_color.face_detector import (
    FaceBoundingBox,
    FaceNotDetectedError,
    face_detect,
)

# ---------------------------------------------------------------------------
# Fixtures directory path — resolved relative to this test file so the
# tests are location-independent within the repository tree.
# ---------------------------------------------------------------------------

_FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Shared stubs — same pattern as test_face_detector.py so the two suites
# stay consistent and the pattern is recognisable to future contributors.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _FakeDetections:
    """Mimics MediaPipe's ``FaceDetectorResult``."""

    detections: tuple[Any, ...]


class _FakeDetector:
    """Drop-in stub for ``mediapipe.solutions.face_detection.FaceDetection``.

    ``process()`` returns a result whose ``.detections`` is either
    ``None`` (zero-face MediaPipe sentinel) or a tuple of fake detection
    objects built by :func:`_make_fake_detection`.
    """

    def __init__(self, detections: tuple[Any, ...] | None) -> None:
        self._detections = detections

    def process(self, _frame: Any) -> object:
        if self._detections is None:
            return type("FakeResult", (), {"detections": None})()
        return _FakeDetections(detections=self._detections)


@pytest.fixture
def reset_detector_cache() -> Iterator[None]:
    """Ensure each test starts (and ends) with a fresh detector cache."""
    face_detector._reset_detector_cache_for_tests()
    yield
    face_detector._reset_detector_cache_for_tests()


@pytest.fixture
def stub_numpy(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace ``_import_numpy`` with a minimal stand-in.

    The fake ``numpy`` only needs ``array(image, dtype=...)`` to return
    *something* the fake detector accepts — content is opaque to the stub.
    """

    class _FakeNumpy:
        uint8 = "uint8"

        @staticmethod
        def array(image: Any, dtype: Any = None) -> Any:
            return image  # content is opaque; fake detector ignores it

    monkeypatch.setattr(face_detector, "_import_numpy", lambda: _FakeNumpy)


# ---------------------------------------------------------------------------
# Fixture image helpers — generate in-memory pixel arrays so unit tests
# have no dependency on the filesystem or Pillow.
# ---------------------------------------------------------------------------


def _make_no_face_fixture() -> list[list[tuple[int, int, int]]]:
    """128×128 mid-grey image — models a plain background / no-face photo."""
    grey = (180, 180, 180)
    return [[grey] * 128 for _ in range(128)]


def _make_face_selfie_fixture() -> list[list[tuple[int, int, int]]]:
    """128×128 warm-toned image — models a selfie.

    Pixel content is opaque to the unit tests; the stubbed detector
    decides the outcome. A warm skin tone is chosen so the fixture is
    recognisably selfie-shaped if a human inspects the file.
    """
    warm_skin = (220, 185, 150)
    return [[warm_skin] * 128 for _ in range(128)]


def _make_fake_detection(
    *, xmin: float, ymin: float, width: float, height: float
) -> Any:
    """Build a ``SimpleNamespace`` mimicking MediaPipe's ``Detection`` shape.

    Only the four leaf floats on
    ``detection.location_data.relative_bounding_box`` are read by
    ``_detection_to_pixel_box``.
    """
    return SimpleNamespace(
        location_data=SimpleNamespace(
            relative_bounding_box=SimpleNamespace(
                xmin=xmin,
                ymin=ymin,
                width=width,
                height=height,
            ),
        ),
    )


# ===========================================================================
# Section 1 — No-face image fixture: FaceNotDetectedError contract
# ===========================================================================


@pytest.mark.unit
def test_face_detect_no_face_fixture_none_detections_raises(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """No-face fixture + ``detections=None`` sentinel → FaceNotDetectedError.

    The no-face fixture represents a plain grey image — a landscape,
    product photo, or any upload that contains zero faces. MediaPipe's
    ``None`` sentinel for zero detections must surface as
    ``FaceNotDetectedError`` so the reject filter can gate the candidate
    before the enhancer de-slop layer.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    no_face_image = _make_no_face_fixture()

    with pytest.raises(FaceNotDetectedError):
        face_detect(no_face_image)


@pytest.mark.unit
def test_face_detect_no_face_fixture_empty_detections_raises(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """No-face fixture + empty detection list → FaceNotDetectedError.

    Some MediaPipe versions return an empty list rather than ``None`` for
    the zero-face case. Both sentinel forms must produce the same error.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=())
    no_face_image = _make_no_face_fixture()

    with pytest.raises(FaceNotDetectedError):
        face_detect(no_face_image)


@pytest.mark.unit
def test_face_detect_no_face_error_is_value_error_subclass(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """FaceNotDetectedError must be a ValueError subclass (permanent-error taxonomy).

    Phase 4 HTTP layer relies on the subclass relationship to map
    FaceNotDetectedError → HTTP 422 and distinguish it from other
    ValueError subclasses → HTTP 400.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    no_face_image = _make_no_face_fixture()

    with pytest.raises(FaceNotDetectedError) as exc_info:
        face_detect(no_face_image)

    assert isinstance(exc_info.value, ValueError), (
        "FaceNotDetectedError must subclass ValueError for the permanent-error "
        "taxonomy (HTTP 422 mapping at the Phase 4 layer)"
    )


@pytest.mark.unit
def test_face_detect_no_face_error_message_is_sanitized(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """FaceNotDetectedError message must not contain PII identifier tokens.

    Phase 3.1 PII-safety rule: error messages must describe the *shape*
    of the failure only — no caller-side identifiers. The rejected tokens
    are drawn from the Phase 0.x PII allow-list.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)

    with pytest.raises(FaceNotDetectedError) as exc_info:
        face_detect(_make_no_face_fixture())

    message = str(exc_info.value)
    forbidden = (
        "distinct_id",
        "transaction_id",
        "receipt_token",
        "customer_email",
        "selfieUri",
    )
    for token in forbidden:
        assert token not in message, (
            f"FaceNotDetectedError message leaked PII identifier {token!r}: "
            f"{message!r}"
        )


# ===========================================================================
# Section 2 — Normal (face) image fixture: FaceBoundingBox contract
# ===========================================================================


@pytest.mark.unit
def test_face_detect_face_fixture_returns_face_bounding_box(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Normal selfie fixture with face → returns FaceBoundingBox.

    On a 128×128 image with a detection at xmin=0.25, ymin=0.10,
    width=0.50, height=0.60 the expected pixel box is:

        x = round(0.25 * 128) = 32
        y = round(0.10 * 128) = 13
        w = round(0.50 * 128) = 64
        h = round(0.60 * 128) = 77
    """
    detection = _make_fake_detection(xmin=0.25, ymin=0.10, width=0.50, height=0.60)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))
    face_image = _make_face_selfie_fixture()

    result = face_detect(face_image)

    assert isinstance(
        result, FaceBoundingBox
    ), f"face_detect must return FaceBoundingBox, got {type(result).__name__}"
    assert result.x == 32
    assert result.y == 13
    assert result.width == 64
    assert result.height == 77


@pytest.mark.unit
def test_face_detect_face_fixture_bounding_box_fields_are_non_negative_integers(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """All FaceBoundingBox fields must be non-negative integers.

    ``x`` and ``y`` are ≥ 0; ``width`` and ``height`` are ≥ 1 (guaranteed
    by the clamping inside ``_detection_to_pixel_box``).
    """
    detection = _make_fake_detection(xmin=0.1, ymin=0.2, width=0.3, height=0.4)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))

    box = face_detect(_make_face_selfie_fixture())

    assert (
        isinstance(box.x, int) and box.x >= 0
    ), f"box.x must be int >= 0, got {box.x!r}"
    assert (
        isinstance(box.y, int) and box.y >= 0
    ), f"box.y must be int >= 0, got {box.y!r}"
    assert (
        isinstance(box.width, int) and box.width >= 1
    ), f"box.width must be int >= 1, got {box.width!r}"
    assert (
        isinstance(box.height, int) and box.height >= 1
    ), f"box.height must be int >= 1, got {box.height!r}"


@pytest.mark.unit
def test_face_detect_face_fixture_is_frozen_dataclass(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """FaceBoundingBox must be immutable (frozen dataclass).

    Immutability prevents accidental mutation in the generation pipeline
    when the same bounding box is threaded through multiple filter stages.
    """
    detection = _make_fake_detection(xmin=0.1, ymin=0.1, width=0.3, height=0.3)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))

    box = face_detect(_make_face_selfie_fixture())

    with pytest.raises((AttributeError, TypeError)):
        box.x = 999  # type: ignore[misc]


@pytest.mark.unit
def test_face_detect_face_fixture_repeated_calls_are_deterministic(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Same detector + same image → identical FaceBoundingBox every call.

    Non-determinism would break the identity-similarity scoring step in
    the automatic reject filter (same candidate → different bounding box
    → different similarity score across runs).
    """
    detection = _make_fake_detection(xmin=0.2, ymin=0.15, width=0.6, height=0.7)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))
    face_image = _make_face_selfie_fixture()

    first = face_detect(face_image)
    second = face_detect(face_image)
    third = face_detect(face_image)

    assert first == second == third, (
        "Repeated face_detect calls with the same detector and image must "
        "produce identical FaceBoundingBox — non-determinism would break "
        "the identity-similarity scoring in the reject filter."
    )


@pytest.mark.unit
def test_face_detect_face_fixture_multi_face_selects_largest(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """When multiple faces are present, face_detect picks the largest.

    On a 128×128 image with two faces:
      - small face: xmin=0.05, ymin=0.05, w=0.10, h=0.10  → 13×13 = 169 px²
      - large face: xmin=0.20, ymin=0.20, w=0.60, h=0.60  → 77×77 = 5929 px²

    The large face must win regardless of the detection list order.
    """
    small = _make_fake_detection(xmin=0.05, ymin=0.05, width=0.10, height=0.10)
    large = _make_fake_detection(xmin=0.20, ymin=0.20, width=0.60, height=0.60)

    for detections in [(small, large), (large, small)]:
        face_detector._CACHE.detector = _FakeDetector(detections=tuple(detections))
        box = face_detect(_make_face_selfie_fixture())
        # Large face pixel coords on 128×128:
        #   x = round(0.20 * 128) = 26
        #   y = round(0.20 * 128) = 26
        #   w = round(0.60 * 128) = 77
        #   h = round(0.60 * 128) = 77
        assert box.x == 26, f"Expected x=26 (large face), got {box.x}"
        assert box.y == 26, f"Expected y=26 (large face), got {box.y}"
        assert box.width == 77, f"Expected width=77 (large face), got {box.width}"
        assert box.height == 77, f"Expected height=77 (large face), got {box.height}"


# ===========================================================================
# Section 3 — Structural validation: face_detect vs detect_face_regions
# ===========================================================================


@pytest.mark.unit
def test_face_detect_returns_bounding_box_not_face_regions(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """face_detect must return FaceBoundingBox, not FaceRegions.

    The two functions are co-located in the same module but serve
    different callers. Returning the wrong type would silently break the
    identity-similarity scoring step that expects raw pixel geometry.
    """
    from personal_color.region_extractor import FaceRegions

    detection = _make_fake_detection(xmin=0.1, ymin=0.1, width=0.4, height=0.4)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))

    result = face_detect(_make_face_selfie_fixture())

    assert not isinstance(
        result, FaceRegions
    ), "face_detect must NOT return FaceRegions — use detect_face_regions for that"
    assert isinstance(result, FaceBoundingBox)


@pytest.mark.unit
def test_face_detect_empty_image_raises_value_error_not_face_not_detected(
    reset_detector_cache: None,
) -> None:
    """An empty image is rejected structurally before detector runs.

    Empty images must raise plain ValueError (HTTP 400 at Phase 4 layer),
    not FaceNotDetectedError (HTTP 422). The two failure modes are distinct
    from the caller's perspective.
    """
    with pytest.raises(ValueError) as exc_info:
        face_detect([])

    assert not isinstance(
        exc_info.value, FaceNotDetectedError
    ), "Empty image must raise plain ValueError, not FaceNotDetectedError"


@pytest.mark.unit
def test_face_detect_zero_width_image_raises_value_error(
    reset_detector_cache: None,
) -> None:
    """A zero-column image is a structural input error, not 'no face'."""
    with pytest.raises(ValueError) as exc_info:
        face_detect([[]])

    assert not isinstance(
        exc_info.value, FaceNotDetectedError
    ), "Zero-column image must raise plain ValueError, not FaceNotDetectedError"


# ===========================================================================
# Section 4 — Integration tests: PNG fixture → decode_image → face_detect
#
# These tests require Pillow (for decode_image) and are marked integration.
# The MediaPipe detector is still stubbed so they do NOT require mediapipe.
# This exercises the full "bytes → pixel array → face_detect" path.
# ===========================================================================


@pytest.mark.integration
def test_face_detect_no_face_png_fixture_raises_with_stubbed_detector(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Load the no_face.png fixture, decode it, and verify FaceNotDetectedError.

    Exercises the full bytes → pixel array → face_detect path using the
    fixture file. MediaPipe is still stubbed (returns zero detections) so
    this is a Pillow-only integration test.
    """
    pytest.importorskip("PIL", reason="Pillow required to load PNG fixture")
    from personal_color.image_decoder import decode_image

    no_face_png_path = _FIXTURES_DIR / "no_face.png"
    if not no_face_png_path.exists():
        pytest.skip(f"Fixture not found: {no_face_png_path}")

    pixel_array = decode_image(no_face_png_path.read_bytes())
    face_detector._CACHE.detector = _FakeDetector(detections=None)

    with pytest.raises(FaceNotDetectedError):
        face_detect(pixel_array)


@pytest.mark.integration
def test_face_detect_face_selfie_png_fixture_returns_bounding_box_with_stubbed_detector(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Load the face_selfie.png fixture, decode it, and verify FaceBoundingBox.

    Exercises the full bytes → pixel array → face_detect path using the
    fixture file. MediaPipe is stubbed to return a known detection on the
    128×128 fixture image.
    """
    pytest.importorskip("PIL", reason="Pillow required to load PNG fixture")
    from personal_color.image_decoder import decode_image

    selfie_png_path = _FIXTURES_DIR / "face_selfie.png"
    if not selfie_png_path.exists():
        pytest.skip(f"Fixture not found: {selfie_png_path}")

    pixel_array = decode_image(selfie_png_path.read_bytes())
    # The fixture is 128×128; stub returns a face covering the central area.
    detection = _make_fake_detection(xmin=0.25, ymin=0.10, width=0.50, height=0.60)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))

    result = face_detect(pixel_array)

    assert isinstance(result, FaceBoundingBox)
    assert result.width >= 1 and result.height >= 1


@pytest.mark.integration
def test_face_detect_real_mediapipe_no_face_png_raises(
    reset_detector_cache: None,
) -> None:
    """Real MediaPipe over no_face.png → FaceNotDetectedError.

    End-to-end wiring: load the fixture via decode_image, build the real
    MediaPipe detector, and verify the no-face path. This test owns the
    integration slot that ``test_face_detector.py`` reserved for AC 1.

    Requires: ``PIL``, ``mediapipe``, ``numpy``.
    """
    pytest.importorskip("PIL", reason="Pillow required")
    pytest.importorskip("mediapipe", reason="mediapipe required")
    pytest.importorskip("numpy", reason="numpy required")
    from personal_color.image_decoder import decode_image

    no_face_png_path = _FIXTURES_DIR / "no_face.png"
    if not no_face_png_path.exists():
        pytest.skip(f"Fixture not found: {no_face_png_path}")

    pixel_array = decode_image(no_face_png_path.read_bytes())

    with pytest.raises(FaceNotDetectedError):
        face_detect(pixel_array)
