"""MediaPipe face-detection boundary (Phase 0.x runtime wiring).

Single isolation point for the MediaPipe dependency: this is the *only*
production source file in `packages/core-python/src/` permitted to import
`mediapipe`. The constraint is verified by a grep test in the Phase 0.x
regression suite — a second match anywhere under `src/` should fail CI.

Why a single boundary file:

  - The personal-color diagnosis primitive stack (Sub-AC 10.1 / 10.2 /
    10.3 / 10.5) is intentionally free of binary / native dependencies so
    its test suite stays fast and portable. Wrapping MediaPipe in one
    file keeps that promise intact while still letting the production
    runtime (`diagnose_personal_color`) consume MediaPipe-derived face
    geometry through the existing `FaceRegions` contract.
  - A single seam makes the future swap to Face++ / on-device CoreML /
    a different MediaPipe model revision a 1-file change rather than a
    grep-and-replace across the diagnosis stack.

Lazy-load strategy:

  The `mediapipe` package is *not* imported at module import time. Two
  reasons:

    1. Phase 0.x regression baseline: the existing primitive tests
       (`test_region_extractor.py`, `test_tone_classifier.py`,
       `test_contrast_classifier.py`, `test_season_classifier.py`,
       `test_diagnosis_orchestrator.py`) must continue to pass without
       MediaPipe installed. Module-level `import mediapipe` would break
       any test that touches `personal_color/__init__.py` collection.
    2. Model construction cost: instantiating MediaPipe's
       `FaceDetection` solution loads a TFLite model from disk. Doing
       that at first-call time (rather than at import time) keeps
       process boot fast and lets the unit-test layer that injects a
       mock detector run with zero native overhead.

  The detector instance is cached at module scope after the first
  successful build, so subsequent `detect_face_regions` calls reuse it.

Error contract:

  - `FaceNotDetectedError` (ValueError subclass): MediaPipe ran cleanly
    but found zero faces in the image. Permanent input failure. Phase 4
    HTTP server MUST map this to **HTTP 422 Unprocessable Entity** — the
    request was syntactically valid (decodable bytes) but semantically
    unprocessable (no face geometry to diagnose).
  - All error messages are sanitized: they describe the *shape* of the
    failure ("no face detected", "image too small for detector") and
    never echo caller-side identifiers. The Phase 3.1 vendor-caller
    PII-safety rule applies here too — diagnostic logs and exception
    messages must not contain any caller-side identifier tokens from
    the Phase 3.1 PII allow-list (see security policy doc).

Multi-face tie-breaking:

  When MediaPipe returns more than one face, the runtime needs a fully
  deterministic selection rule so the same selfie always yields the
  same diagnosis. The rule is:

    1. Largest bounding-box area wins.
    2. On exact area tie, topmost (smallest y-coordinate) wins.
    3. On further tie, leftmost (smallest x-coordinate) wins.

  This is the same rule documented in the runtime ontology; the
  diagnose_runtime layer and the analytics tier rely on it being
  applied here, not duplicated downstream.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from personal_color.region_extractor import (
    FaceRegions,
    Image,
    Region,
)

if TYPE_CHECKING:  # pragma: no cover - import guard for type hints only
    # `mediapipe` is intentionally NOT imported at module import time
    # (see module docstring). The type-checker is allowed to see it so
    # the internal helper signatures remain strictly typed.
    pass


# ---------------------------------------------------------------------------
# Public types — exported as part of the boundary contract.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FaceBoundingBox:
    """Absolute-pixel bounding box for a detected face.

    Returned by :func:`face_detect` — the lower-level entry point that
    exposes the raw detection geometry before any sub-region derivation.

    Coordinates use a top-left origin (x grows right, y grows down).
    The face rectangle spans pixels ``[x, x+width) × [y, y+height)``.

    Usage contexts in the generation pipeline:

      * **Identity-similarity scoring**: rule-based face-landmark comparison
        (ontology's ``identity_similarity_score``) crops the candidate
        image to this box before computing the similarity metric.
      * **Reject filter**: confirms face presence in the generated candidate
        before the enhancer de-slop layer applies.
      * **Upstream recipe wiring**: the generation recipe (``generation_recipe``)
        may use the selfie's face geometry to tune the composition prompt.

    All fields are non-negative integers. ``width`` and ``height`` are
    guaranteed to be ≥ 1 (the detector and clamping logic in
    :func:`_detection_to_pixel_box` enforce this).
    """

    x: int
    y: int
    width: int
    height: int


# ---------------------------------------------------------------------------
# Error types — exported as part of the public boundary contract.
# ---------------------------------------------------------------------------


class FaceNotDetectedError(ValueError):
    """Raised when MediaPipe returns zero faces for the decoded image.

    Subclasses `ValueError` to slot into the existing Phase 0.x error
    taxonomy (permanent input failures are `ValueError` subclasses;
    transient vendor failures are separate). The Phase 4 HTTP layer
    maps this to **422 Unprocessable Entity**.

    Carries no caller-side identifiers in its message — the runtime is
    explicit about leaking zero PII into logs or error envelopes.
    """


# ---------------------------------------------------------------------------
# Internal cache for the lazily-built MediaPipe detector.
# ---------------------------------------------------------------------------


@dataclass
class _DetectorCache:
    """Module-scope cache for the MediaPipe FaceDetection instance.

    Held as a dataclass (rather than a bare global) so the test suite
    can clear it deterministically between runs without poking at
    underscore-prefixed module globals.
    """

    detector: Any | None = None


_CACHE = _DetectorCache()


def _reset_detector_cache_for_tests() -> None:
    """Test-only helper: drop the cached MediaPipe detector.

    Not part of the public boundary contract — kept here so the
    integration test suite can simulate "first call" lazy-load
    semantics without restarting the interpreter.
    """
    _CACHE.detector = None


# ---------------------------------------------------------------------------
# Public entry point.
# ---------------------------------------------------------------------------


def detect_face_regions(image: Image) -> FaceRegions:
    """Run MediaPipe face detection over `image` and return `FaceRegions`.

    This is the production default for the `_detector` callable
    parameter of `diagnose_personal_color`. Unit tests inject a stub
    callable matching this signature; this function exists so the
    production code path is reachable end-to-end from the first commit
    (no `NotImplementedError`, no pass-only body — see the Phase 3.1
    scaffold-gap lesson).

    Args:
        image: Decoded pixel data as a rows-first `Sequence[Sequence[RGB]]`
            (the `Image` type from `region_extractor`). Top-left origin.

    Returns:
        `FaceRegions` bundling skin / eyes / hair rectangles derived
        from the MediaPipe detection geometry for the selected face.

    Raises:
        FaceNotDetectedError: MediaPipe returned zero faces. Permanent
            input failure — Phase 4 HTTP server maps to **422**.
        ValueError: The image is empty, too small for the detector, or
            otherwise unprocessable in a way that is not specifically
            "zero faces" (e.g. zero-row image).
        RuntimeError: The `mediapipe` package is not installed in the
            current environment. Surfaced as a deployment error rather
            than as a per-request error — the Phase 4 server runs the
            full requirements set and should never see this in prod.
    """
    width, height = _validate_image_shape(image)

    detector = _get_or_build_detector()

    # Convert the pure-Python image into the numpy uint8 RGB array that
    # MediaPipe's Python API expects. `numpy` is a transitive dependency
    # of mediapipe, so this import is safe under the same "mediapipe is
    # installed" precondition we already checked above.
    np = _import_numpy()
    frame = np.array(image, dtype=np.uint8)

    results = detector.process(frame)
    detections = list(getattr(results, "detections", None) or ())

    if len(detections) == 0:
        # Sanitized message: describes the shape of the failure only.
        # Phase 4 server attaches its own request-scoped log fields
        # outside this exception; we deliberately leak nothing here.
        raise FaceNotDetectedError("no face detected in selfie")

    chosen = _select_face(detections, image_width=width, image_height=height)

    return _bbox_to_face_regions(
        chosen,
        image_width=width,
        image_height=height,
    )


def detect_face_region(image: Image) -> FaceBoundingBox | None:
    """Detect the primary face in ``image`` and return its pixel bounding box.

    Soft-failure variant of :func:`face_detect`. Returns ``None`` instead of
    raising :class:`FaceNotDetectedError` when no face is found. Useful as
    the first gate in the generation-pipeline reject filter where the caller
    wants a branch on presence/absence rather than exception handling.

    Pipeline placement (generation_pipeline ontology):
        raw_generation → enhancer_application → **reject_filtering** → user_pick

    The reject filter calls this function to confirm face presence in the
    generated candidate *after* the enhancer de-slop layer has run. A ``None``
    result causes the candidate to be marked ``rejected=True`` with
    ``rejected_by="face_region_absent"``.

    The tie-breaking rule for multi-face images is identical to
    :func:`detect_face_regions`:

        1. Largest bounding-box area wins.
        2. On exact area tie, topmost (smallest y-coordinate) wins.
        3. On further tie, leftmost (smallest x-coordinate) wins.

    Args:
        image: Decoded pixel data as a rows-first ``Sequence[Sequence[RGB]]``
            (the ``Image`` type from :mod:`personal_color.region_extractor`).
            Top-left origin. Identical shape contract to
            :func:`detect_face_regions`.

    Returns:
        ``FaceBoundingBox`` in absolute pixel coordinates for the primary
        detected face, or ``None`` if MediaPipe found zero faces. All
        coordinate fields are non-negative integers; ``width`` and ``height``
        are guaranteed ≥ 1 when the result is not ``None``.

    Raises:
        ValueError: The image is empty (zero rows or zero columns) or
            otherwise structurally invalid. This is a structural input error,
            not a "no face" case — Phase 4 maps to **400 Bad Request**.
        RuntimeError: The ``mediapipe`` package is not installed in the
            current environment. A deployment error, not a per-request error.
    """
    width, height = _validate_image_shape(image)

    detector = _get_or_build_detector()

    np = _import_numpy()
    frame = np.array(image, dtype=np.uint8)

    results = detector.process(frame)
    detections = list(getattr(results, "detections", None) or ())

    if len(detections) == 0:
        return None

    chosen = _select_face(detections, image_width=width, image_height=height)
    return FaceBoundingBox(
        x=chosen.x,
        y=chosen.y,
        width=chosen.width,
        height=chosen.height,
    )


def face_detect(image: Image) -> FaceBoundingBox:
    """Detect the primary face in ``image`` and return its pixel bounding box.

    Lower-level companion to :func:`detect_face_regions`. Returns the raw
    bounding box without deriving skin / eyes / hair sub-regions. Useful as
    the first gate in the generation funnel reject filter (confirm face
    presence before applying the enhancer de-slop layer) and for rule-based
    identity-similarity scoring in the automatic candidate filter.

    The tie-breaking rule is identical to :func:`detect_face_regions`:

        1. Largest bounding-box area wins.
        2. On exact area tie, topmost (smallest y-coordinate) wins.
        3. On further tie, leftmost (smallest x-coordinate) wins.

    This function shares the same lazy MediaPipe lifecycle and
    module-scope detector cache as :func:`detect_face_regions` — the two
    entry points are co-located intentionally so only **one** detector
    instance is ever live per interpreter process.

    Args:
        image: Decoded pixel data as a rows-first ``Sequence[Sequence[RGB]]``
            (the ``Image`` type from :mod:`personal_color.region_extractor`).
            Top-left origin. Identical shape contract to
            :func:`detect_face_regions`.

    Returns:
        ``FaceBoundingBox`` in absolute pixel coordinates for the primary
        detected face. All coordinate fields are non-negative integers;
        ``width`` and ``height`` are guaranteed ≥ 1.

    Raises:
        FaceNotDetectedError: MediaPipe ran cleanly but found zero faces.
            Permanent input failure — Phase 4 HTTP server maps to **422
            Unprocessable Entity**.
        ValueError: The image is empty (zero rows or zero columns) or
            otherwise structurally invalid. Phase 4 maps to **400 Bad
            Request**.
        RuntimeError: The ``mediapipe`` package is not installed in the
            current environment. A deployment error, not a per-request
            error — production servers always run the full requirements set.
    """
    width, height = _validate_image_shape(image)

    detector = _get_or_build_detector()

    np = _import_numpy()
    frame = np.array(image, dtype=np.uint8)

    results = detector.process(frame)
    detections = list(getattr(results, "detections", None) or ())

    if len(detections) == 0:
        raise FaceNotDetectedError("no face detected in selfie")

    chosen = _select_face(detections, image_width=width, image_height=height)
    return FaceBoundingBox(
        x=chosen.x,
        y=chosen.y,
        width=chosen.width,
        height=chosen.height,
    )


# ---------------------------------------------------------------------------
# Internal helpers — image validation + detector lifecycle.
# ---------------------------------------------------------------------------


def _validate_image_shape(image: Image) -> tuple[int, int]:
    """Return `(width, height)` for a non-empty, rectangular image."""
    if image is None:
        raise ValueError("image must not be None")
    height = len(image)
    if height == 0:
        raise ValueError("image must have at least 1 row")
    first_row = image[0]
    width = len(first_row)
    if width == 0:
        raise ValueError("image rows must have at least 1 column")
    return width, height


def _import_mediapipe() -> Any:
    """Lazy import of `mediapipe`. Raises a clear error if missing.

    The import is intentionally inside the function body — see the
    module docstring for the lazy-load rationale.
    """
    try:
        import mediapipe  # type: ignore[import-not-found]  # noqa: PLC0415 — lazy boundary import (intentional)
    except ImportError as exc:  # pragma: no cover - environment-specific
        raise RuntimeError(
            "mediapipe is not installed; install it as a runtime "
            "dependency (pinned at 0.10.18) to enable face detection",
        ) from exc
    return mediapipe


def _import_numpy() -> Any:
    """Lazy import of `numpy`. Transitive dep of mediapipe."""
    try:
        import numpy  # noqa: PLC0415 — lazy boundary import (intentional)
    except ImportError as exc:  # pragma: no cover - environment-specific
        raise RuntimeError(
            "numpy is not installed; it is required as a transitive "
            "dependency of mediapipe for face detection",
        ) from exc
    return numpy


def _get_or_build_detector() -> Any:
    """Return a cached `FaceDetection` instance, building it on first call.

    The model is loaded the *first* time this function runs — not at
    import time. After the first successful build the instance is
    cached at module scope and reused for every subsequent detection.
    """
    if _CACHE.detector is not None:
        return _CACHE.detector

    mp = _import_mediapipe()
    # MediaPipe's `solutions.face_detection.FaceDetection` is the
    # documented public entry point. `model_selection=1` selects the
    # full-range model — better recall for selfies framed beyond
    # ~2m, which matches how users actually take phone selfies.
    detector = mp.solutions.face_detection.FaceDetection(
        model_selection=1,
        min_detection_confidence=0.5,
    )
    _CACHE.detector = detector
    return detector


# ---------------------------------------------------------------------------
# Internal helpers — detection-result handling.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _PixelBox:
    """Bounding box in absolute pixel coordinates."""

    x: int
    y: int
    width: int
    height: int

    @property
    def area(self) -> int:
        return self.width * self.height


def _detection_to_pixel_box(
    detection: Any,
    *,
    image_width: int,
    image_height: int,
) -> _PixelBox:
    """Convert a MediaPipe `Detection` into an absolute-pixel `_PixelBox`.

    MediaPipe expresses bounding boxes in normalized coords (0.0-1.0
    relative to the source frame). We clamp into the image bounds so
    downstream region extraction never receives a negative origin or
    an out-of-bounds extent.
    """
    bbox = detection.location_data.relative_bounding_box
    x = max(0, int(round(bbox.xmin * image_width)))
    y = max(0, int(round(bbox.ymin * image_height)))
    w = max(1, int(round(bbox.width * image_width)))
    h = max(1, int(round(bbox.height * image_height)))
    # Clamp the far edge so x + w never exceeds the image.
    if x + w > image_width:
        w = image_width - x
    if y + h > image_height:
        h = image_height - y
    return _PixelBox(x=x, y=y, width=max(1, w), height=max(1, h))


def _select_face(
    detections: list[Any],
    *,
    image_width: int,
    image_height: int,
) -> _PixelBox:
    """Pick exactly one face from MediaPipe's detections list.

    Tie-breaking rule (fully deterministic — same input → same output):

        1. Largest bounding-box area wins.
        2. On exact area tie, topmost (smallest y) wins.
        3. On further tie, leftmost (smallest x) wins.
    """
    boxes = [
        _detection_to_pixel_box(
            d,
            image_width=image_width,
            image_height=image_height,
        )
        for d in detections
    ]
    # Sort key: (-area, y, x). Smallest sort key wins.
    boxes.sort(key=lambda b: (-b.area, b.y, b.x))
    return boxes[0]


def _bbox_to_face_regions(
    face: _PixelBox,
    *,
    image_width: int,
    image_height: int,
) -> FaceRegions:
    """Derive skin / eyes / hair `Region`s from a face bounding box.

    Heuristics — kept conservative to avoid edge clipping on small
    selfies. The diagnosis primitives are robust to slight region
    misalignment because they aggregate via MEDIAN (Sub-AC 10.4).

      - skin: a central rectangle in the lower 60% of the face bbox,
        spanning the middle 50% horizontally — i.e. cheek/jaw area.
      - eyes: a thin strip at ~30% from the top of the face bbox,
        spanning the middle 70% horizontally.
      - hair: a strip *above* the face bbox (forehead/hair line),
        clamped into the image if the face is at the top edge.
    """
    fx, fy, fw, fh = face.x, face.y, face.width, face.height

    # Skin: middle-50% horizontally, 40-90% vertically of the face.
    skin_x = fx + fw // 4
    skin_y = fy + (fh * 4) // 10
    skin_w = max(1, fw // 2)
    skin_h = max(1, fh // 2)
    skin = _clamp_region(skin_x, skin_y, skin_w, skin_h, image_width, image_height)

    # Eyes: middle-70% horizontally, ~30-40% vertically of the face.
    eyes_x = fx + (fw * 15) // 100
    eyes_y = fy + (fh * 3) // 10
    eyes_w = max(1, (fw * 70) // 100)
    eyes_h = max(1, fh // 10)
    eyes = _clamp_region(eyes_x, eyes_y, eyes_w, eyes_h, image_width, image_height)

    # Hair: a strip just above the face bbox. If the face is right at
    # the top of the image, fall back to a thin sliver inside the
    # face's top edge so the region remains non-empty.
    hair_h = max(1, fh // 4)
    hair_y = fy - hair_h
    if hair_y < 0:
        hair_y = 0
        hair_h = max(1, min(fh // 6, fy if fy > 0 else fh // 6))
    hair_x = fx
    hair_w = max(1, fw)
    hair = _clamp_region(hair_x, hair_y, hair_w, hair_h, image_width, image_height)

    return FaceRegions(skin=skin, eyes=eyes, hair=hair)


def _clamp_region(
    x: int,
    y: int,
    width: int,
    height: int,
    image_width: int,
    image_height: int,
) -> Region:
    """Clamp a derived region into the image's pixel bounds."""
    x = max(0, min(x, image_width - 1))
    y = max(0, min(y, image_height - 1))
    width = max(1, min(width, image_width - x))
    height = max(1, min(height, image_height - y))
    return Region(x=x, y=y, width=width, height=height)
