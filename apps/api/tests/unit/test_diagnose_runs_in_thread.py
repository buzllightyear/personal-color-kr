"""Unit test for AC10 — diagnose runs via ``asyncio.to_thread`` (sync-in-async).

Acceptance criterion (AC10) being verified
------------------------------------------
    ``POST /v1/diagnose`` invokes the diagnose callable via
    ``asyncio.to_thread``: a unit test installs a stub ``diagnose_fn`` that
    captures ``threading.current_thread()`` and asserts the captured thread
    is NOT the main asyncio loop thread.

Verification technique
----------------------
The route handler in ``api.routers.diagnose`` is documented to offload the
CPU-bound diagnosis pipeline to a worker thread via::

    await asyncio.to_thread(diagnose_fn, selfie_bytes)

``asyncio.to_thread`` schedules the call on the running event loop's default
``ThreadPoolExecutor``, which executes the callable on a worker thread —
*not* the thread that runs the event loop.

The test:

1. Captures the running event loop thread (``threading.current_thread()``)
   *before* the request. Under pytest-asyncio ``asyncio_mode = "auto"`` +
   ``httpx.AsyncClient(transport=ASGITransport(app))``, the entire ASGI
   stack — including the route handler's ``async def post_diagnose`` body —
   runs on the same thread as the test coroutine.
2. Installs a stub ``DiagnoseFn`` via ``app.dependency_overrides`` that
   captures ``threading.current_thread()`` (and ``threading.get_ident()``)
   at invocation time.
3. POSTs a valid multipart selfie payload.
4. Asserts the stub's captured thread is **not** the event-loop thread
   (i.e. ``asyncio.to_thread`` actually offloaded the call). If the handler
   ever regressed to invoking ``diagnose_fn(selfie_bytes)`` directly on the
   event loop, the assertion would fail because the stub would observe the
   same thread the test recorded as the event-loop thread.

Invariants asserted
-------------------
1. The stub callable is invoked exactly once (no accidental retry or
   double-dispatch in the dependency wiring).
2. The stub's observed thread is **not** ``threading.main_thread()`` (the
   process-wide main thread that hosts the asyncio loop in this test
   harness).
3. The stub's observed thread ident is **not** equal to the ident of the
   event-loop thread captured before the request was issued.
4. HTTP 200 with the projected 9-field JSON body — confirming the handler
   reaches the success path after the off-thread call returns.

The test is in the unit tier (``@pytest.mark.unit``) and never loads
MediaPipe / Pillow — the diagnose callable is fully stubbed.
"""

from __future__ import annotations

import threading
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
# Fixtures — stub payload + canonical ``DiagnosisResult``
# ---------------------------------------------------------------------------


#: A small but valid multipart-form payload body. The bytes start with the
#: JPEG SOI marker (``\xff\xd8\xff\xe0``) so the Sub-AC 5.2 selfie validator
#: accepts the request (content-type ``image/jpeg`` + size ≪ 10 MiB).
_SELFIE_PAYLOAD: bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 256


def _fixed_diagnosis_result() -> DiagnosisResult:
    """Return a deterministic ``DiagnosisResult`` for the stubbed pipeline.

    AC10 only cares about the *thread identity* the stub observes — the
    field values are not asserted here — but a real ``DiagnosisResult`` is
    still required because the handler projects the dataclass onto the
    ``response_model=DiagnoseResponse`` (Pydantic v2) on the success path.
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


class _ThreadCapturingDiagnoseSpy:
    """A diagnose-callable spy that records the thread it was invoked on.

    The spy records ``threading.current_thread()`` and the corresponding
    OS-level ``threading.get_ident()`` at invocation time, plus a call
    counter. AC10 reads ``captured_thread`` and ``captured_ident`` to
    assert the call ran *off* the event-loop thread.

    The spy stores state on the instance (not at module scope) so each test
    constructs a fresh spy and there is no cross-test leakage.
    """

    def __init__(self, result: DiagnosisResult) -> None:
        self._result: DiagnosisResult = result
        self.call_count: int = 0
        self.captured_thread: threading.Thread | None = None
        self.captured_ident: int | None = None

    def __call__(self, selfie_bytes: bytes) -> DiagnosisResult:
        # Record the thread identity *before* returning the canned result so
        # the assertions observe exactly the thread on which the diagnose
        # callable executed. ``threading.current_thread()`` returns the
        # ``Thread`` object representing the OS thread running the call;
        # ``get_ident()`` returns the underlying OS thread id. Capturing
        # both lets the test assert thread *identity* via the Thread
        # object and thread *ident* via the integer id — defense in
        # depth against any harness that re-wraps Thread objects.
        self.call_count += 1
        self.captured_thread = threading.current_thread()
        self.captured_ident = threading.get_ident()
        return self._result


# ---------------------------------------------------------------------------
# AC10 — the diagnose callable runs OFF the event-loop thread
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_post_v1_diagnose_runs_diagnose_fn_off_event_loop_thread() -> None:
    """The diagnose callable executes on a worker thread, not the loop thread.

    Reads ``threading.current_thread()`` once on the test coroutine (which
    runs on the event-loop thread under pytest-asyncio + ASGITransport),
    then issues the request and reads the same value as observed by the
    stub. The two values must differ — that is exactly what
    ``asyncio.to_thread`` guarantees.
    """
    # Capture the event-loop thread identity *before* the request. Under
    # pytest-asyncio with ``asyncio_mode = "auto"`` + ``ASGITransport``,
    # the entire ASGI stack — including the ``async def post_diagnose``
    # handler body — runs on this same thread. Anything the diagnose
    # callable observes must be different *iff* ``asyncio.to_thread`` is
    # in use.
    event_loop_thread: threading.Thread = threading.current_thread()
    event_loop_ident: int = threading.get_ident()

    app = create_app()
    spy = _ThreadCapturingDiagnoseSpy(_fixed_diagnosis_result())

    # The Depends provider returns the *callable*. The handler wraps the
    # call in ``asyncio.to_thread``, so the wrapping decision is at the
    # route layer (where it is observable), not in the provider.
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
        # Clean up the override so subsequent tests in the same process
        # start with an empty ``dependency_overrides`` map (each test
        # builds a fresh app, but this defends against future memoization).
        app.dependency_overrides.pop(get_diagnose_fn, None)

    # The handler reached the success path — confirms the stub returned
    # cleanly and the response model serialized without raising.
    assert response.status_code == 200, (
        f"Expected HTTP 200 after off-thread dispatch, got "
        f"{response.status_code} with body {response.text!r}"
    )

    # The stub was invoked exactly once.
    assert spy.call_count == 1, (
        f"Expected the diagnose callable to be invoked exactly once via "
        f"asyncio.to_thread, got {spy.call_count} invocations."
    )

    # The stub observed *some* thread.
    assert (
        spy.captured_thread is not None
    ), "The stub never recorded a thread — it was likely never invoked."
    assert spy.captured_ident is not None

    # PRIMARY assertion (AC10 wire requirement): the thread the diagnose
    # callable observed is NOT the event-loop thread. If the handler
    # regressed to calling ``diagnose_fn(selfie_bytes)`` directly inside
    # the ``async def`` body, ``spy.captured_thread`` would equal
    # ``event_loop_thread`` and this assertion would fail.
    assert spy.captured_thread is not event_loop_thread, (
        "AC10 violated: the diagnose callable ran on the event-loop "
        "thread, which means the handler did NOT use asyncio.to_thread. "
        f"event_loop_thread={event_loop_thread!r}, "
        f"captured_thread={spy.captured_thread!r}."
    )

    # Defense in depth: compare OS thread idents (integers) as well.
    # Two Thread objects representing the same OS thread share the same
    # ident, so identity-by-ident catches any harness that wraps the
    # main thread in a different Thread object than ``threading.main_thread()``.
    assert spy.captured_ident != event_loop_ident, (
        "AC10 violated: the diagnose callable's OS thread id matches the "
        "event-loop's OS thread id, meaning asyncio.to_thread did not "
        f"offload the call. event_loop_ident={event_loop_ident}, "
        f"captured_ident={spy.captured_ident}."
    )

    # Additionally, the captured thread must not be the process main thread.
    # ``threading.main_thread()`` is the thread the interpreter started on,
    # which under pytest-asyncio + ASGITransport is the same thread that
    # runs the event loop. This redundant check survives test-runner
    # configurations where the test coroutine is hoisted to a non-main
    # thread (in which case the primary assertion above already covers it,
    # but the explicit ``main_thread()`` check matches the AC text verbatim).
    assert spy.captured_thread is not threading.main_thread(), (
        "AC10 violated: the diagnose callable ran on the process main "
        "thread (which hosts the asyncio loop under this test harness). "
        f"main_thread={threading.main_thread()!r}, "
        f"captured_thread={spy.captured_thread!r}."
    )


@pytest.mark.unit
async def test_post_v1_diagnose_captured_thread_is_a_worker_thread() -> None:
    """The captured thread is a live ``threading.Thread`` worker instance.

    Complements the primary AC10 assertion: not only is the captured
    thread *different* from the event-loop thread, it is also a real
    ``threading.Thread`` (not ``None``, not a stale sentinel). This
    catches a regression where the handler somehow captured the value
    *before* invoking the callable — in that case ``captured_thread``
    would still be ``None`` even though ``call_count`` advanced.
    """
    app = create_app()
    spy = _ThreadCapturingDiagnoseSpy(_fixed_diagnosis_result())
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
    assert spy.call_count == 1
    captured: Any = spy.captured_thread
    assert isinstance(captured, threading.Thread), (
        f"Expected captured_thread to be a threading.Thread instance, "
        f"got {type(captured).__name__}: {captured!r}."
    )
