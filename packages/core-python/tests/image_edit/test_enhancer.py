"""Unit tests for ``image_edit.enhancer.apply_enhancer`` (Sub-AC 1).

Acceptance criterion (Sub-AC 1) being verified
-----------------------------------------------
    ``apply_enhancer(raw_images)`` — raw AI 출력을 입력받아 de-slop 처리된
    결과를 반환하는 단일 함수. 테스트: 주어진 raw 이미지 리스트에 대해
    enhancer가 호출되고 처리된 출력이 반환되는지 단위 검증.

Design
------
These tests verify that:
    1. ``apply_enhancer`` accepts a list of raw AI image bytes and returns
       a list of ``EnhancedImage`` of the same length.
    2. Each ``EnhancedImage`` has non-empty ``image_bytes`` (processed bytes
       differ structurally from the raw input — enhancement was applied).
    3. Each ``EnhancedImage`` has an ``artifact_flags`` tuple (possibly empty).
    4. The function is a pure transformation: empty input → empty output.
    5. Invalid inputs (empty bytes, non-decodable bytes) raise ``ValueError``.
    6. The ``EnhancedImage`` DTO is immutable (frozen dataclass).
    7. The output bytes are valid JPEG — Pillow can re-decode them.

No network calls, no ML model inference, no external vendor. The enhancer is
a deterministic Pillow pipeline so tests run instantly without I/O.

Helpers
-------
``_make_jpeg(color, size)``  — builds a minimal valid in-memory JPEG using
Pillow so tests have real decodable payloads without touching the filesystem.
The helper also accepts PNG format for testing multi-format input acceptance.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from image_edit.enhancer import (
    EnhancedImage,
    apply_enhancer,
)

# ---------------------------------------------------------------------------
# Helpers — in-memory image factories (no filesystem, no external I/O)
# ---------------------------------------------------------------------------


def _make_jpeg(
    color: tuple[int, int, int] = (180, 150, 130),
    size: tuple[int, int] = (32, 32),
) -> bytes:
    """Return a valid JPEG payload for the given solid RGB color and size.

    Uses Pillow to synthesise the bytes in memory — no fixtures, no
    external files, no filesystem writes. A 32×32 image is large enough
    for all Pillow image-processing operations (sharpness, edges, stats)
    while keeping the test footprint negligible.
    """
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _make_png(
    color: tuple[int, int, int] = (120, 160, 200),
    size: tuple[int, int] = (24, 24),
) -> bytes:
    """Return a valid PNG payload for the given solid RGB color and size."""
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_dark_jpeg(size: tuple[int, int] = (32, 32)) -> bytes:
    """Return a JPEG that triggers the ``dark_image`` artifact flag."""
    return _make_jpeg(color=(10, 10, 10), size=size)


def _make_bright_jpeg(size: tuple[int, int] = (32, 32)) -> bytes:
    """Return a JPEG that triggers the ``bright_image`` artifact flag."""
    return _make_jpeg(color=(250, 250, 250), size=size)


# ---------------------------------------------------------------------------
# Sub-AC 1: core contract — enhancer called, processed output returned
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_enhancer_returns_list_same_length_as_input() -> None:
    """``apply_enhancer`` returns one ``EnhancedImage`` per input image.

    This is the primary assertion of Sub-AC 1: given a list of raw images,
    the enhancer is called and a processed output of equal length is returned.
    """
    raw = [_make_jpeg(), _make_jpeg(color=(100, 80, 60))]
    results = apply_enhancer(raw)

    assert len(results) == len(
        raw
    ), f"Expected {len(raw)} enhanced images, got {len(results)}"


@pytest.mark.unit
def test_apply_enhancer_returns_enhanced_image_instances() -> None:
    """Each element of the output list is an ``EnhancedImage`` instance."""
    raw = [_make_jpeg()]
    results = apply_enhancer(raw)

    for i, result in enumerate(results):
        assert isinstance(
            result, EnhancedImage
        ), f"results[{i}] should be EnhancedImage, got {type(result).__name__}"


@pytest.mark.unit
def test_apply_enhancer_output_bytes_are_non_empty() -> None:
    """Processed image bytes must be non-empty for every output."""
    raw = [_make_jpeg(), _make_png()]
    results = apply_enhancer(raw)

    for i, result in enumerate(results):
        assert (
            result.image_bytes
        ), f"results[{i}].image_bytes must not be empty after enhancement"


@pytest.mark.unit
def test_apply_enhancer_output_bytes_differ_from_raw_input() -> None:
    """Enhancement modifies the bytes — output is not a passthrough.

    The de-slop pipeline (sharpness, contrast, saturation + JPEG re-encode)
    produces bytes that differ from the raw input. This test confirms the
    enhancer is not a no-op.
    """
    raw_jpeg = _make_jpeg()
    results = apply_enhancer([raw_jpeg])

    # The output is re-encoded JPEG with enhancement applied; it should
    # differ from the input (different enhancement params and JPEG encoding).
    # We assert on byte-inequality — any enhancement produces different bytes.
    assert (
        results[0].image_bytes != raw_jpeg
    ), "apply_enhancer must modify the image bytes; raw passthrough detected"


@pytest.mark.unit
def test_apply_enhancer_output_bytes_are_valid_jpeg() -> None:
    """The output bytes must be valid JPEG that Pillow can re-decode.

    Verifies that the re-encoding step produces a well-formed image, not
    corrupt bytes that downstream consumers would fail to display.
    """
    results = apply_enhancer([_make_jpeg()])
    enhanced_bytes = results[0].image_bytes

    decoded = Image.open(io.BytesIO(enhanced_bytes))
    decoded.verify()  # raises on corrupt JPEG headers


@pytest.mark.unit
def test_apply_enhancer_artifact_flags_is_tuple() -> None:
    """``artifact_flags`` must be a tuple (immutable) on every result."""
    results = apply_enhancer([_make_jpeg()])
    assert isinstance(results[0].artifact_flags, tuple), (
        f"artifact_flags should be a tuple, got "
        f"{type(results[0].artifact_flags).__name__}"
    )


@pytest.mark.unit
def test_apply_enhancer_empty_input_returns_empty_list() -> None:
    """``apply_enhancer([])`` returns an empty list immediately."""
    results = apply_enhancer([])
    assert results == []


@pytest.mark.unit
def test_apply_enhancer_three_images_returns_three_results() -> None:
    """Three input images → three output images (order preserved).

    Parametric extension of the length test to confirm the mapping is
    one-to-one at N=3 (a common "N장 후보" scenario from the Seed).
    """
    colors = [(200, 120, 100), (80, 180, 90), (50, 60, 200)]
    raw = [_make_jpeg(color=c) for c in colors]
    results = apply_enhancer(raw)

    assert len(results) == 3
    # All results are EnhancedImage instances with non-empty bytes.
    for i, result in enumerate(results):
        assert isinstance(result, EnhancedImage)
        assert result.image_bytes


@pytest.mark.unit
def test_apply_enhancer_accepts_png_input() -> None:
    """``apply_enhancer`` handles PNG input (not just JPEG).

    Fal.ai / Replicate may return PNG-encoded outputs; the enhancer must
    normalise any Pillow-supported format to JPEG output.
    """
    results = apply_enhancer([_make_png()])
    assert len(results) == 1
    assert results[0].image_bytes
    # Output should be re-encoded as JPEG regardless of input format.
    reloaded = Image.open(io.BytesIO(results[0].image_bytes))
    assert reloaded.format == "JPEG"


# ---------------------------------------------------------------------------
# Artifact flag detection
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_enhancer_dark_image_flag() -> None:
    """A very dark image receives the ``"dark_image"`` artifact flag."""
    results = apply_enhancer([_make_dark_jpeg()])
    assert "dark_image" in results[0].artifact_flags, (
        "A (10, 10, 10) image should be flagged as dark_image; "
        f"got flags: {results[0].artifact_flags}"
    )


@pytest.mark.unit
def test_apply_enhancer_bright_image_flag() -> None:
    """A very bright image receives the ``"bright_image"`` artifact flag."""
    results = apply_enhancer([_make_bright_jpeg()])
    assert "bright_image" in results[0].artifact_flags, (
        "A (250, 250, 250) image should be flagged as bright_image; "
        f"got flags: {results[0].artifact_flags}"
    )


@pytest.mark.unit
def test_apply_enhancer_no_flags_for_normal_image() -> None:
    """A typical portrait-range image produces no (or few) artifact flags.

    A mid-tone (R=180, G=150, B=130) solid-colour image is within normal
    portrait luminance range and moderate saturation, so it should not
    trigger the dark/bright/high-saturation flags.
    """
    results = apply_enhancer([_make_jpeg(color=(180, 150, 130))])
    flags = results[0].artifact_flags
    # Should not be dark or bright.
    assert "dark_image" not in flags
    assert "bright_image" not in flags


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_enhancer_rejects_empty_bytes_element() -> None:
    """An empty-bytes element raises ``ValueError`` naming the index."""
    with pytest.raises(ValueError, match=r"raw_images\[0\]"):
        apply_enhancer([b""])


@pytest.mark.unit
def test_apply_enhancer_rejects_non_decodable_bytes() -> None:
    """Bytes that are not a valid image raise ``ValueError`` naming the index."""
    with pytest.raises(ValueError, match=r"raw_images\[0\]"):
        apply_enhancer([b"this-is-not-an-image-at-all"])


@pytest.mark.unit
def test_apply_enhancer_rejects_empty_bytes_at_non_zero_index() -> None:
    """The error message names the *actual* offending index (not always 0)."""
    good = _make_jpeg()
    with pytest.raises(ValueError, match=r"raw_images\[1\]"):
        apply_enhancer([good, b""])


# ---------------------------------------------------------------------------
# Immutability of EnhancedImage DTO
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_enhanced_image_is_immutable() -> None:
    """``EnhancedImage`` is a frozen dataclass — no mutation after construction."""
    result = apply_enhancer([_make_jpeg()])[0]

    with pytest.raises(Exception):  # FrozenInstanceError from dataclasses
        result.image_bytes = b"tampered"  # type: ignore[misc]


@pytest.mark.unit
def test_enhanced_image_rejects_empty_bytes_at_construction() -> None:
    """``EnhancedImage`` constructor rejects empty ``image_bytes``."""
    with pytest.raises(ValueError, match="image_bytes"):
        EnhancedImage(image_bytes=b"", artifact_flags=())


@pytest.mark.unit
def test_enhanced_image_rejects_non_tuple_flags() -> None:
    """``EnhancedImage`` constructor rejects non-tuple ``artifact_flags``."""
    with pytest.raises(TypeError, match="artifact_flags"):
        EnhancedImage(
            image_bytes=b"nonempty",
            artifact_flags=["low_sharpness"],  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# Idempotence / determinism
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_enhancer_deterministic_output() -> None:
    """Calling ``apply_enhancer`` twice with the same input yields identical output.

    The enhancer is rule-based (no randomness, no external state), so
    identical input must always produce identical output.
    """
    raw = [_make_jpeg()]
    first = apply_enhancer(raw)
    second = apply_enhancer(raw)

    assert first[0].image_bytes == second[0].image_bytes
    assert first[0].artifact_flags == second[0].artifact_flags
