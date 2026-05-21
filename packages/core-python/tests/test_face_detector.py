"""Tests for the MediaPipe face-detection boundary (`face_detector.py`).

The boundary file owns:

  - the lazy MediaPipe lifecycle (model loaded on first call, cached),
  - the deterministic multi-face tie-breaking,
  - the `FaceNotDetectedError` permanent-input contract that the Phase 4
    HTTP server maps to **422 Unprocessable Entity**.

This file focuses on the FaceNotDetectedError contract (AC 4): when
MediaPipe runs cleanly but reports zero faces, the detector MUST raise
`FaceNotDetectedError`, and the error message MUST be free of any of
the PII identifiers documented in the runtime constraints.

The tests run without `mediapipe` or `numpy` installed by stubbing the
module-level detector cache directly. That preserves the Phase 0.x
regression baseline (existing primitive tests remain dependency-free)
and keeps the unit suite fast.

Tests that *require* a live MediaPipe install (real detector
construction, on-bytes inference) live in this file too and are
marked `@pytest.mark.integration` per the runtime ontology so the
default CI lane stays green even when the native deps are absent.
"""

from __future__ import annotations

import itertools
import re
from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from personal_color import face_detector
from personal_color.face_detector import (
    FaceNotDetectedError,
    detect_face_regions,
)
from personal_color.region_extractor import FaceRegions, Region

# ---------------------------------------------------------------------------
# Helpers — fake MediaPipe detector + numpy stub injection.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _FakeDetections:
    """Mimics MediaPipe's `FaceDetectorResult` — only `.detections` matters."""

    detections: tuple[Any, ...]


class _FakeDetector:
    """Drop-in stub for `mediapipe.solutions.face_detection.FaceDetection`.

    `process()` returns a result whose `.detections` attribute is the
    list configured at construction time. `None` means "no faces" —
    the same shape MediaPipe uses when the model emits zero results.
    """

    def __init__(self, detections: tuple[Any, ...] | None) -> None:
        # Match MediaPipe's actual shape: `.detections` is either a
        # list of Detection objects or `None`. Both are sentinel forms
        # for "zero faces" — the production code must treat them
        # equivalently.
        self._detections = detections

    def process(self, _frame: Any) -> _FakeDetections | object:
        if self._detections is None:
            # MediaPipe returns a result whose `.detections` is None
            # when there were no faces. Mirror that exactly.
            result = type("FakeResult", (), {"detections": None})()
            return result
        return _FakeDetections(detections=self._detections)


@pytest.fixture
def reset_detector_cache() -> Iterator[None]:
    """Ensure each test starts with a fresh detector cache."""
    face_detector._reset_detector_cache_for_tests()
    yield
    face_detector._reset_detector_cache_for_tests()


@pytest.fixture
def stub_numpy(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub `_import_numpy` so the detector path works without numpy.

    The fake `numpy` only needs `np.array(image, dtype=np.uint8)` to
    return *something* the fake detector accepts — content is opaque.
    """

    class _FakeNumpy:
        uint8 = "uint8"

        @staticmethod
        def array(image: Any, dtype: Any = None) -> Any:
            # Returning the original image is fine — the fake detector
            # doesn't inspect its argument.
            return image

    monkeypatch.setattr(face_detector, "_import_numpy", lambda: _FakeNumpy)


def _make_3x3_black_image() -> list[list[tuple[int, int, int]]]:
    """Smallest non-empty rectangular image satisfying the validator."""
    return [[(0, 0, 0)] * 3 for _ in range(3)]


# ---------------------------------------------------------------------------
# AC 4: FaceNotDetectedError raised when MediaPipe returns 0 faces.
# ---------------------------------------------------------------------------


def test_zero_faces_via_none_detections_raises_face_not_detected_error(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """MediaPipe's `.detections is None` sentinel must raise FaceNotDetectedError.

    MediaPipe returns a result object whose `.detections` attribute is
    `None` when the model emits zero detections. The boundary file
    must treat that as the permanent "no face" case.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    image = _make_3x3_black_image()

    with pytest.raises(FaceNotDetectedError):
        detect_face_regions(image)


def test_zero_faces_via_empty_tuple_raises_face_not_detected_error(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """An explicitly empty detection list must also raise FaceNotDetectedError.

    Different MediaPipe versions can emit either `None` or an empty
    sequence for the no-face case. Both must surface as the same
    permanent input error so downstream HTTP mapping is uniform.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=())
    image = _make_3x3_black_image()

    with pytest.raises(FaceNotDetectedError):
        detect_face_regions(image)


def test_face_not_detected_error_is_value_error_subclass() -> None:
    """The error must subclass ValueError for the permanent-error taxonomy.

    Phase 0.x diagnosis primitives use ValueError to mean "permanent
    input failure". Phase 4 HTTP layer relies on the subclass
    relationship to map FaceNotDetectedError → 422 distinct from
    other ValueError subclasses → 400.
    """
    assert issubclass(FaceNotDetectedError, ValueError)


def test_face_not_detected_error_message_omits_pii_identifiers(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """The error message MUST NOT contain any of the forbidden PII tokens.

    Constraint: diagnostic logs and exception messages must not
    contain the literal identifiers `distinct_id`, `transaction_id`,
    `receipt_token`, `customer_email`, `selfieUri`. A regression here
    would leak request-scoped identifiers into shared error sinks.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    image = _make_3x3_black_image()

    with pytest.raises(FaceNotDetectedError) as exc_info:
        detect_face_regions(image)

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


def test_face_not_detected_error_message_is_human_readable(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """The error message should describe the *shape* of the failure.

    Not testing exact wording (that would be brittle), but verifying
    the message is non-empty and mentions the relevant concept
    ('face' or 'detect') so on-call engineers can triage without
    cross-referencing the source.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    image = _make_3x3_black_image()

    with pytest.raises(FaceNotDetectedError) as exc_info:
        detect_face_regions(image)

    message = str(exc_info.value)
    assert message, "FaceNotDetectedError must carry a non-empty message"
    assert re.search(
        r"face|detect", message, re.IGNORECASE
    ), f"Error message should mention 'face' or 'detect': {message!r}"


def test_face_not_detected_distinct_from_other_value_errors(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Catching ValueError must catch FaceNotDetectedError, but the
    *specific* subclass is what enables the 422 mapping at the HTTP
    layer. A wider `except ValueError` must not lose the type.
    """
    face_detector._CACHE.detector = _FakeDetector(detections=None)
    image = _make_3x3_black_image()

    caught: ValueError | None = None
    try:
        detect_face_regions(image)
    except ValueError as exc:
        caught = exc

    assert isinstance(caught, FaceNotDetectedError), (
        "FaceNotDetectedError must remain its concrete subclass when "
        "caught via the parent ValueError handler",
    )


# ---------------------------------------------------------------------------
# Boundary checks that are part of the FaceNotDetectedError contract but
# do not require a fake detector — they fail before the detector runs.
# ---------------------------------------------------------------------------


def test_empty_image_raises_plain_value_error_not_face_not_detected(
    reset_detector_cache: None,
) -> None:
    """An empty image is an *input* error, not a 'no face detected' error.

    Important to distinguish: an empty image should be rejected
    structurally (ValueError, mapped to 400 by Phase 4) rather than
    surfaced as a 'no face detected' 422. Otherwise the API conflates
    two distinct failure modes for the caller.
    """
    with pytest.raises(ValueError) as exc_info:
        detect_face_regions([])

    assert not isinstance(exc_info.value, FaceNotDetectedError), (
        "Empty image must raise plain ValueError, not FaceNotDetectedError",
    )


def test_zero_width_image_raises_plain_value_error_not_face_not_detected(
    reset_detector_cache: None,
) -> None:
    """A zero-column image is a structural input error, not 'no face'."""
    with pytest.raises(ValueError) as exc_info:
        detect_face_regions([[]])

    assert not isinstance(exc_info.value, FaceNotDetectedError), (
        "Zero-column image must raise plain ValueError, not " "FaceNotDetectedError",
    )


# ---------------------------------------------------------------------------
# AC 16: Deterministic multi-face tie-breaking.
#
# Rule (documented in the face_detector module docstring):
#
#   1. Largest bounding-box area wins.
#   2. On exact area tie, topmost (smallest y) wins.
#   3. On further tie, leftmost (smallest x) wins.
#
# The contract is "same input → same DiagnosisResult, always" — Phase 4
# clients must not see different season classifications across retries of
# a non-mutating selfie payload. We exercise this property by permuting
# the MediaPipe detection list (MediaPipe makes no public ordering
# guarantee) and asserting that the boundary's selected face — and hence
# the derived FaceRegions — is byte-identical across every permutation.
#
# The fake detection objects mirror the slice of MediaPipe's `Detection`
# API the boundary actually touches:
# `detection.location_data.relative_bounding_box.{xmin,ymin,width,height}`.
# A `SimpleNamespace` tree is the lightest-weight stand-in for that
# attribute structure and keeps these tests free of any native deps.
# ---------------------------------------------------------------------------


def _make_fake_detection(
    *, xmin: float, ymin: float, width: float, height: float
) -> Any:
    """Build a SimpleNamespace mimicking MediaPipe's Detection shape.

    Only the four leaf floats on
    `detection.location_data.relative_bounding_box` are read by
    `_detection_to_pixel_box`, so a nested namespace is sufficient and
    avoids depending on MediaPipe's protobuf-generated classes (which
    aren't available in the default CI lane).
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


def _make_100x100_black_image() -> list[list[tuple[int, int, int]]]:
    """100x100 black image — math-friendly for relative→pixel conversion.

    With this size, every `0.0-1.0` relative coordinate that uses a
    single decimal place lands on an exact integer pixel, so the
    expected `Region` values below are easy to verify by inspection
    and aren't sensitive to floating-point rounding.
    """
    return [[(0, 0, 0)] * 100 for _ in range(100)]


def test_tie_breaking_largest_area_wins_across_all_permutations(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """The largest face is selected regardless of MediaPipe's detection order.

    MediaPipe's Python API documents no ordering guarantee for the
    detections list. The runtime contract — same input → same output —
    therefore demands that the boundary impose its own deterministic
    selection. We verify by feeding every permutation of three faces of
    distinct sizes and asserting all permutations yield the *same*
    FaceRegions (frozen-dataclass equality on every leaf field).
    """
    small_face = _make_fake_detection(
        xmin=0.1, ymin=0.1, width=0.1, height=0.1
    )  # area=10*10=100 px²
    medium_face = _make_fake_detection(
        xmin=0.3, ymin=0.3, width=0.2, height=0.2
    )  # area=20*20=400 px²
    large_face = _make_fake_detection(
        xmin=0.5, ymin=0.5, width=0.4, height=0.4
    )  # area=40*40=1600 px²

    image = _make_100x100_black_image()
    results: list[FaceRegions] = []
    for permutation in itertools.permutations((small_face, medium_face, large_face)):
        face_detector._CACHE.detector = _FakeDetector(detections=permutation)
        results.append(detect_face_regions(image))

    # All 6 permutations must yield byte-identical FaceRegions.
    first = results[0]
    for index, result in enumerate(results[1:], start=1):
        assert result == first, (
            "Permutation #%d produced a different FaceRegions than #0 — "
            "tie-breaking is not deterministic across detection order." % index
        )

    # The selected face must be the *largest* (xmin=0.5, ymin=0.5, 40×40).
    # Skin region derivation in `_bbox_to_face_regions`:
    #   skin_x = 50 + 40//4 = 60
    #   skin_y = 50 + (40*4)//10 = 66
    #   skin_w = max(1, 40//2) = 20
    #   skin_h = max(1, 40//2) = 20
    # All values land inside the 100x100 frame so no clamping kicks in.
    assert first.skin == Region(x=60, y=66, width=20, height=20)


def test_tie_breaking_equal_area_topmost_y_wins_across_permutations(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """On exact area tie, the topmost (smallest y) face is selected.

    This is the second tier of the tie-break rule. We construct two
    faces with identical bounding-box area but different y positions,
    then verify the boundary picks the top one regardless of detection
    order. Without this rule, MediaPipe ordering jitter would surface
    as flaky diagnoses for selfies containing a partial second face.
    """
    top_face = _make_fake_detection(
        xmin=0.5, ymin=0.1, width=0.2, height=0.2
    )  # (50, 10, 20, 20), area=400
    bottom_face = _make_fake_detection(
        xmin=0.5, ymin=0.5, width=0.2, height=0.2
    )  # (50, 50, 20, 20), area=400

    image = _make_100x100_black_image()
    results: list[FaceRegions] = []
    for permutation in itertools.permutations((top_face, bottom_face)):
        face_detector._CACHE.detector = _FakeDetector(detections=permutation)
        results.append(detect_face_regions(image))

    # Both orderings yield identical output.
    assert results[0] == results[1]

    # And the chosen geometry corresponds to the *top* face (y=10).
    #   skin_x = 50 + 20//4 = 55
    #   skin_y = 10 + (20*4)//10 = 18
    #   skin_w = max(1, 20//2) = 10
    #   skin_h = max(1, 20//2) = 10
    assert results[0].skin == Region(x=55, y=18, width=10, height=10)


def test_tie_breaking_equal_area_and_y_leftmost_x_wins_across_permutations(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """On (area, y) tie, the leftmost (smallest x) face is selected.

    Third and final tier of the tie-break rule — included so the
    deterministic order is *total* (no ties left to resolve). Two
    faces with identical area and identical y coordinate must
    resolve in favour of the one with the smaller x. We feed both
    orderings and verify the result is identical and matches the
    left face's geometry.
    """
    left_face = _make_fake_detection(
        xmin=0.1, ymin=0.5, width=0.2, height=0.2
    )  # (10, 50, 20, 20), area=400
    right_face = _make_fake_detection(
        xmin=0.7, ymin=0.5, width=0.2, height=0.2
    )  # (70, 50, 20, 20), area=400

    image = _make_100x100_black_image()
    results: list[FaceRegions] = []
    for permutation in itertools.permutations((left_face, right_face)):
        face_detector._CACHE.detector = _FakeDetector(detections=permutation)
        results.append(detect_face_regions(image))

    # Both orderings yield identical output.
    assert results[0] == results[1]

    # And the chosen geometry corresponds to the *left* face (x=10).
    #   skin_x = 10 + 20//4 = 15
    #   skin_y = 50 + (20*4)//10 = 58
    #   skin_w = max(1, 20//2) = 10
    #   skin_h = max(1, 20//2) = 10
    assert results[0].skin == Region(x=15, y=58, width=10, height=10)


def test_repeated_calls_same_input_yield_identical_face_regions(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Same detector + same image → byte-identical FaceRegions every call.

    Beyond tie-breaking, this guards against *any* hidden per-call
    state (e.g. accidental reliance on `id()` ordering or a cached
    random seed) that would make the runtime non-deterministic. The
    diagnose_runtime layer relies on this property to guarantee
    "same selfie → same season" to the Phase 4 HTTP server.
    """
    detections = (
        _make_fake_detection(xmin=0.1, ymin=0.1, width=0.1, height=0.1),
        _make_fake_detection(xmin=0.5, ymin=0.5, width=0.4, height=0.4),
        _make_fake_detection(xmin=0.3, ymin=0.3, width=0.2, height=0.2),
    )
    face_detector._CACHE.detector = _FakeDetector(detections=detections)
    image = _make_100x100_black_image()

    first = detect_face_regions(image)
    second = detect_face_regions(image)
    third = detect_face_regions(image)

    assert first == second == third, (
        "Repeated detect_face_regions calls with the same detector and "
        "image must produce byte-identical FaceRegions — non-determinism "
        "would break the 'same selfie → same season' runtime contract."
    )


def test_tie_breaking_pure_area_dominates_y_and_x(
    reset_detector_cache: None,
    stub_numpy: None,
) -> None:
    """Area is the *primary* key — a larger face wins even if it's
    further down and further right than a smaller one.

    Guards against an accidental sort-key re-ordering where (y, x)
    leaks ahead of area. A smaller face placed at (0, 0) (the
    'topmost-leftmost' tie-break winner if area were equal) must
    NOT be selected over a larger face placed anywhere else.
    """
    # Top-left tiny face — would win on (y, x) but loses on area.
    tiny_top_left = _make_fake_detection(
        xmin=0.0, ymin=0.0, width=0.05, height=0.05
    )  # (0, 0, 5, 5), area=25
    # Bottom-right large face — wins by area despite worse (y, x).
    large_bottom_right = _make_fake_detection(
        xmin=0.5, ymin=0.5, width=0.4, height=0.4
    )  # (50, 50, 40, 40), area=1600

    image = _make_100x100_black_image()
    results: list[FaceRegions] = []
    for permutation in itertools.permutations((tiny_top_left, large_bottom_right)):
        face_detector._CACHE.detector = _FakeDetector(detections=permutation)
        results.append(detect_face_regions(image))

    assert results[0] == results[1]
    # Selected face is the *large* bottom-right one — same geometry as
    # in the largest-area-wins test above.
    assert results[0].skin == Region(x=60, y=66, width=20, height=20)


# ---------------------------------------------------------------------------
# Integration tier — requires the real MediaPipe install. Skipped by
# default to keep the Phase 0.x regression baseline green when mediapipe
# is uninstalled. Mirrors the `pytest.mark.integration` convention used
# elsewhere in the codebase for native-dep tests.
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_real_mediapipe_zero_face_image_raises_face_not_detected(
    reset_detector_cache: None,
) -> None:
    """End-to-end: real MediaPipe over a plain monochrome image → no face.

    Builds the real detector (no fakes) and feeds it a blank gray
    canvas. MediaPipe should return zero detections; the boundary
    must surface that as FaceNotDetectedError. This is the production
    contract — the unit tests above prove the *boundary logic*; this
    one proves the wiring to the real native library.
    """
    pytest.importorskip("mediapipe")
    pytest.importorskip("numpy")

    # A 128x128 mid-gray image — no face geometry whatsoever.
    image = [[(128, 128, 128)] * 128 for _ in range(128)]

    with pytest.raises(FaceNotDetectedError):
        detect_face_regions(image)


@pytest.mark.integration
def test_real_mediapipe_returns_face_regions_for_detected_face() -> None:
    """Sanity: if MediaPipe *does* detect a face, we get back FaceRegions.

    This test is intentionally tolerant — it just verifies the happy
    path returns the right shape, not the exact pixel geometry.
    Skipped when mediapipe (or a representative selfie fixture) is
    unavailable, which is the expected state in the default CI lane.
    """
    pytest.importorskip("mediapipe")
    pytest.importorskip("numpy")
    # The fixture-image plumbing is out of scope for AC 4; this guard
    # documents the intent and skips cleanly when the asset is absent.
    pytest.skip("real-selfie fixture wiring is owned by AC 1 integration tests")
    # Unreachable under the skip, but kept so the call site type-checks.
    image: list[list[tuple[int, int, int]]] = []
    result = detect_face_regions(image)
    assert isinstance(result, FaceRegions)
