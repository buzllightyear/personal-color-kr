"""Unit tests for the personal-color diagnosis runtime entry point.

The runtime entry point ``diagnose_personal_color`` is the bytes-in /
:class:`DiagnosisResult`-out seam between the Phase 4 HTTP layer and
the Phase 0.x diagnosis primitives. The tests in this file pin the
behaviours that AC 1 commits to:

  - The function returns a :class:`DiagnosisResult` frozen dataclass.
  - The result carries the season verdict PLUS the 8 intermediate
    signals (tone, contrast, per-axis confidences, per-region luma).
  - The result is immutable (frozen dataclass — assignment raises).
  - The selfie bytes are decoded **exactly once**; the resulting
    :class:`Image` reference is shared between the detector and the
    diagnosis pipeline.
  - The decoder/detector dependencies are injectable via private
    keyword arguments — so the test layer needs no native deps.
  - The injected callables receive the values from the pipeline
    in order (bytes → decoder, decoded image → detector).

The whole file is pure-stdlib + stub callables. No Pillow import, no
MediaPipe import — runnable in the Phase 0.x base CI lane without
native dependencies (per the test_categorization rule in the Seed
ontology).
"""

from __future__ import annotations

import dataclasses

import pytest

from personal_color.diagnose_runtime import diagnose_personal_color
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.region_extractor import FaceRegions, Image, Region
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Stub helpers — produce a synthetic image and matching regions whose
# pixel content is known to deterministically classify into a Season.
# ---------------------------------------------------------------------------


def _build_spring_image() -> Image:
    """Build a 12x12 image whose three regions classify as SPRING (warm + high).

    Layout:

        rows 0-3   → hair patch (very dark, luma ≈ 0.08)
        rows 4-7   → eyes patch (medium)
        rows 8-11  → skin patch (warm-bright, R >> B)

    The luma gap between skin and hair pushes contrast to HIGH; the
    R > B chroma pushes tone to WARM; together they produce SPRING.
    """
    hair_row = [(20, 20, 20)] * 12
    eyes_row = [(95, 70, 50)] * 12
    skin_row = [(230, 190, 150)] * 12  # |R - B| = 80 → tone_conf = 1.0
    rows: list[tuple[tuple[int, int, int], ...]] = []
    for _ in range(4):
        rows.append(tuple(hair_row))
    for _ in range(4):
        rows.append(tuple(eyes_row))
    for _ in range(4):
        rows.append(tuple(skin_row))
    return tuple(rows)


def _build_spring_regions() -> FaceRegions:
    """FaceRegions pointing at the SPRING image's three patches."""
    return FaceRegions(
        skin=Region(x=2, y=8, width=8, height=4),  # warm bright row band
        eyes=Region(x=2, y=4, width=8, height=4),  # medium row band
        hair=Region(x=2, y=0, width=8, height=4),  # dark row band
    )


class _DecoderSpy:
    """Stub decoder that records every byte payload it is asked to decode."""

    def __init__(self, output: Image) -> None:
        self.output = output
        self.calls: list[bytes] = []

    def __call__(self, payload: bytes) -> Image:
        self.calls.append(payload)
        return self.output


class _DetectorSpy:
    """Stub detector that records every :class:`Image` it receives."""

    def __init__(self, output: FaceRegions) -> None:
        self.output = output
        self.calls: list[Image] = []

    def __call__(self, image: Image) -> FaceRegions:
        self.calls.append(image)
        return self.output


# ---------------------------------------------------------------------------
# AC 1 — diagnose_personal_color returns a DiagnosisResult with season +
# 8 intermediate fields.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returns_diagnosis_result_instance() -> None:
    """Happy path: production-shaped pipeline returns ``DiagnosisResult``."""
    image = _build_spring_image()
    regions = _build_spring_regions()
    decoder = _DecoderSpy(output=image)
    detector = _DetectorSpy(output=regions)

    result = diagnose_personal_color(
        b"<<arbitrary-bytes-payload>>",
        _decoder=decoder,
        _detector=detector,
    )

    assert isinstance(result, DiagnosisResult)


@pytest.mark.unit
def test_diagnosis_result_has_season_plus_eight_intermediate_fields() -> None:
    """AC 1 surface: 1 season + 8 intermediate signals = 9 total fields.

    The DiagnosisResult dataclass is the analytics-facing contract.
    Listing every field name keeps a refactor that drops a signal
    from the result loud rather than silent.
    """
    expected_fields = {
        "season",  # 1 — the four-category verdict
        "confidence",  # 2 — overall confidence
        "tone",  # 3 — warm / cool
        "contrast",  # 4 — high / low
        "tone_confidence",  # 5 — per-axis tone confidence
        "contrast_confidence",  # 6 — per-axis contrast confidence
        "skin_luma",  # 7 — Rec.601 luma of skin region
        "hair_luma",  # 8 — Rec.601 luma of hair region
        "eyes_luma",  # 9 — Rec.601 luma of eyes region
    }
    actual_fields = {f.name for f in dataclasses.fields(DiagnosisResult)}
    assert actual_fields == expected_fields


@pytest.mark.unit
def test_returned_result_carries_season_enum_member() -> None:
    """The returned ``season`` is a :class:`Season` enum (not a stringly type)."""
    image = _build_spring_image()
    regions = _build_spring_regions()
    result = diagnose_personal_color(
        b"<<arbitrary>>",
        _decoder=_DecoderSpy(output=image),
        _detector=_DetectorSpy(output=regions),
    )
    assert isinstance(result.season, Season)


@pytest.mark.unit
def test_result_intermediate_fields_have_documented_types() -> None:
    """Tone / contrast are enums; the confidence and luma fields are floats."""
    image = _build_spring_image()
    regions = _build_spring_regions()
    result = diagnose_personal_color(
        b"<<arbitrary>>",
        _decoder=_DecoderSpy(output=image),
        _detector=_DetectorSpy(output=regions),
    )

    # Numeric ranges — every confidence / luma value sits in [0, 1].
    for value in (
        result.confidence,
        result.tone_confidence,
        result.contrast_confidence,
        result.skin_luma,
        result.hair_luma,
        result.eyes_luma,
    ):
        assert isinstance(value, float)
        assert 0.0 <= value <= 1.0


@pytest.mark.unit
def test_result_is_frozen_dataclass_assignment_raises() -> None:
    """Frozen dataclass invariant — analytics callers must not mutate."""
    image = _build_spring_image()
    regions = _build_spring_regions()
    result = diagnose_personal_color(
        b"<<arbitrary>>",
        _decoder=_DecoderSpy(output=image),
        _detector=_DetectorSpy(output=regions),
    )

    with pytest.raises(dataclasses.FrozenInstanceError):
        result.season = Season.WINTER  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Pipeline wiring — bytes are decoded exactly once and the resulting
# image is the same reference passed to the detector.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_decoder_is_called_exactly_once_with_the_input_bytes() -> None:
    image = _build_spring_image()
    regions = _build_spring_regions()
    decoder = _DecoderSpy(output=image)
    detector = _DetectorSpy(output=regions)

    payload = b"<<distinct-payload-bytes>>"
    diagnose_personal_color(payload, _decoder=decoder, _detector=detector)

    # Exactly one decode — see "bytes decoded exactly once" Seed constraint.
    assert len(decoder.calls) == 1
    assert decoder.calls[0] == payload


@pytest.mark.unit
def test_detector_receives_the_decoded_image_reference() -> None:
    """The decoded ``Image`` is the *same object* the detector receives.

    This pins the "single decode" contract: there must not be an
    intermediate copy / re-decode between the decoder and the detector.
    """
    image = _build_spring_image()
    regions = _build_spring_regions()
    decoder = _DecoderSpy(output=image)
    detector = _DetectorSpy(output=regions)

    diagnose_personal_color(b"x", _decoder=decoder, _detector=detector)

    assert len(detector.calls) == 1
    assert detector.calls[0] is image


# ---------------------------------------------------------------------------
# Production defaults are wired in — caller can omit the underscored kwargs.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_default_decoder_and_detector_are_set_at_function_definition() -> None:
    """The production defaults for ``_decoder`` / ``_detector`` are wired.

    We don't *call* the production defaults here (that would pull in
    Pillow + MediaPipe). Instead, we verify the defaults point at the
    real module-level callables so a caller that omits the underscored
    kwargs gets the production behaviour.
    """
    from personal_color import diagnose_runtime
    from personal_color.face_detector import detect_face_regions
    from personal_color.image_decoder import decode_image

    defaults = diagnose_runtime.diagnose_personal_color.__kwdefaults__
    assert defaults["_decoder"] is decode_image
    assert defaults["_detector"] is detect_face_regions


# ---------------------------------------------------------------------------
# AC 15 — orchestrate 3-step pipeline: decode → detect → diagnose_from_image
# with the *same* image reference threaded through every step.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_diagnose_from_image_receives_the_decoded_image_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC 15: step 3 of the pipeline sees the *same* image reference.

    The Seed mandates ``selfie bytes decoded exactly once — single image
    reference passed to both face_detector and diagnose_from_image``.
    The existing detector-spy test pins the decoder→detector seam; this
    test pins the decoder→diagnose_from_image seam (step 3).
    """
    from personal_color import diagnose_runtime

    image = _build_spring_image()
    regions = _build_spring_regions()
    decoder = _DecoderSpy(output=image)
    detector = _DetectorSpy(output=regions)

    # Spy on diagnose_from_image by monkey-patching the *binding* inside
    # ``diagnose_runtime`` — the orchestrator imports the symbol at
    # module load time, so the patch must target the consumer's
    # namespace rather than the producer's.
    calls: list[tuple[Image, FaceRegions]] = []
    real_diagnose_from_image = diagnose_runtime.diagnose_from_image  # type: ignore[attr-defined]

    def spying_diagnose_from_image(
        img: Image,
        regs: FaceRegions,
    ) -> DiagnosisResult:
        calls.append((img, regs))
        return real_diagnose_from_image(img, regs)

    monkeypatch.setattr(
        diagnose_runtime,
        "diagnose_from_image",
        spying_diagnose_from_image,
    )

    diagnose_runtime.diagnose_personal_color(
        b"<<arbitrary>>",
        _decoder=decoder,
        _detector=detector,
    )

    # The orchestrator called diagnose_from_image exactly once with the
    # very same image object the decoder produced — no copy, no second
    # decode, no intermediate transform.
    assert len(calls) == 1
    passed_image, passed_regions = calls[0]
    assert passed_image is image
    assert passed_regions is regions


@pytest.mark.unit
def test_pipeline_invokes_three_steps_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC 15: the three pipeline steps fire in the documented order.

    The orchestration sequence is decode → detect → diagnose_from_image.
    A regression that re-orders (or skips) a step would break the
    contract with Phase 4 (HTTP layer relies on the decoder error
    firing *before* the detector touches the bytes) — pin it here.
    """
    from personal_color import diagnose_runtime

    image = _build_spring_image()
    regions = _build_spring_regions()

    events: list[str] = []

    def recording_decoder(payload: bytes) -> Image:
        events.append("decode")
        return image

    def recording_detector(img: Image) -> FaceRegions:
        events.append("detect")
        return regions

    real_diagnose_from_image = diagnose_runtime.diagnose_from_image  # type: ignore[attr-defined]

    def recording_diagnose_from_image(
        img: Image,
        regs: FaceRegions,
    ) -> DiagnosisResult:
        events.append("diagnose_from_image")
        return real_diagnose_from_image(img, regs)

    monkeypatch.setattr(
        diagnose_runtime,
        "diagnose_from_image",
        recording_diagnose_from_image,
    )

    diagnose_runtime.diagnose_personal_color(
        b"<<arbitrary>>",
        _decoder=recording_decoder,
        _detector=recording_detector,
    )

    assert events == ["decode", "detect", "diagnose_from_image"]


@pytest.mark.unit
def test_pipeline_returns_diagnose_from_image_result_verbatim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC 15: the runtime returns ``diagnose_from_image``'s result verbatim.

    The orchestrator must not wrap, transform, or repackage the
    ``DiagnosisResult``. Analytics depends on identity of the returned
    object so any future "let's add a defensive copy" refactor lands
    loudly.
    """
    from personal_color import diagnose_runtime

    image = _build_spring_image()
    regions = _build_spring_regions()

    sentinel_result = DiagnosisResult(
        season=Season.WINTER,
        confidence=0.5,
        tone=__import__(
            "personal_color.tone_classifier",
            fromlist=["Tone"],
        ).Tone.COOL,
        contrast=__import__(
            "personal_color.contrast_classifier",
            fromlist=["Contrast"],
        ).Contrast.HIGH,
        tone_confidence=0.5,
        contrast_confidence=0.5,
        skin_luma=0.5,
        hair_luma=0.5,
        eyes_luma=0.5,
    )

    def fake_diagnose_from_image(
        img: Image,
        regs: FaceRegions,
    ) -> DiagnosisResult:
        return sentinel_result

    monkeypatch.setattr(
        diagnose_runtime,
        "diagnose_from_image",
        fake_diagnose_from_image,
    )

    actual = diagnose_runtime.diagnose_personal_color(
        b"<<arbitrary>>",
        _decoder=_DecoderSpy(output=image),
        _detector=_DetectorSpy(output=regions),
    )

    # Identity, not equality — the orchestrator must not deep-copy.
    assert actual is sentinel_result


@pytest.mark.unit
def test_decoder_error_short_circuits_pipeline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC 15: if the decoder raises, the detector and diagnose step
    must never run.

    The Phase 4 HTTP server relies on ``InvalidSelfieError`` mapping to
    400 *before* MediaPipe touches the bytes (no point loading a
    multi-megabyte TFLite model for an empty payload).
    """
    from personal_color import diagnose_runtime
    from personal_color.image_decoder import InvalidSelfieError

    detector = _DetectorSpy(output=_build_spring_regions())
    diagnose_called = False

    def exploding_decoder(payload: bytes) -> Image:
        raise InvalidSelfieError("payload is not a valid PNG/JPEG")

    def must_not_run_diagnose(
        img: Image,
        regs: FaceRegions,
    ) -> DiagnosisResult:
        nonlocal diagnose_called
        diagnose_called = True
        raise AssertionError("diagnose_from_image must not run after decoder error")

    monkeypatch.setattr(
        diagnose_runtime,
        "diagnose_from_image",
        must_not_run_diagnose,
    )

    with pytest.raises(InvalidSelfieError):
        diagnose_runtime.diagnose_personal_color(
            b"<<arbitrary>>",
            _decoder=exploding_decoder,
            _detector=detector,
        )

    assert detector.calls == []
    assert diagnose_called is False


@pytest.mark.unit
def test_detector_error_short_circuits_diagnose_step(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AC 15: if the detector raises, the diagnose step must never run.

    Same short-circuit invariant as above, but for the
    ``FaceNotDetectedError`` (HTTP 422) seam.
    """
    from personal_color import diagnose_runtime
    from personal_color.face_detector import FaceNotDetectedError

    image = _build_spring_image()
    decoder = _DecoderSpy(output=image)
    diagnose_called = False

    def exploding_detector(img: Image) -> FaceRegions:
        raise FaceNotDetectedError("no face detected in selfie")

    def must_not_run_diagnose(
        img: Image,
        regs: FaceRegions,
    ) -> DiagnosisResult:
        nonlocal diagnose_called
        diagnose_called = True
        raise AssertionError(
            "diagnose_from_image must not run after detector error",
        )

    monkeypatch.setattr(
        diagnose_runtime,
        "diagnose_from_image",
        must_not_run_diagnose,
    )

    with pytest.raises(FaceNotDetectedError):
        diagnose_runtime.diagnose_personal_color(
            b"<<arbitrary>>",
            _decoder=decoder,
            _detector=exploding_detector,
        )

    assert decoder.calls == [b"<<arbitrary>>"]
    assert diagnose_called is False
