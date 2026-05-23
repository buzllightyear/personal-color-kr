"""Unit test for ``POST /v1/diagnose`` content-type rejection (AC6).

Acceptance criterion (AC6) being verified
-----------------------------------------
    ``POST /v1/diagnose`` with content-type ``image/gif`` returns HTTP 415 +
    ``{"detail": "unsupported_media_type"}``. Verified by a unit test.

This is the *endpoint-level* counterpart to the pure-function coverage in
``tests/unit/test_selfie_validation.py``. AC6 explicitly requires the
verification to happen through the full HTTP pipeline (multipart parser →
``validate_selfie_upload`` dependency → ``HTTPException`` → FastAPI's
JSON-rendered error body), not just through the pure ``validate_selfie_bytes``
function. A regression in the dependency wiring (e.g. the route forgetting to
bind ``Depends(validate_selfie_upload)``) would slip past the pure-function
unit test but is caught here.

Verification technique
----------------------
Constructs a fresh FastAPI app via :func:`api.main.create_app` and POSTs a
``multipart/form-data`` body whose ``selfie`` field declares the rejected MIME
type ``image/gif``. The request travels through:

    1. FastAPI's multipart parser (extracts the ``selfie`` ``UploadFile``).
    2. ``validate_selfie_upload`` (reads the body and forwards to the pure
       ``validate_selfie_bytes`` validator).
    3. ``validate_selfie_bytes`` rejects the content-type → ``HTTPException``
       with status 415 and detail ``"unsupported_media_type"``.
    4. FastAPI's exception handler serializes the ``HTTPException`` as the
       wire-format JSON body ``{"detail": "unsupported_media_type"}``.

No ``dependency_overrides`` are installed: the validator dependency runs in
its production configuration, and the diagnose callable is never reached
(the rejection fires *before* the handler body runs, so MediaPipe / Pillow
are not loaded by this test).

Invariants asserted
-------------------
1. HTTP status is exactly ``415``.
2. The JSON body is exactly ``{"detail": "unsupported_media_type"}`` — the
   detail string matches the Seed-pinned wire constant
   :data:`api.dependencies.selfie_validation.DETAIL_UNSUPPORTED_MEDIA_TYPE`.
3. ``Content-Type`` of the response is ``application/json`` (FastAPI's
   default for ``HTTPException`` rendering).
4. The response body has no additional fields — it is *exactly* a single
   ``detail`` key, never leaking the selfie bytes or any other PII.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.selfie_validation import DETAIL_UNSUPPORTED_MEDIA_TYPE
from api.main import create_app

# ---------------------------------------------------------------------------
# Fixtures — a deliberately invalid GIF-flagged payload
# ---------------------------------------------------------------------------


#: A small payload tagged as ``image/gif`` at the multipart level. The bytes
#: start with the GIF89a magic so the payload is "honest" — i.e. it would
#: actually be a real GIF if the validator only sniffed magic — but the
#: validator inspects the ``UploadFile.content_type`` header, not byte
#: content, so what matters is the multipart content-type the client sets.
_GIF_PAYLOAD: bytes = b"GIF89a" + b"\x00" * 64


# ---------------------------------------------------------------------------
# AC6 — image/gif → HTTP 415 + {"detail":"unsupported_media_type"}
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_post_v1_diagnose_with_image_gif_returns_415() -> None:
    """``POST /v1/diagnose`` with content-type ``image/gif`` → HTTP 415.

    Drives the full ASGI pipeline so a regression in the route's
    ``Depends(validate_selfie_upload)`` binding (e.g. the validator being
    accidentally dropped from the dependency chain) is caught here in
    addition to the pure-function coverage in
    ``test_selfie_validation.py``.
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/v1/diagnose",
            files={"selfie": ("selfie.gif", _GIF_PAYLOAD, "image/gif")},
        )

    assert response.status_code == 415, (
        f"Expected HTTP 415 for content-type 'image/gif', got "
        f"{response.status_code} with body {response.text!r}."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_with_image_gif_body_is_unsupported_media_type() -> None:
    """The 415 response body is exactly ``{"detail": "unsupported_media_type"}``.

    Pins the wire-format error body to the Seed-mandated constant. The
    string ``"unsupported_media_type"`` is consumed by mobile clients as a
    stable identifier — a typo or reformat would break the contract.
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/v1/diagnose",
            files={"selfie": ("selfie.gif", _GIF_PAYLOAD, "image/gif")},
        )

    assert response.status_code == 415

    body = response.json()
    assert body == {"detail": DETAIL_UNSUPPORTED_MEDIA_TYPE}, (
        f"Expected body {{'detail': {DETAIL_UNSUPPORTED_MEDIA_TYPE!r}}}, "
        f"got {body!r}."
    )

    # Defense in depth: the detail string is *exactly* the Seed-pinned wire
    # constant, not a paraphrase, and has no extra fields piggybacking on
    # the error envelope.
    assert body["detail"] == "unsupported_media_type"
    assert set(body.keys()) == {"detail"}


@pytest.mark.unit
async def test_post_v1_diagnose_with_image_gif_response_is_json() -> None:
    """The 415 response uses ``application/json`` (FastAPI default).

    Confirms the rejection path is serialized through FastAPI's standard
    ``HTTPException`` handler — not, for instance, a bare 415 with an
    empty body or a ``text/plain`` payload.
    """
    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/v1/diagnose",
            files={"selfie": ("selfie.gif", _GIF_PAYLOAD, "image/gif")},
        )

    assert response.status_code == 415
    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("application/json"), (
        f"Expected 415 response Content-Type to start with "
        f"'application/json', got {content_type!r}."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_with_image_gif_does_not_leak_payload() -> None:
    """The 415 error body never echoes the selfie bytes (zero-PII invariant).

    Phase 4.1 invariant: selfie bytes live only in handler-local memory
    and never appear in any response body or error message. A future
    refactor that accidentally formats ``{data!r}`` or ``{filename}`` into
    the detail field would be caught here.
    """
    # A distinctive marker so the assertion is unambiguous if the body ever
    # starts echoing the upload contents.
    marker = b"SECRET_GIF_MARKER_DO_NOT_LEAK"
    payload = b"GIF89a" + marker + b"\x00" * 32

    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/v1/diagnose",
            files={
                "selfie": (
                    "leaky-name-SECRET_FILENAME_MARKER.gif",
                    payload,
                    "image/gif",
                ),
            },
        )

    assert response.status_code == 415
    body_text = response.text
    assert (
        "SECRET_GIF_MARKER" not in body_text
    ), "The 415 response body must not echo the selfie bytes."
    assert (
        "SECRET_FILENAME_MARKER" not in body_text
    ), "The 415 response body must not echo the multipart filename."
