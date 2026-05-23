"""Unit test for AC7 — ``POST /v1/diagnose`` payload-too-large boundary.

Acceptance criterion (AC7) being verified
-----------------------------------------
    ``POST /v1/diagnose`` with a selfie payload of *exactly*
    ``10 * 1024 * 1024 + 1`` bytes returns HTTP 413 +
    ``{"detail": "payload_too_large"}``. Verified by a unit test.

The Seed pins the maximum accepted selfie size to ``10 * 1024 * 1024`` bytes
(10 MiB). The boundary is inclusive — exactly 10 MiB is accepted, but the
next byte (``MAX_SELFIE_BYTES + 1``) must be rejected with HTTP 413 and the
stable wire-format detail string ``"payload_too_large"``. This test drives
the actual ``POST /v1/diagnose`` endpoint (not the pure validator
function — that surface has its own unit coverage in
``tests/unit/test_selfie_validation.py``) to confirm:

    1. The size check fires through the *full* FastAPI dependency chain
       (multipart parser → ``validate_selfie_upload`` → ``HTTPException``).
    2. The response wire format matches the Seed contract byte-for-byte:
       status code ``413`` + body ``{"detail": "payload_too_large"}``.
    3. The CPU-bound ``diagnose_personal_color`` pipeline is **never
       reached** — the stub diagnose callable's call count stays at zero,
       proving the 413 short-circuit happens before the pipeline is
       invoked. This guards against a future refactor that accidentally
       reorders the dependencies.

Verification technique
----------------------
- Constructs a fresh FastAPI app via ``create_app()`` (each test owns its
  own ``dependency_overrides`` namespace — no leakage between tests).
- Overrides ``api.dependencies.diagnose.get_diagnose_fn`` with a spy that
  records call counts. The spy never loads MediaPipe / Pillow so the unit
  tier stays light-weight.
- Issues the multipart-form POST through ``httpx.AsyncClient`` +
  ``ASGITransport(app=app)`` — the Seed-mandated test seam.
- Sends a payload of exactly ``MAX_SELFIE_BYTES + 1`` bytes (i.e.,
  ``10 * 1024 * 1024 + 1 = 10,485,761`` bytes). Total in-memory cost is
  ~10 MiB; well within local-test memory budgets and CI runner limits.

Invariants asserted
-------------------
1. HTTP status code is exactly ``413``.
2. The JSON body is exactly ``{"detail": "payload_too_large"}`` —
   no extra keys, no traceback, no leaked payload bytes.
3. The diagnose callable was never invoked (call count == 0) — the
   413 short-circuit fires before the pipeline is reached.

Notes on test design
--------------------
- We assert against ``DETAIL_PAYLOAD_TOO_LARGE`` (imported from the
  source module) rather than the raw ``"payload_too_large"`` string so
  a Seed-driven rename of the wire constant fails both the source and
  the test in lockstep — never a silent drift.
- We assert against ``MAX_SELFIE_BYTES`` (imported from the source
  module) so a future Seed update to the limit is automatically picked
  up by this test without a manual literal edit.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.diagnose import DiagnoseFn, get_diagnose_fn
from api.dependencies.selfie_validation import (
    DETAIL_PAYLOAD_TOO_LARGE,
    MAX_SELFIE_BYTES,
)
from api.main import create_app
from personal_color.contrast_classifier import Contrast
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.season_classifier import Season
from personal_color.tone_classifier import Tone


def _never_called_result() -> DiagnosisResult:
    """A canonical ``DiagnosisResult`` for the stub that must NEVER be reached.

    The 413 short-circuit must fire before the diagnose callable is
    invoked, so the stub's return value is never observed by the
    handler. We still return a structurally valid ``DiagnosisResult``
    so a hypothetical regression (e.g. validator silently allowing
    oversize bodies through to the pipeline) produces a *visible*
    HTTP 200 with the canonical fixture body — making the regression
    obvious in the assertion diff instead of crashing with a
    confusing TypeError.
    """
    return DiagnosisResult(
        season=Season.WINTER,
        confidence=0.0,
        tone=Tone.COOL,
        contrast=Contrast.LOW,
        tone_confidence=0.0,
        contrast_confidence=0.0,
        skin_luma=0.0,
        hair_luma=0.0,
        eyes_luma=0.0,
    )


class _NeverCalledSpy:
    """A diagnose-callable spy that asserts it is never invoked.

    The spy records ``call_count`` so the test can prove the 413
    short-circuit happens before the pipeline is reached. Recording a
    counter rather than raising on call lets the test produce a
    deterministic assertion message in the diff (``call_count == 1``
    is more diagnostic than an opaque ``RuntimeError`` from inside
    ``asyncio.to_thread``).
    """

    def __init__(self) -> None:
        self.call_count: int = 0

    def __call__(self, selfie_bytes: bytes) -> DiagnosisResult:
        self.call_count += 1
        return _never_called_result()


@pytest.mark.unit
async def test_post_v1_diagnose_returns_413_for_payload_one_byte_over_limit() -> None:
    """``POST /v1/diagnose`` with ``MAX_SELFIE_BYTES + 1`` bytes → 413.

    Seed contract: a multipart-form ``selfie`` payload of exactly
    ``10 * 1024 * 1024 + 1`` bytes (one byte over the 10 MiB cap) must be
    rejected with HTTP 413 and the body
    ``{"detail": "payload_too_large"}``. The diagnose pipeline must NOT
    be invoked — the size check short-circuits before any CPU-bound
    work runs.
    """
    app = create_app()
    spy = _NeverCalledSpy()

    # Override the Depends-injectable provider with the spy so the unit
    # tier never loads MediaPipe / Pillow. The provider returns the
    # *callable*, not the result.
    def _override_get_diagnose_fn() -> DiagnoseFn:
        return spy

    app.dependency_overrides[get_diagnose_fn] = _override_get_diagnose_fn

    # Construct the over-limit payload. ``b"\x00" * N`` is the cheapest
    # allocation for an N-byte buffer and produces a contiguous bytes
    # object the multipart parser can stream into the request body.
    over_limit_payload: bytes = b"\x00" * (MAX_SELFIE_BYTES + 1)
    assert len(over_limit_payload) == MAX_SELFIE_BYTES + 1, (
        "Test fixture invariant: the payload must be exactly one byte over "
        "MAX_SELFIE_BYTES — otherwise the test is not actually verifying the "
        "boundary case the Seed pins."
    )

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/v1/diagnose",
                files={
                    "selfie": ("selfie.jpg", over_limit_payload, "image/jpeg"),
                },
            )
    finally:
        # Drop the override so subsequent tests start from a clean
        # dependency_overrides map. Defense in depth — each test builds
        # a fresh app, but cleanup keeps the spy from leaking if the
        # factory is ever memoized.
        app.dependency_overrides.pop(get_diagnose_fn, None)

    # --- Status code ---------------------------------------------------------
    assert response.status_code == 413, (
        f"Expected HTTP 413 for a {MAX_SELFIE_BYTES + 1}-byte payload, got "
        f"{response.status_code} with body {response.text!r}"
    )

    # --- Body shape ----------------------------------------------------------
    body = response.json()
    assert body == {"detail": DETAIL_PAYLOAD_TOO_LARGE}, (
        f"Expected body {{'detail': {DETAIL_PAYLOAD_TOO_LARGE!r}}}, got "
        f"{body!r}. The Seed pins the wire detail constant to "
        f"{DETAIL_PAYLOAD_TOO_LARGE!r}; any change to the detail string is "
        f"a Seed-level wire contract break."
    )

    # Defense in depth: no extra keys leaked into the body.
    assert set(body.keys()) == {"detail"}, (
        f"Expected exactly one key 'detail' in the 413 body, got keys "
        f"{set(body.keys())!r}. Extra keys would violate the Seed's "
        f"zero-PII-persistence invariant (no payload bytes, no tracebacks, "
        f"no driver strings in error responses)."
    )

    # --- Pipeline short-circuit invariant ------------------------------------
    assert spy.call_count == 0, (
        f"Expected the diagnose callable to be NOT invoked for an oversize "
        f"payload (the 413 size check must short-circuit before the pipeline "
        f"runs), but the spy was called {spy.call_count} time(s). This "
        f"indicates the validator runs *after* the pipeline — a Seed-level "
        f"ordering regression."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_413_body_does_not_leak_payload_bytes() -> None:
    """The HTTP 413 response body must not echo back any selfie bytes.

    Phase 4.1 zero-PII-persistence invariant: selfie bytes never appear
    in any response body, log line, or error message. We send a payload
    whose first bytes are a distinctive ASCII marker; the test asserts
    the marker is absent from the response text.

    The marker is *short* (so it does not perturb the boundary check)
    and embedded *inside* an over-limit payload (so the response is
    still HTTP 413, exercising the same code path AC7 pins).
    """
    app = create_app()
    spy = _NeverCalledSpy()
    app.dependency_overrides[get_diagnose_fn] = lambda: spy

    marker = b"SECRET_MARKER_AC7"
    # Marker prefix + zero-fill so the total length is exactly
    # ``MAX_SELFIE_BYTES + 1`` — the AC7 boundary.
    over_limit_payload = marker + b"\x00" * (MAX_SELFIE_BYTES + 1 - len(marker))
    assert len(over_limit_payload) == MAX_SELFIE_BYTES + 1

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/v1/diagnose",
                files={
                    "selfie": ("selfie.jpg", over_limit_payload, "image/jpeg"),
                },
            )
    finally:
        app.dependency_overrides.pop(get_diagnose_fn, None)

    assert response.status_code == 413
    # The marker must not appear in the response body, headers, or any
    # other part of the response. We coerce headers to a single string
    # for the substring assertion so a leak via any header is caught.
    response_text = response.text
    headers_blob = "\n".join(f"{k}: {v}" for k, v in response.headers.items())
    assert "SECRET_MARKER_AC7" not in response_text, (
        "The 413 response body leaked selfie bytes — Phase 4.1 "
        "zero-PII-persistence invariant violated."
    )
    assert "SECRET_MARKER_AC7" not in headers_blob, (
        "The 413 response headers leaked selfie bytes — Phase 4.1 "
        "zero-PII-persistence invariant violated."
    )
    # Sanity: spy still not invoked.
    assert spy.call_count == 0
