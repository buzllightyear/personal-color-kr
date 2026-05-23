"""Multipart selfie validation for ``POST /v1/diagnose`` (Sub-AC 5.2).

The Seed pins the validation contract for the ``selfie`` multipart-form field:

    Selfie validation order (before any pipeline call):
        (1) content-type ∈ {image/jpeg, image/png}, else HTTP 415 +
            ``{"detail": "unsupported_media_type"}``.
        (2) byte length ≤ 10 * 1024 * 1024 (10 MiB), else HTTP 413 +
            ``{"detail": "payload_too_large"}``.
    Validation occurs in the handler/dependency, NOT inside the diagnose
    pipeline.

This module owns that contract and exposes two complementary surfaces so the
validation logic stays independently testable:

    - ``validate_selfie_bytes(content_type, data) -> bytes``
        A pure function that runs the two checks in order and returns the
        validated bytes unchanged on success. It depends only on the standard
        library + ``fastapi.HTTPException``; it never touches I/O. The unit
        test (``tests/unit/test_selfie_validation.py``) drives this function
        directly with raw ``bytes`` and string ``content_type`` arguments, so
        no FastAPI app, no multipart parser, and no event loop is required.

    - ``validate_selfie_upload(selfie: UploadFile) -> bytes``
        A FastAPI ``Depends(...)``-injectable async wrapper that reads the
        multipart upload into memory and forwards the bytes + the upload's
        content-type to ``validate_selfie_bytes``. This is the surface the
        ``POST /v1/diagnose`` route binds via ``Depends(validate_selfie_upload)``.

Phase 4.1 invariants honored here:
    - Zero PII persistence: selfie bytes live only in caller-local memory.
      The validator never logs the payload, never writes it to disk, and
      never embeds it in an ``HTTPException`` detail string.
    - Zero ``sqlalchemy*`` / ``mediapipe`` / ``Pillow`` imports — the
      validator is pure stdlib + FastAPI's HTTP error type.
    - Zero production branches on test/mock env flags — the validator
      behaves identically in unit, integration, and production runs.
    - The two error-detail strings (``"unsupported_media_type"`` /
      ``"payload_too_large"``) are stable wire constants; they form the
      handler-visible error contract used by mobile clients.
"""

from __future__ import annotations

from typing import Final

from fastapi import File, HTTPException, UploadFile, status

# ---------------------------------------------------------------------------
# Wire constants (Seed-pinned — do not change without a Seed update)
# ---------------------------------------------------------------------------

#: Maximum accepted selfie size in bytes. The Seed pins this at exactly
#: ``10 * 1024 * 1024`` (10 MiB). A payload of *exactly* this size is
#: accepted; one byte over is rejected with HTTP 413.
MAX_SELFIE_BYTES: Final[int] = 10 * 1024 * 1024

#: The exclusive set of accepted MIME types for the ``selfie`` field. The
#: Seed enumerates JPEG and PNG only; everything else (including
#: ``image/heic``, ``image/webp``, ``image/gif``, ``application/octet-stream``,
#: and a missing / ``None`` content-type) is rejected with HTTP 415.
ALLOWED_CONTENT_TYPES: Final[frozenset[str]] = frozenset(
    {"image/jpeg", "image/png"},
)

#: Wire detail for HTTP 415 responses. The constant exists so test code can
#: assert on the exact string without typo-prone literal duplication.
DETAIL_UNSUPPORTED_MEDIA_TYPE: Final[str] = "unsupported_media_type"

#: Wire detail for HTTP 413 responses. Same rationale as above.
DETAIL_PAYLOAD_TOO_LARGE: Final[str] = "payload_too_large"


# ---------------------------------------------------------------------------
# Pure validator (the testable seam)
# ---------------------------------------------------------------------------


def validate_selfie_bytes(content_type: str | None, data: bytes) -> bytes:
    """Validate a selfie payload and return the bytes unchanged on success.

    The checks run in the Seed-mandated order: content-type first, then
    byte length. This ordering matters for the negative-path contract — a
    payload that is *both* oversized *and* of an unsupported content type
    must produce HTTP 415 (not 413), because the content-type check is
    cheaper and runs first.

    Parameters
    ----------
    content_type:
        The MIME type advertised by the multipart upload. ``UploadFile``
        exposes this as ``Optional[str]``; ``None`` is treated as "no
        content-type advertised" and rejected with HTTP 415.
    data:
        The raw selfie bytes. Caller is responsible for buffering — this
        validator reads ``len(data)`` only and never iterates the buffer.

    Returns
    -------
    bytes
        The exact same ``data`` reference passed in. Returned unchanged so
        the caller (the ``POST /v1/diagnose`` handler) can pass the bytes
        directly to ``asyncio.to_thread(diagnose_personal_color, data)``
        without an extra copy.

    Raises
    ------
    HTTPException
        Status 415 ``{"detail": "unsupported_media_type"}`` if
        ``content_type`` is not in :data:`ALLOWED_CONTENT_TYPES`.
    HTTPException
        Status 413 ``{"detail": "payload_too_large"}`` if ``len(data)``
        exceeds :data:`MAX_SELFIE_BYTES`.
    """
    # Check 1 — content-type. ``None`` (no content-type advertised) and any
    # type outside the allow-list both map to HTTP 415. We compare against
    # the literal MIME string, not a structured media-type parser, because
    # the Seed pins the set to two exact strings. If a client sends
    # ``image/jpeg; charset=binary`` the multipart parser strips the
    # parameters before ``UploadFile.content_type`` is set, so this exact
    # comparison is safe for well-formed clients.
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=DETAIL_UNSUPPORTED_MEDIA_TYPE,
        )

    # Check 2 — byte length. The Seed uses ``≤ 10 MiB``, so equality is
    # accepted. We rely on ``len(data)`` (O(1) for ``bytes``) instead of
    # streaming so the validator does not need to be async; this keeps the
    # function callable from the unit test without an event loop.
    if len(data) > MAX_SELFIE_BYTES:
        # Starlette renamed ``HTTP_413_REQUEST_ENTITY_TOO_LARGE`` →
        # ``HTTP_413_CONTENT_TOO_LARGE`` in line with RFC 9110, which
        # supersedes RFC 7231 and renames the status to "Content Too
        # Large". Both names map to the same numeric status (413); we use
        # the modern alias to avoid a per-call DeprecationWarning.
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=DETAIL_PAYLOAD_TOO_LARGE,
        )

    return data


# ---------------------------------------------------------------------------
# FastAPI dependency wrapper
# ---------------------------------------------------------------------------


async def validate_selfie_upload(
    selfie: UploadFile = File(..., description="JPEG or PNG selfie, ≤ 10 MiB."),
) -> bytes:
    """FastAPI ``Depends(...)`` wrapper around :func:`validate_selfie_bytes`.

    Reads the entire multipart upload into memory, then forwards the bytes
    and the upload's advertised content-type to the pure validator.

    Parameters
    ----------
    selfie:
        FastAPI's multipart upload wrapper. Bound via ``File(...)`` so
        FastAPI generates the correct multipart-form schema and rejects
        requests that omit the field with HTTP 422 *before* this function
        runs.

    Returns
    -------
    bytes
        The validated selfie bytes, ready for
        ``asyncio.to_thread(diagnose_personal_color, ...)``.

    Raises
    ------
    HTTPException
        Propagated unchanged from :func:`validate_selfie_bytes`.
    """
    # ``UploadFile.read()`` with no argument reads the entire payload.
    # Per the Seed's zero-PII-persistence invariant, the bytes live in
    # this function's stack frame only and are returned by value to the
    # handler; no logging, no disk write, no copy into a long-lived
    # cache. The handler is responsible for ensuring the bytes are
    # forwarded to ``asyncio.to_thread`` and then dropped.
    data: bytes = await selfie.read()
    return validate_selfie_bytes(selfie.content_type, data)
