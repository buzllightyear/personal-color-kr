"""Unit tests for ``POST /v1/diagnose`` FaceNotDetectedError mapping (AC9).

Acceptance criterion (AC9) being verified
-----------------------------------------
    ``POST /v1/diagnose`` where the stub diagnose callable raises
    ``FaceNotDetectedError`` returns HTTP 422 + ``{"detail": "face_not_detected"}``.
    Verified by a unit test.

Context — Phase 3.2 contract honored verbatim
---------------------------------------------
``packages/core-python/src/personal_color/face_detector.py`` defines::

    class FaceNotDetectedError(ValueError):
        '''... The Phase 4 HTTP layer maps this to **422 Unprocessable Entity**.'''

This file is the executable proof of that mapping at the HTTP boundary. The
counterpart for ``InvalidSelfieError → 400`` lives in AC8's test file; the
catch-all ``Exception → 500`` mapping lives in the broader error-mapping
suite. Together those three tests pin the entire error-mapping contract from
``apps/api/src/api/routers/diagnose.py`` lines 141–165.

Verification technique
----------------------
Constructs a fresh FastAPI app via :func:`api.main.create_app` (so each test
owns its own ``dependency_overrides`` namespace) and installs a stub
``DiagnoseFn`` that raises :class:`FaceNotDetectedError` when invoked. The
request body is a *valid* multipart-form ``selfie`` upload (image/jpeg, well
under 10 MiB) so the Sub-AC 5.2 ``validate_selfie_upload`` dependency accepts
the request and the handler actually reaches the
``await asyncio.to_thread(diagnose_fn, selfie_bytes)`` call — that is the only
code path under which the route's ``except FaceNotDetectedError`` clause can
fire.

The stub callable lives entirely inside the test module; it never touches
MediaPipe / Pillow, so the unit tier stays fast and free of the real face
detector. Each test owns a freshly-constructed app and restores its
``dependency_overrides`` map in a ``finally`` block (defense-in-depth even
though the factory currently builds a new app per call).

Invariants asserted
-------------------
1. HTTP status is exactly ``422``.
2. The JSON body is exactly ``{"detail": "face_not_detected"}`` — the detail
   string matches the Seed-pinned wire constant
   :data:`api.routers.diagnose.DETAIL_FACE_NOT_DETECTED`.
3. The response ``Content-Type`` is ``application/json`` (FastAPI's default
   ``HTTPException`` serialization, not a bare 422 with empty body).
4. The 422 response body has exactly one field (``detail``) — no extras, so
   nothing else can piggy-back on the error envelope.
5. Zero PII leakage: the response body never echoes the selfie bytes,
   the multipart filename, or any test-injected marker. This pins the
   Phase 4.1 zero-persistence invariant at the error path (it's already
   pinned on the happy path by AC13).
6. The stub is invoked exactly once per request (no accidental retry / no
   double-invocation of the dependency wiring).
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.diagnose import DiagnoseFn, get_diagnose_fn
from api.main import create_app
from api.routers.diagnose import DETAIL_FACE_NOT_DETECTED
from personal_color.face_detector import FaceNotDetectedError

# ---------------------------------------------------------------------------
# Fixtures — valid multipart selfie payload + stub callable that raises
# ---------------------------------------------------------------------------


#: A small but valid multipart-form payload. The bytes start with the JPEG SOI
#: marker (``\xff\xd8\xff\xe0``) and the request is tagged ``image/jpeg``, so
#: the Sub-AC 5.2 selfie validator accepts the request and the handler reaches
#: the ``asyncio.to_thread(diagnose_fn, ...)`` call — which is the only code
#: path that can hit the ``except FaceNotDetectedError`` clause under test.
_SELFIE_PAYLOAD: bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 256


class _FaceNotDetectedStub:
    """A diagnose-callable stub that always raises ``FaceNotDetectedError``.

    Records the call count and the bytes it received so the test can assert
    that (a) the handler actually invoked the stub (i.e. the validator
    didn't short-circuit) and (b) the bytes flowed through verbatim. The
    state is per-instance so independent tests don't share mutable globals.
    """

    def __init__(self) -> None:
        self.call_count: int = 0
        self.received_bytes: bytes | None = None

    def __call__(self, selfie_bytes: bytes) -> None:
        # Record first so failed assertions in the test still see the
        # state up to the point of raising.
        self.call_count += 1
        self.received_bytes = selfie_bytes
        # Phase 3.2 docstring: ``FaceNotDetectedError`` carries no
        # caller-side identifiers — match that discipline here so the
        # error message itself can't leak through any future logging
        # refactor.
        raise FaceNotDetectedError("no_face")


# ---------------------------------------------------------------------------
# AC9 — FaceNotDetectedError → HTTP 422 + {"detail":"face_not_detected"}
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_post_v1_diagnose_face_not_detected_returns_422() -> None:
    """``POST /v1/diagnose`` → HTTP 422 when the pipeline raises
    :class:`FaceNotDetectedError`.

    Drives the full ASGI pipeline (multipart parser →
    ``validate_selfie_upload`` → ``asyncio.to_thread(diagnose_fn, bytes)``
    → ``except FaceNotDetectedError`` → ``HTTPException(422, ...)``
    → FastAPI's JSON error renderer) so the entire mapping is exercised
    end-to-end, not just the bare ``raise`` statement in the router.
    """
    app = create_app()
    stub = _FaceNotDetectedStub()

    # Override the Depends-injectable provider so the unit test never loads
    # MediaPipe / Pillow. The provider returns the *callable*, not the result.
    def _override_get_diagnose_fn() -> DiagnoseFn:
        return stub

    app.dependency_overrides[get_diagnose_fn] = _override_get_diagnose_fn

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/v1/diagnose",
                files={"selfie": ("selfie.jpg", _SELFIE_PAYLOAD, "image/jpeg")},
            )
    finally:
        # Drop the override so subsequent tests start from a clean
        # ``dependency_overrides`` map — defense in depth even though each
        # test builds a fresh app via ``create_app()``.
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 422, (
        f"Expected HTTP 422 when the pipeline raises FaceNotDetectedError, "
        f"got {response.status_code} with body {response.text!r}."
    )

    # The handler must actually reach the pipeline call — otherwise the 422
    # would have come from somewhere other than the ``except
    # FaceNotDetectedError`` clause, defeating the point of the test.
    assert stub.call_count == 1, (
        f"Expected the stub diagnose callable to be invoked exactly once "
        f"(so the 422 came from the FaceNotDetectedError mapping, not from "
        f"an upstream validator), got {stub.call_count} invocations."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_face_not_detected_body_is_face_not_detected() -> None:
    """The 422 response body is exactly ``{"detail": "face_not_detected"}``.

    Pins the wire-format error body to the Seed-mandated wire constant. The
    string ``"face_not_detected"`` is consumed by mobile clients as a stable
    identifier — a typo, reformat, or extra field would silently break the
    contract with downstream callers.
    """
    app = create_app()
    stub = _FaceNotDetectedStub()
    app.dependency_overrides[get_diagnose_fn] = lambda: stub

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/v1/diagnose",
                files={"selfie": ("selfie.jpg", _SELFIE_PAYLOAD, "image/jpeg")},
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 422

    body = response.json()
    assert body == {"detail": DETAIL_FACE_NOT_DETECTED}, (
        f"Expected body {{'detail': {DETAIL_FACE_NOT_DETECTED!r}}}, " f"got {body!r}."
    )

    # Defense in depth: the detail string is *exactly* the Seed-pinned wire
    # constant (not a paraphrase), and the envelope has no extra fields.
    assert body["detail"] == "face_not_detected"
    assert set(body.keys()) == {"detail"}


@pytest.mark.unit
async def test_post_v1_diagnose_face_not_detected_response_is_json() -> None:
    """The 422 response uses ``application/json`` (FastAPI default).

    Confirms the rejection path is serialized through FastAPI's standard
    ``HTTPException`` handler — not, for instance, a bare 422 with an empty
    body or a ``text/plain`` payload that mobile clients would not parse.
    """
    app = create_app()
    stub = _FaceNotDetectedStub()
    app.dependency_overrides[get_diagnose_fn] = lambda: stub

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/v1/diagnose",
                files={"selfie": ("selfie.jpg", _SELFIE_PAYLOAD, "image/jpeg")},
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 422
    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("application/json"), (
        f"Expected 422 response Content-Type to start with "
        f"'application/json', got {content_type!r}."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_face_not_detected_does_not_leak_payload() -> None:
    """The 422 error body never echoes the selfie bytes or filename
    (zero-PII invariant).

    Phase 4.1 invariant: selfie bytes live only in handler-local memory and
    never appear in any response body or error message. A future refactor
    that accidentally formats ``{exc!s}``, ``{data!r}``, or ``{filename}``
    into the detail field would be caught here on the error path.
    """
    # A distinctive marker so the assertion is unambiguous if the body ever
    # starts echoing the upload contents or the filename.
    payload_marker = b"SECRET_JPEG_MARKER_DO_NOT_LEAK"
    payload = b"\xff\xd8\xff\xe0" + payload_marker + b"\x00" * 32

    app = create_app()
    stub = _FaceNotDetectedStub()
    app.dependency_overrides[get_diagnose_fn] = lambda: stub

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/v1/diagnose",
                files={
                    "selfie": (
                        "leaky-name-SECRET_FILENAME_MARKER.jpg",
                        payload,
                        "image/jpeg",
                    ),
                },
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 422
    body_text = response.text
    assert (
        "SECRET_JPEG_MARKER" not in body_text
    ), "The 422 response body must not echo the selfie bytes."
    assert (
        "SECRET_FILENAME_MARKER" not in body_text
    ), "The 422 response body must not echo the multipart filename."
    # Also pin against the FaceNotDetectedError's own message — mobile
    # clients consume only the stable ``"face_not_detected"`` slug; the
    # underlying exception string is an internal implementation detail.
    assert (
        "no_face" not in body_text
    ), "The 422 response body must not echo the FaceNotDetectedError message."
