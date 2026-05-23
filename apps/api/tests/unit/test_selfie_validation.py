"""Unit tests for ``api.dependencies.selfie_validation`` (Sub-AC 5.2).

These tests exercise the multipart selfie validator **independently of the
``POST /v1/diagnose`` endpoint** — no FastAPI app is constructed, no
``httpx.AsyncClient`` is started, and no event loop is required. The
validator's pure-function surface (``validate_selfie_bytes``) is driven
directly with raw ``bytes`` + ``content_type`` arguments so the accept /
reject branches can be asserted in isolation.

Sub-AC 5.2 verification matrix
------------------------------
The Seed pins the validation contract to two ordered checks:

    1. content-type ∈ {image/jpeg, image/png}, else HTTP 415 +
       ``{"detail": "unsupported_media_type"}``.
    2. byte length ≤ 10 * 1024 * 1024 (10 MiB), else HTTP 413 +
       ``{"detail": "payload_too_large"}``.

This file covers:

    Accept branches
        - ``image/jpeg`` + small payload.
        - ``image/png`` + small payload.
        - Exactly ``MAX_SELFIE_BYTES`` (boundary inclusive).
        - Zero-byte payload (size check passes; content-type-only contract).

    Reject branches — content-type (HTTP 415)
        - ``content_type=None`` (no header advertised).
        - ``"application/octet-stream"`` (raw binary).
        - ``"image/heic"`` / ``"image/webp"`` / ``"image/gif"`` (other image
          MIME types are explicitly disallowed).
        - Case-sensitive: ``"IMAGE/JPEG"`` is rejected (the Seed pins the
          exact lowercase strings).
        - Empty string ``""`` content-type.

    Reject branches — size (HTTP 413)
        - ``MAX_SELFIE_BYTES + 1`` (one byte over the boundary).
        - A clearly oversized payload (20 MiB) on each accepted MIME type.

    Ordering invariant
        - A payload that violates *both* checks must surface HTTP 415
          (content-type is checked first; size is a no-op if 415 fires).

    Identity / no-copy invariant
        - On success, ``validate_selfie_bytes`` returns the *same bytes
          reference* it was given (the Seed pins ``return data`` to avoid
          an extra copy before the handler hands the buffer to
          ``asyncio.to_thread``).

Notes on test design
--------------------
- We assert the error status code numerically (``415`` / ``413``) and the
  detail string (``"unsupported_media_type"`` / ``"payload_too_large"``)
  by comparing against the module-level wire constants exported by
  ``api.dependencies.selfie_validation``. This catches both code drift
  (status renumbering) and copy-paste drift on the detail strings.
- We do **not** construct a FastAPI app or call the ``POST /v1/diagnose``
  endpoint from this file. Endpoint-integrated coverage lives in a
  separate AC.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.dependencies.selfie_validation import (
    ALLOWED_CONTENT_TYPES,
    DETAIL_PAYLOAD_TOO_LARGE,
    DETAIL_UNSUPPORTED_MEDIA_TYPE,
    MAX_SELFIE_BYTES,
    validate_selfie_bytes,
)

# ---------------------------------------------------------------------------
# Module-level fixtures (cheap byte constants reused across parametrize)
# ---------------------------------------------------------------------------


#: A tiny JPEG-magic prefix. The validator never inspects byte content —
#: only ``len()`` — so any non-empty ``bytes`` value works. Using the JPEG
#: SOI marker makes the test fixtures self-documenting.
_TINY_JPEG_BYTES: bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 16

#: A tiny PNG-magic prefix. Same rationale as above.
_TINY_PNG_BYTES: bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


# ---------------------------------------------------------------------------
# Sanity: module-level wire constants match the Seed contract
# ---------------------------------------------------------------------------


class TestWireConstants:
    """The module-level constants must match the Seed contract exactly."""

    def test_max_selfie_bytes_is_exactly_10_mib(self) -> None:
        """The Seed pins the limit to ``10 * 1024 * 1024`` bytes (10 MiB)."""
        assert MAX_SELFIE_BYTES == 10 * 1024 * 1024
        # Defense in depth: catch a future binary/decimal drift.
        assert MAX_SELFIE_BYTES == 10_485_760

    def test_allowed_content_types_is_jpeg_and_png_only(self) -> None:
        """Only ``image/jpeg`` and ``image/png`` are accepted by Phase 4.1."""
        assert ALLOWED_CONTENT_TYPES == frozenset({"image/jpeg", "image/png"})

    def test_detail_constants_match_seed_wire_format(self) -> None:
        """Wire-detail strings are stable identifiers consumed by mobile."""
        assert DETAIL_UNSUPPORTED_MEDIA_TYPE == "unsupported_media_type"
        assert DETAIL_PAYLOAD_TOO_LARGE == "payload_too_large"


# ---------------------------------------------------------------------------
# Accept branch — valid content-type + within size limit
# ---------------------------------------------------------------------------


class TestAcceptsValidSelfie:
    """The validator accepts JPEG/PNG payloads at or below the size limit."""

    @pytest.mark.unit
    def test_accepts_small_jpeg(self) -> None:
        """A small ``image/jpeg`` payload validates and round-trips."""
        result = validate_selfie_bytes("image/jpeg", _TINY_JPEG_BYTES)
        assert result == _TINY_JPEG_BYTES

    @pytest.mark.unit
    def test_accepts_small_png(self) -> None:
        """A small ``image/png`` payload validates and round-trips."""
        result = validate_selfie_bytes("image/png", _TINY_PNG_BYTES)
        assert result == _TINY_PNG_BYTES

    @pytest.mark.unit
    def test_returns_same_bytes_reference(self) -> None:
        """``validate_selfie_bytes`` must return the exact same ``bytes``
        reference it was given — the Seed pins ``return data`` so the
        caller avoids an extra copy before ``asyncio.to_thread``.
        """
        payload = _TINY_JPEG_BYTES
        result = validate_selfie_bytes("image/jpeg", payload)
        assert result is payload

    @pytest.mark.unit
    def test_accepts_payload_at_exact_10_mib_boundary(self) -> None:
        """The ≤ comparison is inclusive: a payload of exactly 10 MiB is OK."""
        boundary_payload = b"\x00" * MAX_SELFIE_BYTES
        result = validate_selfie_bytes("image/jpeg", boundary_payload)
        # The result must be identical (same bytes) on success.
        assert result is boundary_payload
        assert len(result) == MAX_SELFIE_BYTES

    @pytest.mark.unit
    def test_accepts_zero_byte_payload(self) -> None:
        """A zero-byte body passes the size gate; content-type validity is
        the only requirement at the boundary.

        (Phase 3.2's pipeline will reject an empty body as
        ``InvalidSelfieError`` and the handler will map that to HTTP 400,
        but the *validator* itself only checks the two Seed-pinned rules.)
        """
        result = validate_selfie_bytes("image/png", b"")
        assert result == b""

    @pytest.mark.unit
    @pytest.mark.parametrize("content_type", ["image/jpeg", "image/png"])
    def test_accepts_each_allowed_content_type(self, content_type: str) -> None:
        """Both elements of ``ALLOWED_CONTENT_TYPES`` are independently
        accepted. The set contents are the source of truth; this test
        guards against an accidental ``ALLOWED_CONTENT_TYPES`` shrink.
        """
        result = validate_selfie_bytes(content_type, _TINY_JPEG_BYTES)
        assert result == _TINY_JPEG_BYTES


# ---------------------------------------------------------------------------
# Reject branch — unsupported content-type (HTTP 415)
# ---------------------------------------------------------------------------


class TestRejectsUnsupportedContentType:
    """Any content-type outside ``{image/jpeg, image/png}`` → HTTP 415."""

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "bad_content_type",
        [
            None,
            "",
            "application/octet-stream",
            "application/json",
            "text/plain",
            "image/heic",
            "image/heif",
            "image/webp",
            "image/gif",
            "image/bmp",
            "image/tiff",
            "image/svg+xml",
            # Case-sensitive: the Seed pins exact lowercase strings.
            "IMAGE/JPEG",
            "Image/Png",
            "image/JPEG",
            # Multipart parsers normally strip parameters, but if a client
            # leaks them through they should still be rejected by the exact
            # comparison.
            "image/jpeg; charset=binary",
            "image/png;boundary=----foo",
        ],
    )
    def test_raises_415_for_unsupported_type(
        self,
        bad_content_type: str | None,
    ) -> None:
        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes(bad_content_type, _TINY_JPEG_BYTES)

        assert exc_info.value.status_code == 415
        assert exc_info.value.detail == DETAIL_UNSUPPORTED_MEDIA_TYPE

    @pytest.mark.unit
    def test_none_content_type_is_rejected(self) -> None:
        """``UploadFile.content_type`` is ``Optional[str]``; ``None`` → 415."""
        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes(None, _TINY_PNG_BYTES)
        assert exc_info.value.status_code == 415
        assert exc_info.value.detail == DETAIL_UNSUPPORTED_MEDIA_TYPE


# ---------------------------------------------------------------------------
# Reject branch — payload too large (HTTP 413)
# ---------------------------------------------------------------------------


class TestRejectsOversizePayload:
    """A payload over 10 MiB with a valid content-type → HTTP 413."""

    @pytest.mark.unit
    def test_raises_413_one_byte_over_boundary(self) -> None:
        """``MAX_SELFIE_BYTES + 1`` is the smallest reject for size only."""
        payload = b"\x00" * (MAX_SELFIE_BYTES + 1)

        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes("image/jpeg", payload)

        assert exc_info.value.status_code == 413
        assert exc_info.value.detail == DETAIL_PAYLOAD_TOO_LARGE

    @pytest.mark.unit
    @pytest.mark.parametrize("content_type", ["image/jpeg", "image/png"])
    def test_raises_413_for_large_payload_each_type(
        self,
        content_type: str,
    ) -> None:
        """Each allowed content-type triggers HTTP 413 above the limit."""
        # 20 MiB is comfortably over the 10 MiB cap and stays well within
        # local-test memory budgets.
        payload = b"\x00" * (20 * 1024 * 1024)

        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes(content_type, payload)

        assert exc_info.value.status_code == 413
        assert exc_info.value.detail == DETAIL_PAYLOAD_TOO_LARGE


# ---------------------------------------------------------------------------
# Ordering invariant — content-type check runs first
# ---------------------------------------------------------------------------


class TestValidationOrdering:
    """When both checks would fail, content-type (415) wins over size (413).

    The Seed pins the order: ``(1) content-type ... (2) byte length ...``.
    This is observable when a request is *both* oversized *and* has an
    unsupported MIME type — the response must be HTTP 415, never 413.
    """

    @pytest.mark.unit
    def test_oversize_payload_with_bad_content_type_returns_415(self) -> None:
        """415 fires before the size check runs."""
        oversize = b"\x00" * (MAX_SELFIE_BYTES + 1)

        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes("application/octet-stream", oversize)

        # 415 — content-type was rejected before the size check ran.
        assert exc_info.value.status_code == 415
        assert exc_info.value.detail == DETAIL_UNSUPPORTED_MEDIA_TYPE

    @pytest.mark.unit
    def test_oversize_payload_with_none_content_type_returns_415(self) -> None:
        """None content-type AND oversize → still 415 (type check first)."""
        oversize = b"\x00" * (MAX_SELFIE_BYTES + 1)

        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes(None, oversize)

        assert exc_info.value.status_code == 415
        assert exc_info.value.detail == DETAIL_UNSUPPORTED_MEDIA_TYPE


# ---------------------------------------------------------------------------
# Zero-PII invariant — error details never leak payload bytes
# ---------------------------------------------------------------------------


class TestErrorMessagesDoNotLeakPayload:
    """``HTTPException.detail`` must be a stable wire constant, not the bytes.

    Phase 4.1 zero-PII-persistence invariant: selfie bytes never appear in
    any response body, error message, or log line. The validator's two
    error paths return *fixed* string constants — if a future refactor
    accidentally formats ``{data!r}`` into the detail field, this test
    catches it.
    """

    @pytest.mark.unit
    def test_415_detail_is_exact_constant(self) -> None:
        marker = b"SECRET_MARKER_BYTES_THAT_SHOULD_NEVER_LEAK"
        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes("image/gif", marker)
        assert exc_info.value.detail == DETAIL_UNSUPPORTED_MEDIA_TYPE
        assert "SECRET_MARKER" not in str(exc_info.value.detail)

    @pytest.mark.unit
    def test_413_detail_is_exact_constant(self) -> None:
        # An oversized payload whose first bytes are a distinctive marker.
        marker = b"SECRET_MARKER" + b"\x00" * (MAX_SELFIE_BYTES + 1)
        with pytest.raises(HTTPException) as exc_info:
            validate_selfie_bytes("image/jpeg", marker)
        assert exc_info.value.detail == DETAIL_PAYLOAD_TOO_LARGE
        assert "SECRET_MARKER" not in str(exc_info.value.detail)
