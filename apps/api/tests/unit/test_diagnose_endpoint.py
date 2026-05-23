"""Unit tests for the ``POST /v1/diagnose`` endpoint happy path (Sub-AC 5.3).

Acceptance criterion (Sub-AC 5.3) being verified
------------------------------------------------
    Wire ``POST /v1/diagnose`` route handler to invoke
    ``diagnose_personal_color`` via ``asyncio.to_thread`` and serialize through
    ``response_model=DiagnoseResponse``; unit test uses FastAPI
    ``app.dependency_overrides`` to stub the diagnosis call with a fixed
    ``DiagnosisResult``, POSTs a valid multipart selfie, and asserts 200
    status plus exact 9-field JSON body.

Verification technique
----------------------
Constructs a fresh FastAPI app via ``create_app()`` (so each test owns
its own ``dependency_overrides`` namespace) and overrides
``api.dependencies.diagnose.get_diagnose_fn`` with a provider that
returns a stub ``DiagnoseFn`` yielding a fixed ``DiagnosisResult``. The
stub never loads MediaPipe / Pillow — the unit tier never reaches the
real ``diagnose_personal_color`` pipeline.

The request is issued through ``httpx.AsyncClient`` with
``ASGITransport(app=app)`` (the Seed-mandated test seam) and is a
valid multipart-form ``POST`` with a single ``selfie`` field whose
content-type and body satisfy the Sub-AC 5.2 validator (image/jpeg, well
under 10 MiB).

Invariants asserted
-------------------
1. HTTP status is exactly ``200``.
2. The JSON body has **exactly** the nine canonical fields with the
   wire-format values produced by ``DiagnoseResponse.from_dataclass`` for
   the stub's ``DiagnosisResult``.
3. The handler receives the *same* bytes that the multipart body
   contained — the stub captures the bytes it was given and the test
   asserts byte-equality against the request payload.
4. The stub is called exactly once per request (no accidental retry or
   double-invocation in the dependency wiring).
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.diagnose import DiagnoseFn, get_diagnose_fn
from api.main import create_app
from personal_color.contrast_classifier import Contrast
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.season_classifier import Season
from personal_color.tone_classifier import Tone

# ---------------------------------------------------------------------------
# Fixtures — stub diagnose callable + canonical payload
# ---------------------------------------------------------------------------


#: A small but valid multipart-form payload body. The bytes start with the
#: JPEG SOI marker (``\xff\xd8\xff\xe0``) so the Sub-AC 5.2 selfie validator
#: accepts the request (content-type ``image/jpeg`` + size ≪ 10 MiB).
_SELFIE_PAYLOAD: bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 256


def _fixed_diagnosis_result() -> DiagnosisResult:
    """Return a deterministic ``DiagnosisResult`` for the stubbed pipeline.

    The float fields are arbitrary but distinct so any accidental
    cross-wiring at the response layer (e.g. ``skin_luma`` written to
    ``hair_luma``) is detectable in the assertion.
    """
    return DiagnosisResult(
        season=Season.SPRING,
        confidence=0.82,
        tone=Tone.WARM,
        contrast=Contrast.HIGH,
        tone_confidence=0.9,
        contrast_confidence=0.75,
        skin_luma=0.7,
        hair_luma=0.15,
        eyes_luma=0.2,
    )


def _expected_response_body() -> dict[str, Any]:
    """The 9-field JSON body the handler must return for the fixed result.

    Mirrors the ``DiagnoseResponse.from_dataclass`` projection of
    :func:`_fixed_diagnosis_result` — built independently here so the test
    catches drift if either side regresses.
    """
    return {
        "season": "spring",
        "confidence": 0.82,
        "tone": "warm",
        "contrast": "high",
        "tone_confidence": 0.9,
        "contrast_confidence": 0.75,
        "skin_luma": 0.7,
        "hair_luma": 0.15,
        "eyes_luma": 0.2,
    }


class _DiagnoseSpy:
    """A diagnose-callable spy that records its invocations.

    The spy records ``(thread_id, bytes_received)`` for each call so the
    test can assert exactness without resorting to module-level mutable
    state (which would leak between tests in the same process).
    """

    def __init__(self, result: DiagnosisResult) -> None:
        self._result = result
        self.call_count: int = 0
        self.received_bytes: bytes | None = None

    def __call__(self, selfie_bytes: bytes) -> DiagnosisResult:
        self.call_count += 1
        self.received_bytes = selfie_bytes
        return self._result


# ---------------------------------------------------------------------------
# Happy path — POST a valid multipart selfie, assert 200 + 9-field JSON body
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_post_v1_diagnose_returns_200_with_nine_field_body() -> None:
    """``POST /v1/diagnose`` → 200 with the exact 9-field JSON body.

    The test installs a stub ``DiagnoseFn`` via ``app.dependency_overrides``
    that returns a fixed ``DiagnosisResult``. The handler must:

    1. Validate + parse the multipart selfie (Sub-AC 5.2).
    2. Invoke the stub via ``asyncio.to_thread`` (Sub-AC 5.3).
    3. Project the dataclass onto ``DiagnoseResponse`` via
       ``DiagnoseResponse.from_dataclass``.
    4. Serialize the response as JSON under the Pydantic v2
       ``response_model`` declared on the route.
    """
    app = create_app()
    spy = _DiagnoseSpy(_fixed_diagnosis_result())

    # Override the Depends-injectable provider so the unit test never loads
    # MediaPipe / Pillow. The provider returns the *callable*, not the result.
    def _override_get_diagnose_fn() -> DiagnoseFn:
        return spy

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
        # dependency_overrides map (defense in depth — each test builds a
        # fresh app, but cleanup keeps the spy from leaking across tests
        # if the factory is ever memoized).
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 200, (
        f"Expected HTTP 200, got {response.status_code} with body " f"{response.text!r}"
    )

    body = response.json()
    expected = _expected_response_body()
    assert body == expected, (
        f"Expected 9-field body {expected!r}, got {body!r}. Diff: "
        f"missing={set(expected) - set(body)}, "
        f"unexpected={set(body) - set(expected)}"
    )

    # Exactly nine fields — no extras, no missing.
    assert set(body.keys()) == set(expected.keys())
    assert len(body) == 9


@pytest.mark.unit
async def test_post_v1_diagnose_calls_stub_with_request_bytes() -> None:
    """The handler forwards the *request body bytes* to the stub callable.

    Asserts that the bytes the spy received are equal to the bytes that
    were sent as the multipart-form ``selfie`` field. This catches a class
    of regressions where the handler accidentally re-reads the upload,
    truncates the buffer, or passes a stale empty body.
    """
    app = create_app()
    spy = _DiagnoseSpy(_fixed_diagnosis_result())

    app.dependency_overrides[get_diagnose_fn] = lambda: spy

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

    assert response.status_code == 200
    assert spy.call_count == 1, (
        f"Expected the diagnose callable to be invoked exactly once, "
        f"got {spy.call_count} invocations."
    )
    assert spy.received_bytes == _SELFIE_PAYLOAD, (
        "The handler did not forward the request bytes to the diagnose "
        "callable verbatim."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_response_content_type_is_json() -> None:
    """The ``Content-Type`` response header is ``application/json``.

    Confirms the Pydantic v2 ``response_model`` is the serialization
    surface (not a bare ``Response(..., media_type='text/plain')``).
    """
    app = create_app()
    spy = _DiagnoseSpy(_fixed_diagnosis_result())
    app.dependency_overrides[get_diagnose_fn] = lambda: spy

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

    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("application/json"), (
        f"Expected Content-Type to start with 'application/json', got "
        f"{content_type!r}"
    )
