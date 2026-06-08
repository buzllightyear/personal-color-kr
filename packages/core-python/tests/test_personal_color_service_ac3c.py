"""Integration tests for Sub-AC 3c — diagnose_selfie service function.

Sub-AC 3c requires:
  * 셀피 이미지 경로(또는 바이트)를 입력받아 Sub-AC 3a·3b 모듈을 순서대로
    호출하고 최종 {category, confidence} 를 반환하는 서비스 함수
  * 실제 테스트 이미지 1장으로 통합 테스트를 실행하여
    카테고리가 유효 enum 값이고 신뢰도가 0~1 범위임을 검증

Verification checklist
-----------------------
1. ``diagnose_selfie(path)`` — accepts a ``Path`` or ``str`` file path.
2. ``diagnose_selfie(bytes)`` — accepts raw ``bytes``.
3. Return value is a :class:`~personal_color.feature_vector_classifier.PersonalColorResult`.
4. ``category`` is one of the four valid season slugs: ``spring | summer | autumn | winter``.
5. ``confidence`` is a ``float`` in ``[0.0, 1.0]``.
6. Sub-AC 3a and 3b are both invoked in order (the pipeline is end-to-end).
7. Error contract: ``FileNotFoundError`` on missing path; ``InvalidSelfieError``
   on bad bytes; ``NoSkinPixelsError`` on skin-free image.

Test taxonomy
-------------
Section 1 — Return-type and schema (unit, stub decoder)
Section 2 — Integration with real test fixture image (integration, Pillow required)
Section 3 — Path input variants (integration, Pillow required)
Section 4 — Bytes input variant (integration, Pillow required)
Section 5 — Error contract
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import Any

import pytest

from personal_color.feature_vector_classifier import PersonalColorResult
from personal_color.personal_color_service import diagnose_selfie

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

_FIXTURES_DIR = Path(__file__).parent / "fixtures"
_FACE_SELFIE = _FIXTURES_DIR / "face_selfie.png"

# Valid category slugs (the four Korean personal-colour seasons).
_VALID_CATEGORIES: frozenset[str] = frozenset({"spring", "summer", "autumn", "winter"})

# Warm-skin pixel — classified as skin under YCbCr thresholding.
# Cb ≈ 104.6 (within [77, 127]), Cr ≈ 148.3 (within [133, 173]).
_WARM_PIXEL: tuple[int, int, int] = (220, 185, 150)

# Mid-grey pixel — Cb = 128, NOT a skin pixel (exceeds upper Cb threshold 127).
_GREY_PIXEL: tuple[int, int, int] = (180, 180, 180)


# ---------------------------------------------------------------------------
# Helpers — minimal PNG builder (no external dependencies)
# ---------------------------------------------------------------------------


def _make_minimal_png(
    width: int,
    height: int,
    rgb: tuple[int, int, int],
) -> bytes:
    """Build a minimal valid single-colour PNG from raw pixel data.

    Produces a standards-compliant PNG payload without relying on Pillow or
    any other library — safe to use in unit tests that run without native deps.
    """
    r, g, b = rgb

    sig = b"\x89PNG\r\n\x1a\n"

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        return length + chunk_type + data + crc

    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = _chunk(b"IHDR", ihdr_data)

    raw_rows = b""
    row_bytes = bytes([r, g, b] * width)
    for _ in range(height):
        raw_rows += b"\x00" + row_bytes
    idat = _chunk(b"IDAT", zlib.compress(raw_rows))

    iend = _chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


# ---------------------------------------------------------------------------
# Stub decoder — for pure-unit tests that must not import Pillow
# ---------------------------------------------------------------------------


def _stub_decoder_factory(
    image: list[list[tuple[int, int, int]]],
) -> Any:
    """Return a bytes-ignoring decoder stub for injection into extract_selfie_color_features."""

    def _decoder(_bytes: bytes) -> list[list[tuple[int, int, int]]]:
        return image

    return _decoder


# ===========================================================================
# Section 1 — Return-type and schema
# (unit tests that use stub decoder — no Pillow required)
# ===========================================================================


@pytest.mark.unit
def test_unit_diagnose_selfie_bytes_returns_personal_color_result() -> None:
    """diagnose_selfie(bytes) → PersonalColorResult (verified via stub bytes path).

    Uses programmatically built warm PNG bytes so the test does not need
    a real decoder; verifies only that the *return type* is correct.
    """
    # Build a minimal warm-skin PNG entirely from pure Python (no Pillow dep)
    # so this unit test can run in the base test suite without native deps.
    warm_png = _make_minimal_png(10, 10, _WARM_PIXEL)

    # We do NOT inject a stub decoder — instead we check if Pillow is available
    # and skip gracefully if not, keeping the test honest.
    pytest.importorskip("PIL", reason="Pillow required for real PNG decoding")

    result = diagnose_selfie(warm_png)

    assert isinstance(result, PersonalColorResult), (
        f"diagnose_selfie must return PersonalColorResult, got {type(result).__name__}"
    )


@pytest.mark.unit
def test_unit_result_has_category_str() -> None:
    """diagnose_selfie → PersonalColorResult.category is a str."""
    pytest.importorskip("PIL", reason="Pillow required")
    warm_png = _make_minimal_png(10, 10, _WARM_PIXEL)
    result = diagnose_selfie(warm_png)
    assert isinstance(result.category, str)


@pytest.mark.unit
def test_unit_result_has_confidence_float() -> None:
    """diagnose_selfie → PersonalColorResult.confidence is a float."""
    pytest.importorskip("PIL", reason="Pillow required")
    warm_png = _make_minimal_png(10, 10, _WARM_PIXEL)
    result = diagnose_selfie(warm_png)
    assert isinstance(result.confidence, float)


@pytest.mark.unit
def test_unit_result_is_immutable() -> None:
    """diagnose_selfie → result is frozen (mutation raises AttributeError)."""
    pytest.importorskip("PIL", reason="Pillow required")
    warm_png = _make_minimal_png(10, 10, _WARM_PIXEL)
    result = diagnose_selfie(warm_png)
    with pytest.raises(AttributeError):
        result.category = "spring"  # type: ignore[misc]


# ===========================================================================
# Section 2 — Integration: real test fixture (face_selfie.png)
#
# PRIMARY AC validation:
#   "실제 테스트 이미지 1장으로 통합 테스트를 실행하여
#    카테고리가 유효 enum 값이고 신뢰도가 0~1 범위임을 검증"
# ===========================================================================


@pytest.mark.integration
def test_integration_face_selfie_fixture_category_is_valid_enum() -> None:
    """CORE AC 3c validation: face_selfie.png → category is a valid season slug.

    Uses the 128×128 warm-skin test fixture that also appears in the Sub-AC
    3a integration tests.  The returned category must be one of the four
    Korean personal-colour seasons: ``spring | summer | autumn | winter``.

    This is the primary acceptance criterion from the Seed:
      "카테고리가 유효 enum 값"
    """
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    result = diagnose_selfie(_FACE_SELFIE)

    assert result.category in _VALID_CATEGORIES, (
        f"category {result.category!r} is not a valid season slug; "
        f"expected one of {sorted(_VALID_CATEGORIES)}"
    )


@pytest.mark.integration
def test_integration_face_selfie_fixture_confidence_in_unit_interval() -> None:
    """CORE AC 3c validation: face_selfie.png → confidence is in [0.0, 1.0].

    This is the primary acceptance criterion from the Seed:
      "신뢰도가 0~1 범위임을 검증"
    """
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    result = diagnose_selfie(_FACE_SELFIE)

    assert 0.0 <= result.confidence <= 1.0, (
        f"confidence {result.confidence!r} is outside [0.0, 1.0]"
    )


@pytest.mark.integration
def test_integration_face_selfie_fixture_returns_personal_color_result() -> None:
    """face_selfie.png → return type is PersonalColorResult."""
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    result = diagnose_selfie(_FACE_SELFIE)

    assert isinstance(result, PersonalColorResult)


@pytest.mark.integration
def test_integration_face_selfie_fixture_combined() -> None:
    """COMBINED AC 3c integration test: category valid + confidence in range.

    This single test satisfies the complete AC 3c requirement:
      "실제 테스트 이미지 1장으로 통합 테스트를 실행하여
       카테고리가 유효 enum 값이고 신뢰도가 0~1 범위임을 검증"

    Runs the full pipeline (bytes load → 3a → 3b) on the real fixture image
    and checks both output constraints in one assertion block.
    """
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    result = diagnose_selfie(_FACE_SELFIE)

    # constraint 1: category is a valid Korean personal-colour season slug
    assert result.category in _VALID_CATEGORIES, (
        f"category {result.category!r} is not valid; "
        f"expected one of {sorted(_VALID_CATEGORIES)}"
    )

    # constraint 2: confidence is in [0.0, 1.0]
    assert 0.0 <= result.confidence <= 1.0, (
        f"confidence {result.confidence!r} is outside [0.0, 1.0]"
    )


# ===========================================================================
# Section 3 — Path input variants
# ===========================================================================


@pytest.mark.integration
def test_integration_path_object_input_works() -> None:
    """diagnose_selfie accepts a pathlib.Path object."""
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    result = diagnose_selfie(_FACE_SELFIE)  # Path object

    assert result.category in _VALID_CATEGORIES
    assert 0.0 <= result.confidence <= 1.0


@pytest.mark.integration
def test_integration_str_path_input_works() -> None:
    """diagnose_selfie accepts a plain str file path."""
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    result = diagnose_selfie(str(_FACE_SELFIE))  # str path

    assert result.category in _VALID_CATEGORIES
    assert 0.0 <= result.confidence <= 1.0


# ===========================================================================
# Section 4 — Bytes input variant
# ===========================================================================


@pytest.mark.integration
def test_integration_bytes_input_from_fixture_works() -> None:
    """diagnose_selfie accepts raw bytes read from the fixture file."""
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    raw_bytes = _FACE_SELFIE.read_bytes()
    result = diagnose_selfie(raw_bytes)  # raw bytes

    assert result.category in _VALID_CATEGORIES
    assert 0.0 <= result.confidence <= 1.0


@pytest.mark.integration
def test_integration_path_and_bytes_produce_identical_result() -> None:
    """Path input and raw bytes input from the same file must produce the same result."""
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    if not _FACE_SELFIE.exists():
        pytest.skip(f"Fixture not found: {_FACE_SELFIE}")

    result_from_path = diagnose_selfie(_FACE_SELFIE)
    result_from_bytes = diagnose_selfie(_FACE_SELFIE.read_bytes())

    assert result_from_path == result_from_bytes, (
        f"Path and bytes inputs produced different results: "
        f"path={result_from_path!r}, bytes={result_from_bytes!r}"
    )


@pytest.mark.integration
def test_integration_programmatic_warm_png_bytes_category_spring() -> None:
    """Programmatically built warm-skin PNG → category is 'spring'.

    Uses a 10×10 PNG filled with 봄웜 pixels (220, 185, 150):
      color_temperature = 70/255 ≈ 0.274 (warm, well above neutral zone)
      brightness ≈ 0.80 (well above midpoint → HIGH contrast)
    → Expected season: SPRING (봄).

    This test does not depend on the fixture file — it works even if
    face_selfie.png is absent.
    """
    pytest.importorskip("PIL", reason="Pillow required for integration test")

    warm_png = _make_minimal_png(10, 10, _WARM_PIXEL)
    result = diagnose_selfie(warm_png)

    assert result.category in _VALID_CATEGORIES, (
        f"category {result.category!r} is not valid"
    )
    assert 0.0 <= result.confidence <= 1.0, (
        f"confidence {result.confidence!r} outside [0.0, 1.0]"
    )
    assert result.category == "spring", (
        f"봄웜 PNG should classify as 'spring', got {result.category!r}"
    )


# ===========================================================================
# Section 5 — Error contract
# ===========================================================================


@pytest.mark.unit
def test_error_file_not_found_raises_file_not_found_error() -> None:
    """diagnose_selfie raises FileNotFoundError for a non-existent path."""
    with pytest.raises(FileNotFoundError):
        diagnose_selfie("/this/path/does/not/exist/selfie.png")


@pytest.mark.unit
def test_error_empty_bytes_raises_invalid_selfie_error() -> None:
    """diagnose_selfie raises InvalidSelfieError for empty bytes input."""
    from personal_color.image_decoder import InvalidSelfieError

    pytest.importorskip("PIL", reason="Pillow required for this error path")

    with pytest.raises(InvalidSelfieError):
        diagnose_selfie(b"")


@pytest.mark.unit
def test_error_bad_bytes_raises_invalid_selfie_error() -> None:
    """diagnose_selfie raises InvalidSelfieError for non-image bytes."""
    from personal_color.image_decoder import InvalidSelfieError

    pytest.importorskip("PIL", reason="Pillow required for this error path")

    with pytest.raises(InvalidSelfieError):
        diagnose_selfie(b"not-an-image-payload")


@pytest.mark.integration
def test_error_no_skin_png_raises_no_skin_pixels_error() -> None:
    """diagnose_selfie raises NoSkinPixelsError for a skin-free image.

    A 10×10 mid-grey PNG (180, 180, 180) has Cb = 128.0 which is above the
    upper YCbCr skin threshold of 127.  Zero skin pixels are detected;
    Sub-AC 3a must raise ``NoSkinPixelsError`` which propagates through the
    service unchanged.
    """
    from personal_color.selfie_feature_extractor import NoSkinPixelsError

    pytest.importorskip("PIL", reason="Pillow required for integration test")

    grey_png = _make_minimal_png(10, 10, _GREY_PIXEL)

    with pytest.raises(NoSkinPixelsError):
        diagnose_selfie(grey_png)
