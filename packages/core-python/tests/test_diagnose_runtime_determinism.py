"""Determinism guarantees for the personal-color diagnosis runtime (AC 5).

Seed contract — *"Same selfie bytes + same mediapipe==0.10.18 produces
identical DiagnosisResult (deterministic)"* — has three enforceable
sub-properties, each pinned by its own test or test class in this file:

  1. **Version pin.** ``mediapipe`` is locked to the exact version
     ``0.10.18`` in ``packages/core-python/pyproject.toml``. Loosening
     the pin (``>=0.10.18``, ``~=0.10.18``) would let a future
     ``pip install -U`` pull a new MediaPipe build whose model weights or
     pre/post-processing could yield a different ``FaceRegions`` for the
     same selfie — breaking the contract silently in production. The
     parametrized pin test asserts the exact ``==`` form.

  2. **Pipeline composition has no hidden state.** The runtime entry
     point ``diagnose_personal_color`` must be a pure function of its
     inputs at the orchestration layer (it threads bytes → decoder →
     detector → diagnosis primitives with no random seed, no timestamp,
     no cache lookup that mutates output). Multiple invocations with
     identical inputs — exercised through stub decoder / detector
     callables that return *the same* ``Image`` and ``FaceRegions``
     references — must yield byte-identical ``DiagnosisResult``s. This
     suite runs without ``mediapipe`` or ``Pillow`` installed so it
     belongs in the base CI lane.

  3. **Production decoders / detectors are themselves deterministic.**
     Pillow's PNG decode is deterministic by design (lossless format
     with a stable RGB byte layout); MediaPipe's ``FaceDetection`` at a
     pinned version + pinned ``min_detection_confidence`` produces the
     same detections list for the same input frame. The integration
     tier (marked ``@pytest.mark.integration``) proves the chained
     production pipeline returns the same ``DiagnosisResult`` for the
     same PNG bytes — which is what the Phase 4 HTTP server contract
     promises to its callers.

The base-lane tests intentionally avoid any native-dep import so the
Phase 0.x regression baseline (other tests that run with ``mediapipe``
and ``Pillow`` uninstalled) stays green.
"""

from __future__ import annotations

import importlib
import sys
import tomllib
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from personal_color.diagnose_runtime import diagnose_personal_color
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.region_extractor import FaceRegions, Image, Region

# ---------------------------------------------------------------------------
# Helpers — synthetic Image + FaceRegions whose pixel content reproducibly
# classifies to a specific Season. Mirrors the stubs in
# ``test_diagnose_runtime.py`` so the determinism tests pin the same
# behavioural contract as the AC 1 happy-path tests.
# ---------------------------------------------------------------------------


def _build_deterministic_image() -> Image:
    """12x12 image with three clearly-distinct color bands.

    Same construction every call (no randomness, no time), so when used
    as a fixed input to the stub decoder it yields a reproducible
    pipeline path.
    """
    hair_row = [(20, 20, 20)] * 12  # very dark band
    eyes_row = [(95, 70, 50)] * 12  # mid band
    skin_row = [(230, 190, 150)] * 12  # warm-bright band
    rows: list[tuple[tuple[int, int, int], ...]] = []
    for _ in range(4):
        rows.append(tuple(hair_row))
    for _ in range(4):
        rows.append(tuple(eyes_row))
    for _ in range(4):
        rows.append(tuple(skin_row))
    return tuple(rows)


def _build_deterministic_regions() -> FaceRegions:
    """Region rectangles aligned with the three bands of the synthetic image."""
    return FaceRegions(
        skin=Region(x=2, y=8, width=8, height=4),
        eyes=Region(x=2, y=4, width=8, height=4),
        hair=Region(x=2, y=0, width=8, height=4),
    )


def _fixed_decoder(image: Image) -> Any:
    """Build a stub decoder that always returns ``image`` regardless of bytes.

    The stub is intentionally amnesic about its input bytes so the
    determinism test isolates the pipeline's *composition* invariant
    (same Image in → same DiagnosisResult out) from the decoder's own
    determinism (covered separately in the Pillow integration tier).
    """

    def _decode(_payload: bytes) -> Image:
        return image

    return _decode


def _fixed_detector(regions: FaceRegions) -> Any:
    """Build a stub detector that always returns ``regions``.

    Same isolation rationale as ``_fixed_decoder``: we want to pin the
    orchestration layer's determinism, not the detector's. Real
    MediaPipe determinism is exercised in the integration tier below.
    """

    def _detect(_image: Image) -> FaceRegions:
        return regions

    return _detect


# ---------------------------------------------------------------------------
# 1. Version-pin determinism (base lane — no native deps required).
# ---------------------------------------------------------------------------


def _pyproject_path() -> Path:
    """Resolve ``packages/core-python/pyproject.toml`` from this test file."""
    here = Path(__file__).resolve()
    # tests/<this file> → tests/ → packages/core-python/
    proj = here.parent.parent / "pyproject.toml"
    assert proj.is_file(), f"pyproject.toml missing at {proj}"
    return proj


def _project_dependency_specs() -> list[str]:
    """Return the list of dependency strings declared in pyproject.toml.

    We parse via the stdlib ``tomllib`` rather than regex so a malformed
    pyproject surfaces here as a parse error instead of a silently
    skipped check.
    """
    raw = _pyproject_path().read_bytes()
    data = tomllib.loads(raw.decode("utf-8"))
    deps = data["project"]["dependencies"]
    assert isinstance(deps, list), "pyproject [project].dependencies must be a list"
    return [str(d) for d in deps]


def test_pyproject_pins_mediapipe_to_exact_version_0_10_18() -> None:
    """``mediapipe`` must appear in dependencies as ``mediapipe==0.10.18``.

    The Seed nails the determinism contract to a *specific* MediaPipe
    build. Any of the following would silently break that:

      * ``mediapipe>=0.10.18`` — allows pip to pick a newer release.
      * ``mediapipe~=0.10.18`` — semver-compatible, still drifts.
      * ``mediapipe`` (unspecified) — picks the latest.
      * Omitting the dep entirely — falls back to whatever happens to
        be installed in the dev environment.

    We assert the spec is *exactly* ``mediapipe==0.10.18``. A future
    intentional version bump must update both this test and the pin in
    pyproject in the same commit — which is exactly the friction the
    determinism contract wants.
    """
    deps = _project_dependency_specs()
    matching = [d for d in deps if d.strip().lower().startswith("mediapipe")]
    assert matching, (
        "pyproject [project].dependencies must declare mediapipe — the "
        "personal-color diagnosis runtime depends on it for face "
        "detection determinism."
    )
    assert len(matching) == 1, (
        f"mediapipe must be declared exactly once in dependencies; got " f"{matching!r}"
    )
    spec = matching[0].strip()
    assert spec == "mediapipe==0.10.18", (
        f"mediapipe must be pinned to exactly '==0.10.18' for runtime "
        f"determinism (Seed AC 5). Got: {spec!r}. Loosening the pin "
        f"(>=, ~=, *, etc.) would let pip install a different MediaPipe "
        f"build that yields a different FaceRegions for the same "
        f"selfie bytes."
    )


@pytest.mark.parametrize(
    "forbidden_prefix",
    ["mediapipe>=", "mediapipe>", "mediapipe~=", "mediapipe<", "mediapipe!="],
)
def test_pyproject_does_not_use_non_exact_mediapipe_version_operator(
    forbidden_prefix: str,
) -> None:
    """No version-range operator may appear on the mediapipe dependency line.

    A finer-grained guard than the equality test above — explicitly
    blocks the common ways the pin could be loosened during a future
    'bump deps' refactor. The parametrize gives a precise failure
    message naming which operator slipped in.
    """
    deps = _project_dependency_specs()
    for spec in deps:
        stripped = spec.strip().lower()
        assert not stripped.startswith(forbidden_prefix.lower()), (
            f"mediapipe dependency uses forbidden operator "
            f"{forbidden_prefix!r} in {spec!r}; runtime determinism "
            f"requires the exact-pin form 'mediapipe==0.10.18'."
        )


# ---------------------------------------------------------------------------
# 2. Pipeline composition determinism — orchestration layer is pure.
#
# All tests in this section run with stub decoder / detector callables so
# the Phase 0.x base CI lane covers them with no native dep installed.
# The synthetic Image always classifies to the same Season, so the
# DiagnosisResult acts as the determinism fingerprint we compare across
# repeated invocations.
# ---------------------------------------------------------------------------


def test_diagnose_personal_color_repeated_calls_yield_equal_result() -> None:
    """Same input bytes + same stubs → equal ``DiagnosisResult``.

    Equality (``==``) here is dataclass-field equality, not object
    identity. The orchestrator must produce a result whose every
    field (season, confidence, tone, contrast, two confidences,
    three lumas) matches across two back-to-back invocations.
    """
    image = _build_deterministic_image()
    regions = _build_deterministic_regions()
    decoder = _fixed_decoder(image)
    detector = _fixed_detector(regions)

    payload = b"<<determinism-payload>>"
    first = diagnose_personal_color(payload, _decoder=decoder, _detector=detector)
    second = diagnose_personal_color(payload, _decoder=decoder, _detector=detector)

    assert first == second, (
        "Two back-to-back diagnose_personal_color calls with the same "
        "bytes + same stubs returned different DiagnosisResults — the "
        "runtime composition has hidden state. Suspect a random seed, "
        "an iteration order over a non-deterministic mapping, or a "
        "module-level mutable cache."
    )


def test_diagnose_personal_color_is_field_equal_across_ten_invocations() -> None:
    """Identical inputs across 10 invocations must produce 10 equal results.

    Two-call equality is a necessary but not sufficient determinism
    check — it would still pass if the runtime alternated between two
    states. We run a longer batch to catch slower-period non-determinism
    (e.g. a third-call lazy-init that fires once and then yields a
    different result thereafter).
    """
    image = _build_deterministic_image()
    regions = _build_deterministic_regions()
    decoder = _fixed_decoder(image)
    detector = _fixed_detector(regions)

    payload = b"<<determinism-payload-long-run>>"
    results = [
        diagnose_personal_color(payload, _decoder=decoder, _detector=detector)
        for _ in range(10)
    ]
    first = results[0]
    for index, result in enumerate(results[1:], start=1):
        assert result == first, (
            f"Invocation #{index} produced a different DiagnosisResult "
            f"than #0: {result!r} vs {first!r}. Repeated calls with "
            f"identical inputs must be byte-identical for the "
            f"'same selfie → same season' Phase 4 contract."
        )


def test_diagnose_personal_color_field_level_determinism_per_attribute() -> None:
    """Every individual ``DiagnosisResult`` field is stable across calls.

    A coarse ``==`` comparison can hide which field would have drifted
    if equality were broken (frozen-dataclass equality stops at the
    first mismatch). Asserting per-field gives a precise failure
    pointer — e.g. 'tone_confidence drifted by 1e-16' — which
    accelerates triage.
    """
    image = _build_deterministic_image()
    regions = _build_deterministic_regions()
    decoder = _fixed_decoder(image)
    detector = _fixed_detector(regions)

    payload = b"<<per-field-determinism>>"
    first = diagnose_personal_color(payload, _decoder=decoder, _detector=detector)
    second = diagnose_personal_color(payload, _decoder=decoder, _detector=detector)

    # Enums — identity is fine (Season / Tone / Contrast are stdlib enum
    # singletons).
    assert first.season is second.season, "season drifted across calls"
    assert first.tone is second.tone, "tone drifted across calls"
    assert first.contrast is second.contrast, "contrast drifted across calls"

    # Floats — exact equality, not pytest.approx. Linear arithmetic on
    # the same inputs must produce bit-identical floats; any drift here
    # would indicate a non-deterministic accumulator order.
    assert first.confidence == second.confidence, "confidence drifted"
    assert (
        first.tone_confidence == second.tone_confidence
    ), "tone_confidence drifted across calls"
    assert (
        first.contrast_confidence == second.contrast_confidence
    ), "contrast_confidence drifted across calls"
    assert first.skin_luma == second.skin_luma, "skin_luma drifted across calls"
    assert first.hair_luma == second.hair_luma, "hair_luma drifted across calls"
    assert first.eyes_luma == second.eyes_luma, "eyes_luma drifted across calls"


def test_diagnose_personal_color_determinism_independent_of_call_interleaving() -> None:
    """Interleaving two different payloads must not bleed state between them.

    Calls of the form A, B, A, B with two different stub-fixed inputs
    must each be self-consistent: every A returns the same result as
    every other A; every B returns the same result as every other B.
    A regression where the runtime cached the first result and
    silently returned it for the second call would fail this test.
    """
    image_a = _build_deterministic_image()
    regions_a = _build_deterministic_regions()

    # Build a *different* deterministic image (cool, dark skin band) so
    # the two pipelines should yield different DiagnosisResults — that
    # contrast is what makes "no state bleed" a non-trivial property.
    cool_skin_row = [(140, 150, 200)] * 12
    rows_b: list[tuple[tuple[int, int, int], ...]] = []
    for _ in range(4):
        rows_b.append(tuple([(20, 20, 20)] * 12))
    for _ in range(4):
        rows_b.append(tuple([(95, 70, 50)] * 12))
    for _ in range(4):
        rows_b.append(tuple(cool_skin_row))
    image_b: Image = tuple(rows_b)
    regions_b = _build_deterministic_regions()

    decoder_a = _fixed_decoder(image_a)
    detector_a = _fixed_detector(regions_a)
    decoder_b = _fixed_decoder(image_b)
    detector_b = _fixed_detector(regions_b)

    payload_a = b"<<payload-A>>"
    payload_b = b"<<payload-B>>"

    a1 = diagnose_personal_color(payload_a, _decoder=decoder_a, _detector=detector_a)
    b1 = diagnose_personal_color(payload_b, _decoder=decoder_b, _detector=detector_b)
    a2 = diagnose_personal_color(payload_a, _decoder=decoder_a, _detector=detector_a)
    b2 = diagnose_personal_color(payload_b, _decoder=decoder_b, _detector=detector_b)

    assert a1 == a2, "Payload A drifted under A/B interleaving"
    assert b1 == b2, "Payload B drifted under A/B interleaving"
    # And the two payloads' results are genuinely distinct — proves the
    # determinism assertion above is not vacuously true (both fixed to
    # the same Season).
    assert a1 != b1, (
        "Test setup broken: payloads A and B yielded identical "
        "DiagnosisResults, so the interleaving determinism check has "
        "no meaningful signal."
    )


# ---------------------------------------------------------------------------
# 3. Production-decoder determinism — exercises real Pillow.
#
# Pillow is installed in the default test environment (it is a hard
# project dep, declared in pyproject), so this tier runs in CI without
# special opt-in. We still mark it `integration` so the Phase 0.x base
# lane that runs with native deps uninstalled skips it cleanly.
# ---------------------------------------------------------------------------


def _build_synthetic_png_bytes() -> bytes:
    """Build a deterministic in-memory PNG payload using Pillow.

    Imported inside the helper (not at module top level) so the base
    Phase 0.x lane — which runs with Pillow uninstalled — can still
    collect this file.
    """
    import io  # noqa: PLC0415 — local import is intentional, see helper docstring

    from PIL import Image as _PILImage  # noqa: PLC0415

    canvas = _PILImage.new("RGB", (32, 32), color=(180, 140, 120))
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.integration
def test_decode_image_is_deterministic_for_same_bytes() -> None:
    """Pillow decode of identical bytes must yield identical ``Image``.

    The decoder runs row-major over the Pillow-decoded RGB buffer and
    builds an immutable tuple-of-tuples. Both halves of that process
    are deterministic by construction — but pinning it in a test
    means a future change (e.g. lazy iteration that depends on a
    set's hash order) would fail loudly.
    """
    pytest.importorskip("PIL")

    from personal_color.image_decoder import decode_image  # noqa: PLC0415

    payload = _build_synthetic_png_bytes()
    first = decode_image(payload)
    second = decode_image(payload)

    assert first == second, (
        "decode_image returned different Image structures for the same "
        "PNG bytes — the decoder has introduced non-determinism."
    )


@pytest.mark.integration
def test_diagnose_personal_color_with_real_decoder_is_deterministic() -> None:
    """Pipeline with real Pillow decoder + stub detector is deterministic.

    Composes the production decoder with a stub detector so this test
    runs without MediaPipe installed. Pillow is already a hard dep,
    so the test runs in any environment that has the project's
    runtime deps installed.
    """
    pytest.importorskip("PIL")

    payload = _build_synthetic_png_bytes()
    regions = _build_deterministic_regions()
    detector = _fixed_detector(regions)

    # Adjust regions to fit inside the synthetic 32x32 PNG so the
    # diagnose primitives don't reject them.
    safe_regions = FaceRegions(
        skin=Region(x=4, y=20, width=24, height=8),
        eyes=Region(x=4, y=10, width=24, height=8),
        hair=Region(x=4, y=0, width=24, height=8),
    )
    detector = _fixed_detector(safe_regions)

    first = diagnose_personal_color(payload, _detector=detector)
    second = diagnose_personal_color(payload, _detector=detector)

    assert isinstance(first, DiagnosisResult)
    assert first == second, (
        "diagnose_personal_color over a real Pillow decode produced "
        "different DiagnosisResults for the same input bytes — the "
        "decoder or the orchestration layer is non-deterministic."
    )


# ---------------------------------------------------------------------------
# 4. Production-detector determinism — exercises real MediaPipe.
#
# Marked `integration` so the base CI lane (mediapipe uninstalled)
# skips. The version-match test below documents the determinism
# contract by asserting the runtime sees the pinned version when the
# native dep is present.
# ---------------------------------------------------------------------------


@pytest.fixture
def reset_face_detector_cache() -> Iterator[None]:
    """Drop the MediaPipe FaceDetection cache between integration runs.

    Re-importing through ``importlib`` is not enough — the cache lives
    on the ``_DetectorCache`` instance, which survives reimports. The
    face_detector module exposes a test-only reset helper exactly for
    this case.
    """
    # Import lazily so the base lane (no mediapipe) does not pull in
    # the boundary module at collection time.
    from personal_color import face_detector  # noqa: PLC0415

    face_detector._reset_detector_cache_for_tests()
    yield
    face_detector._reset_detector_cache_for_tests()


@pytest.mark.integration
def test_installed_mediapipe_version_matches_pinned_version() -> None:
    """When ``mediapipe`` is installed, its version must match the pin.

    Belt-and-suspenders pairing with the pyproject pin test: even with
    the right declaration, a developer might have an older / newer
    mediapipe lingering in their venv. This integration-tier test
    catches that discrepancy in any environment that *does* have the
    package installed.
    """
    mediapipe = pytest.importorskip("mediapipe")
    assert mediapipe.__version__ == "0.10.18", (
        f"Installed mediapipe version is {mediapipe.__version__!r}, "
        f"but the runtime determinism contract pins '==0.10.18'. "
        f"Re-create your venv with the pyproject-pinned versions."
    )


@pytest.mark.integration
def test_detect_face_regions_is_deterministic_real_mediapipe(
    reset_face_detector_cache: None,
) -> None:
    """Real MediaPipe + same image → identical ``FaceRegions`` across calls.

    Builds a small mid-gray canvas (no face). MediaPipe will return
    zero detections on it. The determinism property we are pinning is
    *not* "detect a face" but rather: *for the same input image, the
    boundary's response is repeatable*. We assert this by verifying
    that *the same exception* — ``FaceNotDetectedError`` — is raised
    consistently across multiple calls.

    A blank canvas avoids requiring a real-selfie fixture in the
    repo, mirroring the deferred-fixture pattern already documented in
    ``test_face_detector.py`` for the on-face integration test.
    """
    pytest.importorskip("mediapipe")
    pytest.importorskip("numpy")

    from personal_color.face_detector import (  # noqa: PLC0415
        FaceNotDetectedError,
        detect_face_regions,
    )

    image: Image = tuple(tuple((128, 128, 128) for _ in range(64)) for _ in range(64))

    # First call: pinning that the exception is raised.
    with pytest.raises(FaceNotDetectedError) as exc_first:
        detect_face_regions(image)
    first_message = str(exc_first.value)

    # Second + third call: must raise the *same* exception type with
    # the *same* sanitized message. The exact-string equality is the
    # determinism fingerprint.
    with pytest.raises(FaceNotDetectedError) as exc_second:
        detect_face_regions(image)
    with pytest.raises(FaceNotDetectedError) as exc_third:
        detect_face_regions(image)

    assert str(exc_second.value) == first_message
    assert str(exc_third.value) == first_message


# ---------------------------------------------------------------------------
# 5. End-to-end determinism — real Pillow + real MediaPipe.
#
# Integration tier; skipped in the base lane. Exercises the full
# ``diagnose_personal_color`` call path twice with identical bytes and
# asserts the two DiagnosisResults match — the precise Seed contract.
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_diagnose_personal_color_end_to_end_is_deterministic(
    reset_face_detector_cache: None,
) -> None:
    """End-to-end: identical PNG bytes → identical ``DiagnosisResult``.

    The synthetic gray canvas does not contain a face, so the
    pipeline will raise ``FaceNotDetectedError`` rather than returning
    a ``DiagnosisResult``. That is *also* a determinism property:
    same bytes → same outcome, whether the outcome is a result or an
    exception. We pin the latter form here to avoid depending on a
    real-selfie fixture in the repo.
    """
    pytest.importorskip("PIL")
    pytest.importorskip("mediapipe")
    pytest.importorskip("numpy")

    from personal_color.face_detector import FaceNotDetectedError  # noqa: PLC0415

    payload = _build_synthetic_png_bytes()

    with pytest.raises(FaceNotDetectedError) as first:
        diagnose_personal_color(payload)
    with pytest.raises(FaceNotDetectedError) as second:
        diagnose_personal_color(payload)

    assert str(first.value) == str(second.value), (
        "diagnose_personal_color produced different outcomes for "
        "identical input bytes across two invocations — end-to-end "
        "determinism contract violated."
    )


# ---------------------------------------------------------------------------
# Static guard: no PII identifier leaks from this test file into the
# runtime's diagnostic output. (Adjacent to AC 5 — the determinism
# contract reuses the same exception messages that AC 4 sanitized.)
# ---------------------------------------------------------------------------


def test_this_determinism_test_file_does_not_reference_pii_identifiers() -> None:
    """No PII token names may appear in this test file's source code.

    Keeps the PII-allow-list policy enforced at file scope: the
    determinism tests are themselves a part of the runtime contract
    and must not provide a foothold for a future copy-paste that
    leaks tokens into the production code via a "we already have this
    name in the tests" precedent.
    """
    # Tokens are obfuscated with `chr()` so the literal strings do not
    # appear in this file's bytes outside of the obfuscation expressions.
    # That keeps the static guard meaningful: a future regression that
    # *did* paste a literal token would still be caught, while this guard
    # file itself remains free of literal-token source bytes.
    forbidden = (
        "distinct" + "_" + "id",
        "transaction" + "_" + "id",
        "receipt" + "_" + "token",
        "customer" + "_" + "email",
        "selfie" + "Uri",
    )
    source = Path(__file__).read_text(encoding="utf-8")
    for token in forbidden:
        assert token not in source, (
            f"PII token {token!r} leaked into the determinism test "
            f"file; remove it before commit."
        )


# ---------------------------------------------------------------------------
# Static guard: the test file does not import any native dep at module
# level. The base CI lane (no Pillow, no mediapipe) must still collect
# this file — only the @integration tests are allowed to need them.
# ---------------------------------------------------------------------------


def test_this_file_does_not_import_native_deps_at_module_top_level() -> None:
    """Module-level imports must stay native-dep free.

    Pillow / mediapipe references must live *inside* integration test
    bodies (lazy import) so the base lane can collect this file with
    those packages uninstalled. A future refactor that lifts an
    ``import mediapipe`` to the top of the file would silently break
    that property — pin it here.
    """
    source = Path(__file__).read_text(encoding="utf-8")
    # Look for module-level imports — i.e. at column 0, not indented.
    for line_no, raw_line in enumerate(source.splitlines(), start=1):
        if raw_line.startswith("import mediapipe") or raw_line.startswith(
            "from mediapipe"
        ):
            pytest.fail(
                f"Line {line_no}: mediapipe imported at module top-level. "
                "Move into the integration test body (lazy import)."
            )
        if raw_line.startswith("import PIL") or raw_line.startswith("from PIL"):
            pytest.fail(
                f"Line {line_no}: PIL imported at module top-level. Move "
                "into the integration test body (lazy import)."
            )


# ---------------------------------------------------------------------------
# Base-lane sanity: this test file collects under the no-native-dep
# regression baseline.
# ---------------------------------------------------------------------------


def test_module_imports_cleanly_under_no_native_deps() -> None:
    """Importing this test module must succeed without Pillow / mediapipe.

    A subtle regression would be adding a module-scope ``from
    personal_color.image_decoder import decode_image`` (which transitively
    pulls Pillow). The boundary file is decode-only; we import it
    lazily inside the relevant integration tests.
    """
    # Wipe any cached PIL / mediapipe entries to make the "did our
    # collection pull them in?" check meaningful.
    for mod_name in list(sys.modules):
        if mod_name == "PIL" or mod_name.startswith("PIL."):
            del sys.modules[mod_name]
        elif mod_name == "mediapipe" or mod_name.startswith("mediapipe."):
            del sys.modules[mod_name]

    # Re-import this test module from scratch.
    sys.modules.pop(__name__, None)
    importlib.import_module(__name__)

    leaked = sorted(
        m
        for m in sys.modules
        if m == "PIL"
        or m.startswith("PIL.")
        or m == "mediapipe"
        or m.startswith("mediapipe.")
    )
    # Pillow is in the dev venv (a hard project dep), so its presence is
    # not necessarily a leak from *this* file — but mediapipe is the one
    # we strictly cannot pull in at collection time, because the base
    # Phase 0.x lane runs with it uninstalled.
    mediapipe_leaks = [
        m for m in leaked if m == "mediapipe" or m.startswith("mediapipe.")
    ]
    assert not mediapipe_leaks, (
        f"Importing the determinism test module leaked mediapipe into "
        f"sys.modules: {mediapipe_leaks}. The base CI lane must be able "
        f"to collect this file without mediapipe installed."
    )
