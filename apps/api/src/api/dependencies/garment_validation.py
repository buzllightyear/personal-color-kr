"""Optional multipart garment validation for ``POST /v1/generate`` (pivot M1).

The pivot (STRATEGY §10) makes the user's own garment photo an input to
generation.  At the API layer the field is OPTIONAL for backward
compatibility — the current mobile client sends only ``recipe_id`` +
``selfie`` and must keep working unchanged.

Contract (mirrors the selfie validator, one addition):

    (1) content-type ∈ {image/jpeg, image/png}, else HTTP 415 +
        ``{"detail": "unsupported_media_type"}``.
    (2) present-but-EMPTY file, HTTP 422 + ``{"detail": "empty_file"}``.
        The selfie validator has no such check; here it is required
        because zero bytes would pass MIME/size and then explode as a
        ``ValueError`` (HTTP 500) inside ``GenerationInputs`` — that
        validation is a defensive backstop, not the wire contract.
    (3) byte length ≤ 10 MiB, else HTTP 413 +
        ``{"detail": "payload_too_large"}``.

Zero-PII posture (docs/INVARIANTS.md #1): garment bytes live only in
caller-local memory on their way to fal's short-lived temp storage —
never logged, never written to our object storage or database.
"""

from __future__ import annotations

from typing import Final

from fastapi import File, HTTPException, UploadFile, status

from api.dependencies.selfie_validation import validate_selfie_bytes

#: Wire detail for HTTP 422 responses to a present-but-empty garment part.
DETAIL_EMPTY_FILE: Final[str] = "empty_file"


def validate_garment_bytes(content_type: str | None, data: bytes) -> bytes:
    """Validate a garment payload and return the bytes unchanged on success.

    Delegates the content-type (415) and size (413) checks to
    :func:`~api.dependencies.selfie_validation.validate_selfie_bytes`
    (identical limits — one image contract, two fields), then rejects an
    empty payload with HTTP 422.

    The content-type check runs first (same ordering contract as the
    selfie validator): an empty AND wrong-typed part yields 415, not 422.
    """
    validate_selfie_bytes(content_type, data)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=DETAIL_EMPTY_FILE,
        )
    return data


async def validate_optional_garment_upload(
    garment: UploadFile | None = File(
        None, description="Optional garment photo, JPEG or PNG, ≤ 10 MiB."
    ),
) -> bytes | None:
    """FastAPI ``Depends(...)`` wrapper — absent field means ``None``.

    ``File(None)`` keeps the field optional at the multipart-schema level,
    so requests without a ``garment`` part (every current mobile client)
    skip validation entirely and the handler receives ``None``.
    """
    if garment is None:
        return None
    data: bytes = await garment.read()
    return validate_garment_bytes(garment.content_type, data)
