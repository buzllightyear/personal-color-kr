"""Tests for the optional garment upload validator (pivot milestone 1).

The garment field on ``POST /v1/generate`` is OPTIONAL (backward compat:
the current mobile client sends only ``recipe_id`` + ``selfie``).  When
present it follows the selfie validation contract (415/413, same limits)
plus one stricter check: a present-but-EMPTY file is rejected with HTTP 422
``{"detail": "empty_file"}`` — without this, zero bytes would sail through
the MIME/size checks and blow up as a ``ValueError`` (HTTP 500) inside
``GenerationInputs`` (its validation is a defensive backstop, not the
request-facing contract).
"""

from __future__ import annotations

import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from api.dependencies.garment_validation import (
    DETAIL_EMPTY_FILE,
    validate_garment_bytes,
    validate_optional_garment_upload,
)
from api.dependencies.selfie_validation import (
    DETAIL_PAYLOAD_TOO_LARGE,
    DETAIL_UNSUPPORTED_MEDIA_TYPE,
    MAX_SELFIE_BYTES,
)

_GARMENT_BYTES = b"FAKE_GARMENT_JPEG_BYTES"


# ---------------------------------------------------------------------------
# Pure validator
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_valid_jpeg_garment_returns_bytes_unchanged() -> None:
    assert validate_garment_bytes("image/jpeg", _GARMENT_BYTES) is _GARMENT_BYTES


@pytest.mark.unit
def test_valid_png_garment_returns_bytes_unchanged() -> None:
    assert validate_garment_bytes("image/png", _GARMENT_BYTES) is _GARMENT_BYTES


@pytest.mark.unit
def test_unsupported_content_type_raises_415() -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_garment_bytes("image/heic", _GARMENT_BYTES)
    assert exc_info.value.status_code == 415
    assert exc_info.value.detail == DETAIL_UNSUPPORTED_MEDIA_TYPE


@pytest.mark.unit
def test_missing_content_type_raises_415() -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_garment_bytes(None, _GARMENT_BYTES)
    assert exc_info.value.status_code == 415


@pytest.mark.unit
def test_oversized_garment_raises_413() -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_garment_bytes("image/jpeg", b"x" * (MAX_SELFIE_BYTES + 1))
    assert exc_info.value.status_code == 413
    assert exc_info.value.detail == DETAIL_PAYLOAD_TOO_LARGE


@pytest.mark.unit
def test_exactly_max_size_garment_is_accepted() -> None:
    data = b"x" * MAX_SELFIE_BYTES
    assert validate_garment_bytes("image/jpeg", data) is data


@pytest.mark.unit
def test_empty_garment_raises_422_not_500() -> None:
    """A present-but-empty garment part is a 422 wire error — it must never
    reach GenerationInputs, whose ValueError would surface as HTTP 500."""
    with pytest.raises(HTTPException) as exc_info:
        validate_garment_bytes("image/jpeg", b"")
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == DETAIL_EMPTY_FILE


@pytest.mark.unit
def test_content_type_checked_before_emptiness() -> None:
    """Empty AND wrong-typed → 415 (content-type check runs first, same
    ordering contract as the selfie validator)."""
    with pytest.raises(HTTPException) as exc_info:
        validate_garment_bytes("image/gif", b"")
    assert exc_info.value.status_code == 415


# ---------------------------------------------------------------------------
# Async dependency wrapper
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_absent_garment_returns_none() -> None:
    """No garment part in the multipart body → None (selfie-only request —
    the current mobile client's exact shape keeps working)."""
    assert asyncio.run(validate_optional_garment_upload(None)) is None


@pytest.mark.unit
def test_present_garment_is_read_and_validated() -> None:
    upload = UploadFile(
        BytesIO(_GARMENT_BYTES),
        filename="garment.jpg",
        headers=Headers({"content-type": "image/jpeg"}),
    )
    assert asyncio.run(validate_optional_garment_upload(upload)) == _GARMENT_BYTES


@pytest.mark.unit
def test_present_empty_garment_raises_422_via_wrapper() -> None:
    upload = UploadFile(
        BytesIO(b""),
        filename="garment.jpg",
        headers=Headers({"content-type": "image/jpeg"}),
    )
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(validate_optional_garment_upload(upload))
    assert exc_info.value.status_code == 422
