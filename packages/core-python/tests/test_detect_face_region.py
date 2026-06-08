"""Unit tests for ``detect_face_region`` — Sub-AC 17-1a.

Verifies that :func:`~personal_color.face_detector.detect_face_region`
satisfies its contract:

  1. Returns a :class:`~personal_color.face_detector.FaceBoundingBox`
     with valid pixel coordinates when a synthetic face image is processed
     and the detector finds exactly one face.
  2. Returns ``None`` when the detector finds zero faces (no-face image).

Both scenarios use in-memory synthetic pixel arrays and a stubbed detector
so neither ``mediapipe`` nor ``numpy`` need to be installed for the unit
test tier to pass.

Terminology note
----------------
``detect_face_region`` (singular, no 's') is the *soft-failure* variant of
the existing :func:`~personal_color.face_detector.face_detect` function. It
returns ``None`` instead of raising
:class:`~personal_color.face_detector.FaceNotDetectedError`, making it
suitable as a gate step inside the generation-pipeline reject filter where the
caller wants a branch on presence/absence rather than exception handling.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from personal_color import face_detector
from personal_color.face_detector import (
    FaceBoundingBox,
    FaceNotDetectedError,
    detect_face_region,
)

# ---------------------------------------------------------------------------
# Shared stubs — same pattern as test_face_detect.py for consistency.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _FakeDetections:
    """Mimics MediaPipe's ``FaceDetectorResult``."""

    detections: tuple[Any, ...]


class _FakeDetector:
    """Drop-in stub for ``mediapipe.solutions.face_detection.FaceDetection``.

    ``process()`` returns a result whose ``.detections`` is either ``None``
    (zero-face MediaPipe sentinel) or a tuple of fake detection objects.
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
# Synthetic pixel array helpers.
# ---------------------------------------------------------------------------


def _make_no_face_fixture() -> list[list[tuple[int, int, int]]]:
    """128×128 mid-grey image — models a plain background / no-face photo."""
    grey = (180, 180, 180)
    return [[grey] * 128 for _ in range(128)]


def _make_face_selfie_fixture() -> list[list[tuple[int, int, int]]]:
    """128×128 warm-toned image — models a selfie with a face.

    Pixel content is opaque to the unit tests; the stubbed detector decides
    the outcome based on what detection objects it was initialised with.
    """
    warm_skin = (220, 185, 150)
    return [[warm_skin] * 128 for _ in range(128)]


def _make_fake_detection(
    *, xmin: float, ymin: float, width: float, height: float
) -> Any:
    """Build a ``SimpleNamespace`` mimicking MediaPipe's ``Detection`` shape."""
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
# Section 1 — No-face image: detect_face_region returns None
# ===========================================================================


@pytest.mark.unit
def test_detect_face_region_no_face_none_detections_returns_none(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """No-face image + ``detections=None`` sentinel → returns ``None``.

    MediaPipe's ``None`` sentinel for zero detections must cause
    ``detect_face_region`` to return ``None``, not raise an exception.
    This is the key contract difference from ``face_detect``.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    no_face_image = _make_no_face_fixture()

    result = detect_face_region(no_face_image)

    assert (
        result is None
    ), f"detect_face_region must return None when no face is found, got {result!r}"


@pytest.mark.unit
def test_detect_face_region_no_face_empty_detections_returns_none(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """No-face image + empty detection list → returns ``None``.

    Some MediaPipe versions return an empty list rather than ``None`` for
    the zero-face case. Both sentinel forms must produce ``None``.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=())
    no_face_image = _make_no_face_fixture()

    result = detect_face_region(no_face_image)

    assert (
        result is None
    ), f"detect_face_region must return None for empty detections, got {result!r}"


@pytest.mark.unit
def test_detect_face_region_no_face_does_not_raise_face_not_detected_error(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """No-face image must NOT raise FaceNotDetectedError.

    ``detect_face_region`` is the soft-failure variant: callers expect a
    ``None`` return value, not an exception, so they can branch without
    try/except.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    no_face_image = _make_no_face_fixture()

    try:
        result = detect_face_region(no_face_image)
    except FaceNotDetectedError:
        pytest.fail(
            "detect_face_region must not raise FaceNotDetectedError; "
            "it is the soft-failure variant that returns None instead."
        )
    else:
        assert result is None


# ===========================================================================
# Section 2 — Synthetic face image: detect_face_region returns FaceBoundingBox
# ===========================================================================


@pytest.mark.unit
def test_detect_face_region_face_fixture_returns_face_bounding_box(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Synthetic face image → returns a ``FaceBoundingBox`` (not None).

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

    result = detect_face_region(face_image)

    assert (
        result is not None
    ), "detect_face_region must return FaceBoundingBox when a face is found"
    assert isinstance(
        result, FaceBoundingBox
    ), f"detect_face_region must return FaceBoundingBox, got {type(result).__name__}"


@pytest.mark.unit
def test_detect_face_region_face_fixture_returns_correct_pixel_coordinates(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Synthetic face image → bounding box coordinates match expected pixel values.

    On a 128×128 image with a detection at xmin=0.25, ymin=0.10,
    width=0.50, height=0.60:

        x = round(0.25 * 128) = 32
        y = round(0.10 * 128) = 13
        w = round(0.50 * 128) = 64
        h = round(0.60 * 128) = 77
    """
    detection = _make_fake_detection(xmin=0.25, ymin=0.10, width=0.50, height=0.60)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))
    face_image = _make_face_selfie_fixture()

    result = detect_face_region(face_image)

    assert result is not None
    assert result.x == 32, f"Expected x=32, got {result.x}"
    assert result.y == 13, f"Expected y=13, got {result.y}"
    assert result.width == 64, f"Expected width=64, got {result.width}"
    assert result.height == 77, f"Expected height=77, got {result.height}"


@pytest.mark.unit
def test_detect_face_region_bounding_box_fields_are_non_negative_integers(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """All FaceBoundingBox fields must be non-negative integers.

    ``x`` and ``y`` are ≥ 0; ``width`` and ``height`` are ≥ 1 (guaranteed
    by the clamping inside ``_detection_to_pixel_box``).
    """
    detection = _make_fake_detection(xmin=0.1, ymin=0.2, width=0.3, height=0.4)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))

    result = detect_face_region(_make_face_selfie_fixture())

    assert result is not None
    assert (
        isinstance(result.x, int) and result.x >= 0
    ), f"box.x must be int >= 0, got {result.x!r}"
    assert (
        isinstance(result.y, int) and result.y >= 0
    ), f"box.y must be int >= 0, got {result.y!r}"
    assert (
        isinstance(result.width, int) and result.width >= 1
    ), f"box.width must be int >= 1, got {result.width!r}"
    assert (
        isinstance(result.height, int) and result.height >= 1
    ), f"box.height must be int >= 1, got {result.height!r}"


@pytest.mark.unit
def test_detect_face_region_result_is_frozen_dataclass(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """FaceBoundingBox returned by detect_face_region must be immutable.

    Immutability prevents accidental mutation when the same bounding box is
    threaded through multiple generation-pipeline filter stages.
    """
    detection = _make_fake_detection(xmin=0.1, ymin=0.1, width=0.3, height=0.3)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))

    result = detect_face_region(_make_face_selfie_fixture())

    assert result is not None
    with pytest.raises((AttributeError, TypeError)):
        result.x = 999  # type: ignore[misc]


@pytest.mark.unit
def test_detect_face_region_repeated_calls_are_deterministic(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Same detector + same image → identical FaceBoundingBox every call.

    Non-determinism would break identity-similarity scoring in the reject
    filter (same candidate → different bounding box → different score).
    """
    detection = _make_fake_detection(xmin=0.2, ymin=0.15, width=0.6, height=0.7)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))
    face_image = _make_face_selfie_fixture()

    first = detect_face_region(face_image)
    second = detect_face_region(face_image)
    third = detect_face_region(face_image)

    assert first == second == third, (
        "Repeated detect_face_region calls with the same detector and image must "
        "produce identical FaceBoundingBox — non-determinism breaks the "
        "identity-similarity scoring in the reject filter."
    )


# ===========================================================================
# Section 3 — Structural validation: invalid image shape raises ValueError
# ===========================================================================


@pytest.mark.unit
def test_detect_face_region_empty_image_raises_value_error(
    reset_detector_cache: None,
) -> None:
    """An empty image is rejected structurally before the detector runs.

    Structural failures must raise plain ``ValueError`` (HTTP 400 at
    Phase 4), not return ``None`` (which would falsely imply "valid input,
    no face found").
    """
    with pytest.raises(ValueError) as exc_info:
        detect_face_region([])

    assert not isinstance(
        exc_info.value, FaceNotDetectedError
    ), "Empty image must raise plain ValueError, not FaceNotDetectedError"


@pytest.mark.unit
def test_detect_face_region_zero_width_image_raises_value_error(
    reset_detector_cache: None,
) -> None:
    """A zero-column image is a structural input error, must not return None."""
    with pytest.raises(ValueError) as exc_info:
        detect_face_region([[]])

    assert not isinstance(
        exc_info.value, FaceNotDetectedError
    ), "Zero-column image must raise plain ValueError, not FaceNotDetectedError"


# ===========================================================================
# Section 4 — Return-type distinction: detect_face_region vs face_detect
# ===========================================================================


@pytest.mark.unit
def test_detect_face_region_and_face_detect_return_same_type_on_face_found(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Both detect_face_region and face_detect return FaceBoundingBox on success.

    The two functions share the same return type; only their no-face
    behaviour differs (None vs FaceNotDetectedError).
    """
    from personal_color.face_detector import face_detect

    detection = _make_fake_detection(xmin=0.2, ymin=0.2, width=0.4, height=0.4)
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))
    face_image = _make_face_selfie_fixture()

    region_result = detect_face_region(face_image)

    face_detector._reset_detector_cache_for_tests()
    face_detector._CACHE.detector = _FakeDetector(detections=(detection,))
    detect_result = face_detect(face_image)

    assert isinstance(region_result, FaceBoundingBox)
    assert isinstance(detect_result, FaceBoundingBox)
    assert region_result == detect_result, (
        "detect_face_region and face_detect must return equal FaceBoundingBox "
        "for the same input and detector stub."
    )


@pytest.mark.unit
def test_detect_face_region_returns_none_where_face_detect_raises(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Where face_detect raises FaceNotDetectedError, detect_face_region returns None.

    This is the fundamental contract difference between the two functions.
    """
    from personal_color.face_detector import face_detect

    no_face_image = _make_no_face_fixture()

    # face_detect raises
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    with pytest.raises(FaceNotDetectedError):
        face_detect(no_face_image)

    # detect_face_region returns None
    face_detector._reset_detector_cache_for_tests()
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    result = detect_face_region(no_face_image)
    assert result is None, (
        "detect_face_region must return None where face_detect raises "
        "FaceNotDetectedError — the two functions have the same no-face "
        "detection logic but different caller contracts."
    )
