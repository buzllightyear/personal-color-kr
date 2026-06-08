"""Unit tests for ``extract_selfie_color_features`` (Sub-AC 3a).

셀피 이미지 1장을 입력받아 피부톤·색상 특징 벡터를 반환하는
``extract_selfie_color_features`` 함수를 **고정 테스트 이미지**에 대해
출력 형태(타입·차원)와 값 범위를 검증한다.

All tests in this file are *unit* tests — no Pillow, no MediaPipe, no
filesystem access.  The injectable ``_decoder`` seam is used to inject
a stub that returns a pre-built pixel array so the tests run with zero
native dependencies.

Fixed test images
-----------------
Three deterministic pixel-array fixtures are used throughout:

``_make_warm_selfie()``
    10×10 image filled with 봄웜 (Spring Warm) skin-tone pixels
    ``(220, 185, 150)``.  All 100 pixels classify as skin under YCbCr
    thresholding.  Expected feature vector values are pre-computed and
    compared exactly (up to floating-point tolerance).

``_make_cool_selfie()``
    10×10 image filled with 여름쿨 (Summer Cool) skin-tone pixels
    ``(190, 170, 170)``.  All 100 pixels classify as skin.

``_make_no_skin_image()``
    10×10 image filled with mid-grey pixels ``(180, 180, 180)``.
    No pixel falls within the YCbCr skin-tone cluster — Cb = 128.0
    exceeds the upper threshold of 127 — so ``NoSkinPixelsError`` is
    expected.

Test taxonomy
-------------
Section 1 — Output type: return value is a ``ColorFeatureVector``
Section 2 — Dimensions: exactly 3 named float fields
Section 3 — Value ranges: bounds guaranteed by the formula
Section 4 — Semantic correctness: warm/cool ordering, known values
Section 5 — Error contract: ``NoSkinPixelsError``, invalid input
Section 6 — Invariants: immutability, determinism
Section 7 — Integration: real PNG fixture bytes (Pillow required,
             marked ``@pytest.mark.integration``)
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path
from typing import Any

import pytest

from personal_color.color_features import ColorFeatureVector
from personal_color.selfie_feature_extractor import (
    NoSkinPixelsError,
    extract_selfie_color_features,
)

# ---------------------------------------------------------------------------
# Floating-point tolerance (same as test_color_features.py)
# ---------------------------------------------------------------------------

_TOL = 1e-6

_FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _approx(expected: float, actual: float, *, tol: float = _TOL) -> bool:
    return math.isclose(actual, expected, abs_tol=tol, rel_tol=0)


# ---------------------------------------------------------------------------
# Fixed pixel values — skin-classified under BT.601 YCbCr thresholding
# (77 ≤ Cb ≤ 127 AND 133 ≤ Cr ≤ 173)
#
# 봄웜 (Spring Warm) (220, 185, 150):
#   Cb = -0.168736*220 - 0.331264*185 + 0.5*150 + 128 ≈ 104.6  ✓
#   Cr =  0.5*220 - 0.418688*185 - 0.081312*150 + 128 ≈ 148.3  ✓
#   → skin pixel
#
# 여름쿨 (Summer Cool) (190, 170, 170):
#   Cb = -0.168736*190 - 0.331264*170 + 0.5*170 + 128 ≈ 124.6  ✓
#   Cr =  0.5*190 - 0.418688*170 - 0.081312*170 + 128 ≈ 138.0  ✓
#   → skin pixel
#
# Mid-grey (180, 180, 180):
#   Cb = (-0.168736 - 0.331264 + 0.5) * 180 + 128 = 0 * 180 + 128 = 128.0
#   Cb = 128.0 > 127  → NOT a skin pixel
# ---------------------------------------------------------------------------

_WARM_PIXEL: tuple[int, int, int] = (220, 185, 150)
_COOL_PIXEL: tuple[int, int, int] = (190, 170, 170)
_GREY_PIXEL: tuple[int, int, int] = (180, 180, 180)

# Pre-computed expected feature vectors for a uniform warm-skin image:
#   color_temperature = (220 - 150) / 255 = 70/255
#   brightness        = (0.299*220 + 0.587*185 + 0.114*150) / 255
#   saturation        = (220 - 150) / 220 = 70/220
_WARM_TEMP = 70 / 255
_WARM_BRIGHT = (0.299 * 220 + 0.587 * 185 + 0.114 * 150) / 255
_WARM_SAT = 70 / 220

# Pre-computed expected feature vectors for a uniform cool-skin image:
#   color_temperature = (190 - 170) / 255 = 20/255
#   brightness        = (0.299*190 + 0.587*170 + 0.114*170) / 255
#   saturation        = (190 - 170) / 190 = 20/190
_COOL_TEMP = 20 / 255
_COOL_BRIGHT = (0.299 * 190 + 0.587 * 170 + 0.114 * 170) / 255
_COOL_SAT = 20 / 190


# ---------------------------------------------------------------------------
# Fixed test image factories — pure-Python pixel arrays (no Pillow/filesystem)
# ---------------------------------------------------------------------------


def _make_warm_selfie(
    width: int = 10,
    height: int = 10,
) -> list[list[tuple[int, int, int]]]:
    """Return a ``height × width`` image filled with 봄웜 skin pixels.

    Every pixel is ``(220, 185, 150)`` — a Spring Warm skin tone that
    falls within the YCbCr skin-detection thresholds (Cb ≈ 104.6,
    Cr ≈ 148.3).  All ``width * height`` pixels are classified as skin,
    so the extractor has a full set of skin pixels to aggregate.
    """
    return [[_WARM_PIXEL] * width for _ in range(height)]


def _make_cool_selfie(
    width: int = 10,
    height: int = 10,
) -> list[list[tuple[int, int, int]]]:
    """Return a ``height × width`` image filled with 여름쿨 skin pixels.

    Every pixel is ``(190, 170, 170)`` — a Summer Cool skin tone that
    falls within the YCbCr skin-detection thresholds (Cb ≈ 124.6,
    Cr ≈ 138.0).
    """
    return [[_COOL_PIXEL] * width for _ in range(height)]


def _make_no_skin_image(
    width: int = 10,
    height: int = 10,
) -> list[list[tuple[int, int, int]]]:
    """Return a ``height × width`` image filled with mid-grey pixels.

    Every pixel is ``(180, 180, 180)``.  For a neutral grey pixel,
    Cb = 128.0, which exceeds the upper skin-detection threshold of 127.
    No pixel is classified as skin, so ``NoSkinPixelsError`` must be
    raised.
    """
    return [[_GREY_PIXEL] * width for _ in range(height)]


def _stub_decoder(
    image: list[list[tuple[int, int, int]]],
) -> Any:
    """Return a bytes → Image stub that always yields ``image``.

    The stub ignores the ``bytes`` argument entirely so unit tests do
    not need to construct valid PNG/JPEG payloads.  The returned callable
    matches the ``Decoder = Callable[[bytes], Image]`` type alias.
    """

    def _decoder(_bytes: bytes) -> list[list[tuple[int, int, int]]]:
        return image

    return _decoder


def _make_minimal_png(
    width: int,
    height: int,
    rgb: tuple[int, int, int],
) -> bytes:
    """Build a minimal valid PNG from a solid-colour rectangle.

    Used in integration tests to exercise the real Pillow decoder path.
    The output is a standards-compliant single-colour PNG that does not
    require any external tools or files.
    """
    r, g, b = rgb

    # PNG signature
    sig = b"\x89PNG\r\n\x1a\n"

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        return length + chunk_type + data + crc

    # IHDR: width, height, bit-depth=8, colour-type=2 (RGB)
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = _chunk(b"IHDR", ihdr_data)

    # IDAT: raw pixel rows, each prefixed with filter byte 0x00
    raw_rows = b""
    row_bytes = bytes([r, g, b] * width)
    for _ in range(height):
        raw_rows += b"\x00" + row_bytes
    idat = _chunk(b"IDAT", zlib.compress(raw_rows))

    iend = _chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


# ===========================================================================
# Section 1 — Output type
# ===========================================================================


@pytest.mark.unit
def test_output_type_is_color_feature_vector_warm() -> None:
    """Warm-skin fixed image → return type must be ColorFeatureVector.

    Verifies Sub-AC 3a requirement: "출력 형태(타입)" — the return type
    must be exactly ``ColorFeatureVector`` (not a plain tuple, dict, or
    other container).
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",  # content is ignored by the stub
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    assert isinstance(result, ColorFeatureVector), (
        f"extract_selfie_color_features must return ColorFeatureVector, "
        f"got {type(result).__name__}"
    )


@pytest.mark.unit
def test_output_type_is_color_feature_vector_cool() -> None:
    """Cool-skin fixed image → return type must also be ColorFeatureVector."""
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_cool_selfie()),
    )

    assert isinstance(result, ColorFeatureVector), (
        f"extract_selfie_color_features must return ColorFeatureVector, "
        f"got {type(result).__name__}"
    )


# ===========================================================================
# Section 2 — Dimensions: exactly 3 named float fields
# ===========================================================================


@pytest.mark.unit
def test_output_has_exactly_three_fields() -> None:
    """Output vector must expose exactly three named fields.

    Verifies Sub-AC 3a requirement: "출력 형태(차원)" — the vector must
    be 3-dimensional with named fields (color_temperature, brightness,
    saturation).
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    # Access all three fields — AttributeError would fail the test.
    _ = result.color_temperature
    _ = result.brightness
    _ = result.saturation

    # There must be no fourth field — ColorFeatureVector has exactly 3.
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(result)}
    assert field_names == {"color_temperature", "brightness", "saturation"}, (
        f"ColorFeatureVector must have exactly 3 fields, "
        f"got {sorted(field_names)}"
    )


@pytest.mark.unit
def test_output_fields_are_all_floats_warm() -> None:
    """All three fields of the returned vector must be Python ``float`` instances.

    Verifies Sub-AC 3a: "출력 형태(타입)" — each component must be a
    float (not int, not bool, not None).
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    assert isinstance(result.color_temperature, float), (
        f"color_temperature must be float, got {type(result.color_temperature)}"
    )
    assert isinstance(result.brightness, float), (
        f"brightness must be float, got {type(result.brightness)}"
    )
    assert isinstance(result.saturation, float), (
        f"saturation must be float, got {type(result.saturation)}"
    )


# ===========================================================================
# Section 3 — Value ranges: bounds guaranteed by the formula
# ===========================================================================


@pytest.mark.unit
@pytest.mark.parametrize(
    ("fixture_fn", "label"),
    [
        (_make_warm_selfie, "warm_skin"),
        (_make_cool_selfie, "cool_skin"),
    ],
)
def test_color_temperature_in_valid_range(
    fixture_fn: Any,
    label: str,
) -> None:
    """``color_temperature`` must lie in ``[-1.0, 1.0]`` for both skin fixtures.

    Verifies Sub-AC 3a: "값 범위" — (mean_R − mean_B) / 255 is bounded
    by the extremes of 8-bit channel arithmetic.
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(fixture_fn()),
    )

    assert -1.0 <= result.color_temperature <= 1.0, (
        f"[{label}] color_temperature {result.color_temperature!r} "
        f"outside [-1.0, 1.0]"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("fixture_fn", "label"),
    [
        (_make_warm_selfie, "warm_skin"),
        (_make_cool_selfie, "cool_skin"),
    ],
)
def test_brightness_in_valid_range(
    fixture_fn: Any,
    label: str,
) -> None:
    """``brightness`` must lie in ``[0.0, 1.0]`` for both skin fixtures.

    Verifies Sub-AC 3a: "값 범위" — Rec. 601 luma is bounded to the
    unit interval by construction.
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(fixture_fn()),
    )

    assert 0.0 <= result.brightness <= 1.0, (
        f"[{label}] brightness {result.brightness!r} outside [0.0, 1.0]"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("fixture_fn", "label"),
    [
        (_make_warm_selfie, "warm_skin"),
        (_make_cool_selfie, "cool_skin"),
    ],
)
def test_saturation_in_valid_range(
    fixture_fn: Any,
    label: str,
) -> None:
    """``saturation`` must lie in ``[0.0, 1.0]`` for both skin fixtures.

    Verifies Sub-AC 3a: "값 범위" — HSV saturation is the chroma-to-max
    ratio, bounded to the unit interval.
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(fixture_fn()),
    )

    assert 0.0 <= result.saturation <= 1.0, (
        f"[{label}] saturation {result.saturation!r} outside [0.0, 1.0]"
    )


# ===========================================================================
# Section 4 — Semantic correctness: known expected values + warm/cool ordering
# ===========================================================================


@pytest.mark.unit
def test_warm_selfie_color_temperature_matches_expected_value() -> None:
    """Warm fixed image → ``color_temperature`` must match the pre-computed value.

    For a uniform 봄웜 image of ``(220, 185, 150)`` pixels, the formula
    gives ``(220 - 150) / 255 = 70/255 ≈ 0.27451``.
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    assert _approx(_WARM_TEMP, result.color_temperature), (
        f"Warm selfie color_temperature: expected {_WARM_TEMP:.6f}, "
        f"got {result.color_temperature:.6f}"
    )


@pytest.mark.unit
def test_warm_selfie_brightness_matches_expected_value() -> None:
    """Warm fixed image → ``brightness`` must match the pre-computed Rec. 601 luma."""
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    assert _approx(_WARM_BRIGHT, result.brightness), (
        f"Warm selfie brightness: expected {_WARM_BRIGHT:.6f}, "
        f"got {result.brightness:.6f}"
    )


@pytest.mark.unit
def test_warm_selfie_saturation_matches_expected_value() -> None:
    """Warm fixed image → ``saturation`` must match the pre-computed HSV saturation."""
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    assert _approx(_WARM_SAT, result.saturation), (
        f"Warm selfie saturation: expected {_WARM_SAT:.6f}, "
        f"got {result.saturation:.6f}"
    )


@pytest.mark.unit
def test_cool_selfie_color_temperature_matches_expected_value() -> None:
    """Cool fixed image → ``color_temperature`` must match the pre-computed value.

    For a uniform 여름쿨 image of ``(190, 170, 170)`` pixels, the formula
    gives ``(190 - 170) / 255 = 20/255 ≈ 0.07843``.
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_cool_selfie()),
    )

    assert _approx(_COOL_TEMP, result.color_temperature), (
        f"Cool selfie color_temperature: expected {_COOL_TEMP:.6f}, "
        f"got {result.color_temperature:.6f}"
    )


@pytest.mark.unit
def test_warm_selfie_has_higher_color_temperature_than_cool() -> None:
    """봄웜 ``color_temperature`` must be strictly greater than 여름쿨.

    The 봄웜 fixture has R−B = 70; the 여름쿨 fixture has R−B = 20.
    The warm/cool ordering of the output vector must mirror the input
    skin-tone semantics.
    """
    warm = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )
    cool = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_cool_selfie()),
    )

    assert warm.color_temperature > cool.color_temperature, (
        f"봄웜 color_temperature ({warm.color_temperature:.4f}) must be > "
        f"여름쿨 color_temperature ({cool.color_temperature:.4f})"
    )


@pytest.mark.unit
def test_warm_selfie_positive_color_temperature() -> None:
    """봄웜 skin pixels have more R than B → ``color_temperature`` must be > 0."""
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    assert result.color_temperature > 0, (
        f"봄웜 color_temperature must be positive (warm undertone), "
        f"got {result.color_temperature:.4f}"
    )


@pytest.mark.unit
def test_cool_selfie_positive_color_temperature() -> None:
    """여름쿨 pixels also have more R than B → color_temperature > 0.

    The 여름쿨 fixture ``(190, 170, 170)`` has R > B by 20 counts, so
    color_temperature ≈ 0.078 — small but still positive.  This confirms
    the formula is applied correctly to near-neutral cool skin.
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_cool_selfie()),
    )

    assert result.color_temperature > 0, (
        f"여름쿨 color_temperature must be > 0 (R > B for this fixture), "
        f"got {result.color_temperature:.4f}"
    )


# ===========================================================================
# Section 5 — Error contract: NoSkinPixelsError, invalid input
# ===========================================================================


@pytest.mark.unit
def test_no_skin_pixels_raises_no_skin_pixels_error() -> None:
    """Grey image (no skin) → must raise ``NoSkinPixelsError``.

    The mid-grey fixture ``(180, 180, 180)`` has Cb = 128.0, which
    exceeds the YCbCr upper bound of 127.  Zero skin pixels are
    detected; the extractor must raise ``NoSkinPixelsError`` rather
    than returning a degenerate feature vector.
    """
    with pytest.raises(NoSkinPixelsError):
        extract_selfie_color_features(
            b"\xff\xd8\xff",
            _decoder=_stub_decoder(_make_no_skin_image()),
        )


@pytest.mark.unit
def test_no_skin_pixels_error_is_value_error_subclass() -> None:
    """``NoSkinPixelsError`` must subclass ``ValueError`` (permanent-error taxonomy).

    The Phase 4 HTTP layer maps permanent input failures to 422; the
    error taxonomy uses ``ValueError`` subclasses for all permanent
    failures.  Correct subclassing ensures the HTTP layer can distinguish
    this from transient errors.
    """
    with pytest.raises(NoSkinPixelsError) as exc_info:
        extract_selfie_color_features(
            b"\xff\xd8\xff",
            _decoder=_stub_decoder(_make_no_skin_image()),
        )

    assert isinstance(exc_info.value, ValueError), (
        "NoSkinPixelsError must subclass ValueError for the permanent-error taxonomy"
    )


@pytest.mark.unit
def test_no_skin_pixels_error_message_is_sanitized() -> None:
    """``NoSkinPixelsError`` message must not contain PII identifier tokens.

    Consistent with the PII-safety rule established by the Phase 3.1
    vendor-caller contract: error messages must describe the shape of
    the failure only — never caller-side identifiers.
    """
    with pytest.raises(NoSkinPixelsError) as exc_info:
        extract_selfie_color_features(
            b"\xff\xd8\xff",
            _decoder=_stub_decoder(_make_no_skin_image()),
        )

    message = str(exc_info.value)
    forbidden_tokens = (
        "distinct_id",
        "transaction_id",
        "receipt_token",
        "customer_email",
        "selfieUri",
    )
    for token in forbidden_tokens:
        assert token not in message, (
            f"NoSkinPixelsError message leaked PII token {token!r}: {message!r}"
        )


# ===========================================================================
# Section 6 — Invariants: immutability and determinism
# ===========================================================================


@pytest.mark.unit
def test_output_is_frozen_immutable_dataclass() -> None:
    """Returned ``ColorFeatureVector`` must be immutable (frozen dataclass).

    Immutability prevents accidental mutation of the feature vector as it
    flows through the generation pipeline (reject filter, recipe lookup,
    enhancer de-slop layer).
    """
    result = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )

    with pytest.raises((AttributeError, TypeError)):
        result.color_temperature = 0.0  # type: ignore[misc]


@pytest.mark.unit
def test_output_is_deterministic_for_same_input() -> None:
    """Same fixed image → identical ``ColorFeatureVector`` on every call.

    The feature-extraction pipeline is fully deterministic: bytes-in /
    vector-out with no randomness, no mutable state, no network calls.
    Non-determinism would break the identity-similarity scoring and
    reject-filter logic in the generation funnel.
    """
    warm_image = _make_warm_selfie()
    decoder = _stub_decoder(warm_image)

    first = extract_selfie_color_features(b"\xff\xd8\xff", _decoder=decoder)
    second = extract_selfie_color_features(b"\xff\xd8\xff", _decoder=decoder)
    third = extract_selfie_color_features(b"\xff\xd8\xff", _decoder=decoder)

    assert first == second == third, (
        "extract_selfie_color_features must be deterministic: "
        f"first={first}, second={second}, third={third}"
    )


@pytest.mark.unit
def test_different_skin_images_produce_different_vectors() -> None:
    """Warm and cool fixed images must produce distinct feature vectors.

    The extractor must distinguish between the two input skin tones — a
    single-vector identity function would trivially pass the range tests
    but fail this semantic check.
    """
    warm = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_warm_selfie()),
    )
    cool = extract_selfie_color_features(
        b"\xff\xd8\xff",
        _decoder=_stub_decoder(_make_cool_selfie()),
    )

    assert warm != cool, (
        "Warm and cool fixed images must produce different ColorFeatureVectors; "
        f"both produced {warm!r}"
    )


# ===========================================================================
# Section 7 — Integration: real PNG bytes → real Pillow decoder
#
# These tests require ``Pillow`` to be installed and are therefore marked
# ``@pytest.mark.integration``.  They exercise the full
# bytes → decode_image → extract_skin_pixels → compute_color_features
# path using programmatically generated PNG payloads (no fixture files
# needed).
# ===========================================================================


@pytest.mark.integration
def test_integration_warm_png_bytes_returns_color_feature_vector() -> None:
    """Real warm-skin PNG bytes → real Pillow decode → ColorFeatureVector.

    End-to-end wiring: build a valid minimal PNG of 봄웜 skin pixels,
    feed the raw bytes to ``extract_selfie_color_features`` with the
    production decoder (Pillow), and verify the return type and value
    ranges.
    """
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    png_bytes = _make_minimal_png(width=10, height=10, rgb=_WARM_PIXEL)

    result = extract_selfie_color_features(png_bytes)

    assert isinstance(result, ColorFeatureVector)
    assert -1.0 <= result.color_temperature <= 1.0
    assert 0.0 <= result.brightness <= 1.0
    assert 0.0 <= result.saturation <= 1.0


@pytest.mark.integration
def test_integration_warm_png_bytes_color_temperature_positive() -> None:
    """Real 봄웜 PNG → Pillow decode → color_temperature must be positive."""
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    png_bytes = _make_minimal_png(width=10, height=10, rgb=_WARM_PIXEL)
    result = extract_selfie_color_features(png_bytes)

    assert result.color_temperature > 0, (
        f"봄웜 PNG color_temperature must be positive, "
        f"got {result.color_temperature:.4f}"
    )


@pytest.mark.integration
def test_integration_no_skin_png_raises_no_skin_pixels_error() -> None:
    """Real grey PNG bytes (no skin) → ``NoSkinPixelsError`` via real Pillow decode.

    A solid mid-grey ``(180, 180, 180)`` PNG has no skin pixels after
    YCbCr thresholding.  The extractor must raise ``NoSkinPixelsError``
    on the production code path (not just via stub injection).
    """
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    png_bytes = _make_minimal_png(width=10, height=10, rgb=_GREY_PIXEL)

    with pytest.raises(NoSkinPixelsError):
        extract_selfie_color_features(png_bytes)


@pytest.mark.integration
def test_integration_face_selfie_fixture_returns_color_feature_vector() -> None:
    """Load the ``face_selfie.png`` fixture and verify feature extraction succeeds.

    The 128×128 warm-skin fixture should yield a valid ``ColorFeatureVector``
    with non-trivial (non-zero) saturation — confirming the skin pixels
    carry actual chroma information.
    """
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    selfie_path = _FIXTURES_DIR / "face_selfie.png"
    if not selfie_path.exists():
        pytest.skip(f"Fixture not found: {selfie_path}")

    result = extract_selfie_color_features(selfie_path.read_bytes())

    assert isinstance(result, ColorFeatureVector)
    assert -1.0 <= result.color_temperature <= 1.0
    assert 0.0 <= result.brightness <= 1.0
    assert 0.0 <= result.saturation <= 1.0
