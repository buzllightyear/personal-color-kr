"""Unit test for ``POST /v1/diagnose`` InvalidSelfieError mapping (AC8).

Acceptance criterion (AC8) being verified
-----------------------------------------
    ``POST /v1/diagnose`` where the stub diagnose callable raises
    :class:`personal_color.image_decoder.InvalidSelfieError` returns HTTP 400 +
    ``{"detail": "invalid_selfie"}``. Verified by a unit test.

Background
----------
Phase 3.2's image decoder raises :class:`InvalidSelfieError` (a
:class:`ValueError` subclass) whenever the supplied bytes cannot be decoded
into the rows-first ``Image`` shape consumed by the diagnosis pipeline. The
docstring on that exception explicitly pins the contract::

    Phase 4's HTTP server maps this to **400 Bad Request** — the user's
    upload is malformed and the same upload will never decode no matter how
    many times it is retried.

Phase 4.1's ``POST /v1/diagnose`` route honors that contract by catching
``InvalidSelfieError`` inside the ``asyncio.to_thread`` worker and
re-raising it as an :class:`fastapi.HTTPException` with status 400 and the
Seed-pinned wire constant
:data:`api.routers.diagnose.DETAIL_INVALID_SELFIE` (``"invalid_selfie"``).

Verification technique
----------------------
Constructs a fresh FastAPI app via :func:`api.main.create_app` (so each
test owns its own ``dependency_overrides`` namespace) and substitutes the
production diagnose callable with a stub that *unconditionally raises
InvalidSelfieError* the moment it is invoked. The substitution is
performed through the Seed-mandated injection seam ``get_diagnose_fn``
(``app.dependency_overrides[get_diagnose_fn] = lambda: stub``) — the
single mechanism for swapping the pipeline in tests, as the production
source never branches on ``MOCK`` / ``DRY_RUN`` / ``TEST`` flags.

The request itself is a well-formed multipart-form POST with a
``selfie`` field whose declared content-type is ``image/jpeg`` and whose
payload is well under 10 MiB, so the Sub-AC 5.2 validator
(``validate_selfie_upload``) accepts it and the pipeline call is reached.

The request travels through:

    1. FastAPI's multipart parser (extracts the ``selfie`` ``UploadFile``).
    2. ``validate_selfie_upload`` (accepts the JPEG-typed payload).
    3. The handler's ``await asyncio.to_thread(diagnose_fn, ...)`` call,
       which inside the worker thread invokes the stub.
    4. The stub raises :class:`InvalidSelfieError`.
    5. ``await`` re-raises in the handler frame, where the
       ``except InvalidSelfieError`` arm converts it to ``HTTPException``
       status=400, detail=``"invalid_selfie"``.
    6. FastAPI serializes the exception as
       ``{"detail": "invalid_selfie"}``.

Invariants asserted
-------------------
1. HTTP status is exactly ``400``.
2. The JSON body is exactly ``{"detail": "invalid_selfie"}`` — the detail
   string matches the Seed-pinned wire constant
   :data:`api.routers.diagnose.DETAIL_INVALID_SELFIE`.
3. ``Content-Type`` of the response is ``application/json`` (FastAPI's
   default for ``HTTPException`` rendering).
4. The body has *exactly one* key (``detail``) — no extra fields, no
   traceback leakage, no echo of the original exception message, no echo
   of the selfie bytes.
5. The stub callable is invoked exactly once per request (proving the
   error path runs *after* validation and the diagnose seam was actually
   reached).
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.diagnose import DiagnoseFn, get_diagnose_fn
from api.main import create_app
from api.routers.diagnose import DETAIL_INVALID_SELFIE
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.image_decoder import InvalidSelfieError

# ---------------------------------------------------------------------------
# Fixtures — a valid (well-typed, undersized) multipart payload + a stub
# diagnose callable that always raises ``InvalidSelfieError``.
# ---------------------------------------------------------------------------


#: A small, well-typed multipart-form payload. Begins with the JPEG SOI
#: marker (``\xff\xd8\xff\xe0``) so the upload looks like a real JPEG at the
#: byte level, and the multipart content-type ``image/jpeg`` ensures the
#: Sub-AC 5.2 validator accepts it. The size is intentionally far below the
#: 10 MiB cap so neither validation check fires. The bytes are otherwise
#: opaque — the test does not rely on them being decodable, because the
#: real decoder is replaced by ``_RaisingDiagnoseStub`` before they would
#: ever be inspected.
_VALID_JPEG_PAYLOAD: bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 256


class _RaisingDiagnoseStub:
    """A diagnose-callable stub that always raises ``InvalidSelfieError``.

    The stub records its call count so the test can prove the error path
    runs *after* the validator accepts the upload (i.e. the diagnose seam
    is actually reached), rather than the 400 happening to come from some
    earlier rejection that bypasses the pipeline entirely.

    The exception is raised with a *message that contains a deliberately
    recognizable marker*. The marker is later used in a defense-in-depth
    assertion that the response body does not echo the exception message
    (the Seed forbids traceback / exception-message leakage in the wire
    response).
    """

    #: Distinctive marker placed inside the exception message. If a future
    #: refactor accidentally pipes ``str(exc)`` into the response body,
    #: this string will appear in ``response.text`` and the leak assertion
    #: will fire.
    EXC_MESSAGE_MARKER: str = "AC8_EXC_MESSAGE_MARKER_DO_NOT_LEAK"

    def __init__(self) -> None:
        self.call_count: int = 0

    def __call__(self, selfie_bytes: bytes) -> DiagnosisResult:
        self.call_count += 1
        # Raise the Phase 3.2 exception with a distinctive message. The
        # message must NEVER appear in the wire response.
        raise InvalidSelfieError(self.EXC_MESSAGE_MARKER)


# ---------------------------------------------------------------------------
# AC8 — InvalidSelfieError → HTTP 400 + {"detail": "invalid_selfie"}
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_post_v1_diagnose_invalid_selfie_error_returns_400() -> None:
    """``InvalidSelfieError`` raised by the stub → HTTP 400.

    Drives the full ASGI pipeline so a regression in the route's
    ``except InvalidSelfieError`` arm (e.g. status accidentally changed to
    422 / 500, or the exception accidentally caught by the generic
    ``except Exception`` arm below it) is caught here.
    """
    app = create_app()
    stub = _RaisingDiagnoseStub()

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
                files={
                    "selfie": (
                        "selfie.jpg",
                        _VALID_JPEG_PAYLOAD,
                        "image/jpeg",
                    ),
                },
            )
    finally:
        # Drop the override so subsequent tests start from a clean
        # dependency_overrides map. Defense in depth — each test builds a
        # fresh app, but cleanup keeps the stub from leaking across tests
        # if the factory is ever memoized.
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 400, (
        f"Expected HTTP 400 when the diagnose callable raises "
        f"InvalidSelfieError, got {response.status_code} with body "
        f"{response.text!r}."
    )

    # The stub MUST have been invoked exactly once — proves the validator
    # accepted the upload and the diagnose seam was actually reached
    # (rather than the 400 coming from some unrelated earlier rejection).
    assert stub.call_count == 1, (
        f"Expected the diagnose stub to be invoked exactly once before "
        f"raising InvalidSelfieError, got {stub.call_count} invocations."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_invalid_selfie_error_body_is_invalid_selfie() -> None:
    """The 400 response body is exactly ``{"detail": "invalid_selfie"}``.

    Pins the wire-format error body to the Seed-mandated constant. The
    string ``"invalid_selfie"`` is consumed by mobile clients as a stable
    identifier — a typo, paraphrase, or extra field would break the
    contract.
    """
    app = create_app()
    stub = _RaisingDiagnoseStub()
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
                        "selfie.jpg",
                        _VALID_JPEG_PAYLOAD,
                        "image/jpeg",
                    ),
                },
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 400

    body = response.json()
    assert body == {"detail": DETAIL_INVALID_SELFIE}, (
        f"Expected body {{'detail': {DETAIL_INVALID_SELFIE!r}}}, " f"got {body!r}."
    )

    # Defense in depth: the detail string is *exactly* the Seed-pinned
    # wire constant, not a paraphrase, and has no extra fields
    # piggybacking on the error envelope.
    assert body["detail"] == "invalid_selfie"
    assert set(body.keys()) == {"detail"}


@pytest.mark.unit
async def test_post_v1_diagnose_invalid_selfie_error_response_is_json() -> None:
    """The 400 response uses ``application/json`` (FastAPI default).

    Confirms the rejection path is serialized through FastAPI's standard
    ``HTTPException`` handler — not, for instance, a bare 400 with an
    empty body or a ``text/plain`` payload.
    """
    app = create_app()
    stub = _RaisingDiagnoseStub()
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
                        "selfie.jpg",
                        _VALID_JPEG_PAYLOAD,
                        "image/jpeg",
                    ),
                },
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 400
    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("application/json"), (
        f"Expected 400 response Content-Type to start with "
        f"'application/json', got {content_type!r}."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_invalid_selfie_error_does_not_leak_exception_message() -> (
    None
):
    """The 400 body never echoes the exception message (zero-traceback invariant).

    Phase 4.1 Seed invariant: error responses are stable wire constants —
    they never embed the raised exception's ``str(exc)``, never include a
    traceback, and never leak the selfie bytes. A future refactor that
    accidentally writes ``detail=str(exc)`` instead of
    ``detail=DETAIL_INVALID_SELFIE`` would be caught by this test, because
    the stub raises ``InvalidSelfieError`` with a deliberately
    recognizable marker string in its message.
    """
    app = create_app()
    stub = _RaisingDiagnoseStub()
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
                        "selfie.jpg",
                        _VALID_JPEG_PAYLOAD,
                        "image/jpeg",
                    ),
                },
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 400
    body_text = response.text
    assert _RaisingDiagnoseStub.EXC_MESSAGE_MARKER not in body_text, (
        "The 400 response body must not echo the InvalidSelfieError "
        "exception message. The Seed pins ``detail`` to the wire constant "
        "``invalid_selfie`` — never to ``str(exc)`` — so that mobile "
        "clients see a stable identifier and exception internals never "
        "leak to the wire."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_invalid_selfie_error_does_not_leak_selfie_bytes() -> (
    None
):
    """The 400 body never echoes the selfie bytes (zero-PII invariant).

    Phase 4.1 invariant: selfie bytes live only in handler-local memory
    and never appear in any response body or error message — including on
    the error paths. A future refactor that accidentally formats
    ``{data!r}`` or ``{filename}`` into the detail field on the error
    branch would be caught here.
    """
    # A distinctive marker so the assertion is unambiguous if the body
    # ever starts echoing the upload contents.
    pii_marker = b"AC8_SELFIE_PII_MARKER_DO_NOT_LEAK"
    payload = b"\xff\xd8\xff\xe0" + pii_marker + b"\x00" * 32
    filename_marker = "AC8_FILENAME_PII_MARKER.jpg"

    app = create_app()
    stub = _RaisingDiagnoseStub()
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
                        filename_marker,
                        payload,
                        "image/jpeg",
                    ),
                },
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 400
    body_text = response.text
    assert (
        "AC8_SELFIE_PII_MARKER" not in body_text
    ), "The 400 response body must not echo the selfie bytes."
    assert (
        "AC8_FILENAME_PII_MARKER" not in body_text
    ), "The 400 response body must not echo the multipart filename."
