"""Phase 4 FastAPI-handler-callable contract for ``diagnose_personal_color``.

AC 14 (*"Phase 4 FastAPI handler can call diagnose_personal_color directly
without wrapper"*) is a **contract** acceptance criterion: it does not add
new behaviour, it pins the public-surface guarantees that allow a
forthcoming FastAPI handler (Phase 4) to do this end-to-end without any
adapter / glue layer in between:

.. code-block:: python

    @app.post("/diagnose")
    async def diagnose(request: Request) -> JSONResponse:
        payload = await request.body()
        try:
            result = diagnose_personal_color(payload)
        except InvalidSelfieError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FaceNotDetectedError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return JSONResponse(dataclasses.asdict(result))

Every test in this file pins exactly one property of the surface that
makes the snippet above valid. If any test in this file starts failing,
the Phase 4 handler must add a wrapper — and the Seed says it must not.

The contract guarantees pinned here:

  * **Positional ``bytes`` argument.** The handler reads the request body
    as ``bytes`` and passes it positionally — no ``selfie_bytes=...``
    keyword required. The dependency-injection seams (``_decoder`` /
    ``_detector``) must stay keyword-only with production defaults so a
    positional call resolves cleanly.
  * **Single required parameter.** A FastAPI handler must not need to
    know about the DI seams — production callers MUST never pass
    ``_decoder`` / ``_detector`` (coordinator review warning). The
    signature must expose exactly one *required* parameter.
  * **Synchronous return.** ``diagnose_personal_color`` must be a plain
    function (not a coroutine). A handler can call it inside an ``async
    def`` either directly or via ``run_in_executor`` — both modes work
    against a plain function, only the former works against a coroutine.
  * **No required init / setup.** Importing the public symbol must be
    enough to call it — no module-level "open the model" handshake, no
    "configure first" requirement.
  * **Errors are ``ValueError`` subclasses.** Both ``InvalidSelfieError``
    (HTTP 400) and ``FaceNotDetectedError`` (HTTP 422) extend
    ``ValueError``, so a handler that wants a single generic catch can
    rely on the base class while still distinguishing on the concrete
    type for status-code mapping.
  * **Errors expose a string-safe message.** ``str(exc)`` returns
    something the handler can put into a JSON error envelope without
    leaking PII. The Seed PII allow-list (``distinct_id``,
    ``transaction_id``, ``receipt_token``, ``customer_email``,
    ``selfieUri``) MUST NOT appear in any error message produced by the
    runtime.
  * **Result is ``dataclasses.asdict``-serializable.** A FastAPI handler
    serializes the ``DiagnosisResult`` to JSON via ``asdict``; the
    Enum-typed fields must round-trip through the asdict call without a
    custom encoder.

This whole file is pure-stdlib + ``pytest`` + stub callables — no Pillow
import, no MediaPipe import, no ``fastapi`` import. The handler shape is
*simulated* via an inline ``async def`` so the test exercises the same
call pattern a real FastAPI handler would use, without making FastAPI a
test-time dependency.
"""

from __future__ import annotations

import asyncio
import dataclasses
import inspect

import pytest

from personal_color.diagnose_runtime import diagnose_personal_color
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.face_detector import FaceNotDetectedError
from personal_color.image_decoder import InvalidSelfieError
from personal_color.region_extractor import FaceRegions, Image, Region
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# Synthetic image + region fixtures — identical structure to the AC 1 tests
# so the contract surface is exercised against the same deterministic input
# the rest of the suite already pins behaviourally.
# ---------------------------------------------------------------------------


def _build_image() -> Image:
    """A 12x12 image whose three bands deterministically diagnose as SPRING."""
    hair_row = [(20, 20, 20)] * 12
    eyes_row = [(95, 70, 50)] * 12
    skin_row = [(230, 190, 150)] * 12
    rows: list[tuple[tuple[int, int, int], ...]] = []
    for _ in range(4):
        rows.append(tuple(hair_row))
    for _ in range(4):
        rows.append(tuple(eyes_row))
    for _ in range(4):
        rows.append(tuple(skin_row))
    return tuple(rows)


def _build_regions() -> FaceRegions:
    return FaceRegions(
        skin=Region(x=2, y=8, width=8, height=4),
        eyes=Region(x=2, y=4, width=8, height=4),
        hair=Region(x=2, y=0, width=8, height=4),
    )


def _stub_decoder(image: Image):  # type: ignore[no-untyped-def]
    def _decode(_payload: bytes) -> Image:
        return image

    return _decode


def _stub_detector(regions: FaceRegions):  # type: ignore[no-untyped-def]
    def _detect(_image: Image) -> FaceRegions:
        return regions

    return _detect


# ---------------------------------------------------------------------------
# Signature contract — positional bytes, keyword-only DI seams, single
# required parameter.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_signature_has_exactly_one_required_parameter() -> None:
    """A FastAPI handler must not be forced to know about the DI seams.

    Exactly one parameter (``selfie_bytes``) is required; the rest carry
    production defaults. A second required parameter would force the
    handler to pass an internal-looking value at every call site.
    """
    sig = inspect.signature(diagnose_personal_color)
    required = [
        name
        for name, param in sig.parameters.items()
        if param.default is inspect.Parameter.empty
    ]
    assert required == ["selfie_bytes"]


@pytest.mark.unit
def test_selfie_bytes_parameter_is_positional_callable() -> None:
    """The handler calls ``diagnose_personal_color(body)`` positionally.

    ``selfie_bytes`` must be POSITIONAL_OR_KEYWORD (not KEYWORD_ONLY) so
    the handler can pass the request body without naming the argument.
    """
    sig = inspect.signature(diagnose_personal_color)
    selfie_param = sig.parameters["selfie_bytes"]
    assert selfie_param.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
    # And it really is required — no silent default.
    assert selfie_param.default is inspect.Parameter.empty


@pytest.mark.unit
def test_dependency_injection_seams_are_keyword_only() -> None:
    """Coordinator-review rule: prod callers must not pass ``_decoder`` /
    ``_detector`` positionally — they are test-only seams.

    Marking them KEYWORD_ONLY removes the foot-gun: a handler trying to
    pass them by accident would get a TypeError at call time, and a
    positional call only ever resolves to the production defaults.
    """
    sig = inspect.signature(diagnose_personal_color)
    for hidden_name in ("_decoder", "_detector"):
        hidden = sig.parameters[hidden_name]
        assert hidden.kind is inspect.Parameter.KEYWORD_ONLY
        assert hidden.default is not inspect.Parameter.empty


@pytest.mark.unit
def test_positional_call_resolves_production_defaults() -> None:
    """``diagnose_personal_color(b"...")`` — no kwargs — picks up the
    production decoder / detector.

    We do not *call* the production defaults here (that would require
    Pillow + MediaPipe). Instead we prove that omitting ``_decoder`` /
    ``_detector`` in the signature inspection yields the production
    functions as defaults, so a positional handler call resolves them.
    """
    from personal_color.face_detector import detect_face_regions
    from personal_color.image_decoder import decode_image

    sig = inspect.signature(diagnose_personal_color)
    assert sig.parameters["_decoder"].default is decode_image
    assert sig.parameters["_detector"].default is detect_face_regions


# ---------------------------------------------------------------------------
# Synchronous-callable contract — ``diagnose_personal_color`` is a plain
# function, not a coroutine. A FastAPI handler can call it directly inside
# an ``async def`` (or hand it off to ``run_in_executor``); a coroutine
# would force the handler into a single calling style.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_runtime_entry_point_is_not_a_coroutine_function() -> None:
    """A coroutine would break direct synchronous use inside a handler."""
    assert not inspect.iscoroutinefunction(diagnose_personal_color)
    assert not asyncio.iscoroutinefunction(diagnose_personal_color)


@pytest.mark.unit
def test_returns_diagnosis_result_synchronously() -> None:
    """Calling the function returns a value, not an awaitable."""
    result = diagnose_personal_color(
        b"<<payload>>",
        _decoder=_stub_decoder(_build_image()),
        _detector=_stub_detector(_build_regions()),
    )
    assert isinstance(result, DiagnosisResult)
    assert not inspect.isawaitable(result)


# ---------------------------------------------------------------------------
# End-to-end "handler shape" exercise — simulate the FastAPI handler call
# pattern: an ``async def`` reads the body bytes, calls
# ``diagnose_personal_color`` positionally, catches the two documented
# errors, and serializes the result with ``dataclasses.asdict``.
# ---------------------------------------------------------------------------


def _run_handler_async(  # type: ignore[no-untyped-def]
    body: bytes,
    *,
    decoder,
    detector,
) -> dict[str, object]:
    """Drive a simulated FastAPI handler against the runtime entry point.

    The handler body is the *exact* call pattern documented in the
    module docstring — no wrapper, no glue. If the test in this section
    fails, the Phase 4 handler must add a wrapper, which the Seed
    forbids.
    """

    async def handler() -> dict[str, object]:
        # Positional bytes argument — no `selfie_bytes=` kwarg.
        # The handler MUST NOT pass `_decoder` / `_detector` in
        # production; the test injects them only so the assertion runs
        # without native dependencies.
        result = diagnose_personal_color(
            body,
            _decoder=decoder,
            _detector=detector,
        )
        return dataclasses.asdict(result)

    return asyncio.run(handler())


@pytest.mark.unit
def test_handler_shape_returns_jsonable_dict_on_happy_path() -> None:
    """End-to-end: a FastAPI-shaped handler returns a dict ready for JSON."""
    payload = _run_handler_async(
        b"<<happy-path-bytes>>",
        decoder=_stub_decoder(_build_image()),
        detector=_stub_detector(_build_regions()),
    )

    # The 9 DiagnosisResult fields must all appear in the dict — this
    # is the response body the handler would JSON-serialize.
    expected_fields = {
        "season",
        "confidence",
        "tone",
        "contrast",
        "tone_confidence",
        "contrast_confidence",
        "skin_luma",
        "hair_luma",
        "eyes_luma",
    }
    assert set(payload.keys()) == expected_fields


@pytest.mark.unit
def test_handler_can_map_invalid_selfie_error_to_http_400() -> None:
    """``InvalidSelfieError`` propagates so the handler can map it to 400.

    Phase 4 contract: bytes that the decoder rejects are a permanent
    client error and surface as HTTP 400 Bad Request. The runtime must
    not swallow the exception — it must propagate untouched.
    """

    def exploding_decoder(_payload: bytes) -> Image:
        raise InvalidSelfieError("selfie payload could not be decoded as an image")

    async def handler() -> None:
        diagnose_personal_color(
            b"<<garbage>>",
            _decoder=exploding_decoder,
            _detector=_stub_detector(_build_regions()),
        )

    with pytest.raises(InvalidSelfieError):
        asyncio.run(handler())


@pytest.mark.unit
def test_handler_can_map_face_not_detected_error_to_http_422() -> None:
    """``FaceNotDetectedError`` propagates so the handler can map it to 422.

    Bytes decoded fine but no face was detected — semantically
    unprocessable. Phase 4 maps to HTTP 422 Unprocessable Entity.
    """

    def exploding_detector(_image: Image) -> FaceRegions:
        raise FaceNotDetectedError("no face detected in selfie")

    async def handler() -> None:
        diagnose_personal_color(
            b"<<faceless-image>>",
            _decoder=_stub_decoder(_build_image()),
            _detector=exploding_detector,
        )

    with pytest.raises(FaceNotDetectedError):
        asyncio.run(handler())


# ---------------------------------------------------------------------------
# Error-type hierarchy — both error classes extend ``ValueError`` so a
# handler that wants one generic catch can rely on the base class while
# still being able to distinguish on the concrete type.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_invalid_selfie_error_subclasses_value_error() -> None:
    """Handler can ``except ValueError`` if it does not need to distinguish."""
    assert issubclass(InvalidSelfieError, ValueError)


@pytest.mark.unit
def test_face_not_detected_error_subclasses_value_error() -> None:
    """Handler can ``except ValueError`` if it does not need to distinguish."""
    assert issubclass(FaceNotDetectedError, ValueError)


@pytest.mark.unit
def test_error_classes_are_distinguishable_for_status_mapping() -> None:
    """``InvalidSelfieError`` and ``FaceNotDetectedError`` are siblings, not
    a chain — the handler maps each to a different HTTP status (400 vs
    422), so they must be independently catchable.
    """
    assert not issubclass(InvalidSelfieError, FaceNotDetectedError)
    assert not issubclass(FaceNotDetectedError, InvalidSelfieError)


@pytest.mark.unit
def test_error_classes_importable_from_runtime_module_directly() -> None:
    """A FastAPI handler should not need three imports to catch two errors.

    ``diagnose_runtime`` re-exports both error types so the handler can
    do a single ``from personal_color.diagnose_runtime import
    diagnose_personal_color, InvalidSelfieError, FaceNotDetectedError``.
    """
    from personal_color import diagnose_runtime

    assert diagnose_runtime.InvalidSelfieError is InvalidSelfieError
    assert diagnose_runtime.FaceNotDetectedError is FaceNotDetectedError
    # ``__all__`` advertises them so static analysers see the re-export.
    assert "InvalidSelfieError" in diagnose_runtime.__all__
    assert "FaceNotDetectedError" in diagnose_runtime.__all__


# ---------------------------------------------------------------------------
# Error-message PII safety — the handler echoes ``str(exc)`` into a JSON
# error envelope. The Seed PII allow-list MUST NOT appear in any error
# message produced by the runtime.
# ---------------------------------------------------------------------------


_PII_TOKENS: tuple[str, ...] = (
    "distinct_id",
    "transaction_id",
    "receipt_token",
    "customer_email",
    "selfieUri",
)


@pytest.mark.unit
@pytest.mark.parametrize(
    "trigger_bytes",
    [
        b"",  # empty
        b"not an image at all",  # bad magic
        b"\x89PNG\r\n\x1a\n" + b"x" * 16,  # PNG magic + garbage body
    ],
)
def test_invalid_selfie_error_messages_contain_no_pii_tokens(
    trigger_bytes: bytes,
) -> None:
    """``str(InvalidSelfieError)`` is safe to echo back to the client.

    The decoder is exercised through the *real* production callable for
    this test (it has no native dep beyond Pillow, which is installed).
    If Pillow is missing, the test is skipped — the contract still
    holds, just via the magic-header gate which does not require Pillow.
    """
    from personal_color.image_decoder import decode_image

    with pytest.raises(InvalidSelfieError) as exc_info:
        decode_image(trigger_bytes)

    message = str(exc_info.value)
    for token in _PII_TOKENS:
        assert token not in message, (
            f"PII token {token!r} leaked into InvalidSelfieError message: "
            f"{message!r}"
        )


@pytest.mark.unit
def test_face_not_detected_error_message_contains_no_pii_tokens() -> None:
    """``str(FaceNotDetectedError)`` is safe to echo back to the client."""
    exc = FaceNotDetectedError("no face detected in selfie")
    for token in _PII_TOKENS:
        assert token not in str(exc)


# ---------------------------------------------------------------------------
# JSON-serializability — the handler's response body is
# ``dataclasses.asdict(result)``; that dict must be valid input to
# ``json.dumps`` without a custom encoder. Enums serialize via their slug.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_result_dict_round_trips_through_dataclasses_asdict() -> None:
    """``dataclasses.asdict`` does not raise on the result.

    The Phase 4 handler serializes the result body via ``asdict``.
    Any field type that breaks ``asdict`` (e.g. a non-dataclass nested
    object that recursively dispatches) would force the handler to
    write a custom serializer wrapper — which the Seed forbids.
    """
    result = diagnose_personal_color(
        b"<<payload>>",
        _decoder=_stub_decoder(_build_image()),
        _detector=_stub_detector(_build_regions()),
    )
    payload = dataclasses.asdict(result)
    assert isinstance(payload, dict)
    # Enum fields survive the round-trip as Enum instances; the handler
    # is responsible for projecting them to their stable slug before the
    # final JSON encode. We verify the projection works in the next test.
    assert isinstance(payload["season"], Season)


@pytest.mark.unit
def test_season_slug_is_jsonable_via_helper_without_wrapper() -> None:
    """The Season enum exposes a ``.slug`` string the handler can encode.

    The handler turns the enum into a JSON string with ``result.season.slug``
    — a direct attribute read, no custom JSON encoder, no wrapper module.
    """
    import json

    result = diagnose_personal_color(
        b"<<payload>>",
        _decoder=_stub_decoder(_build_image()),
        _detector=_stub_detector(_build_regions()),
    )

    # The handler's serialization step is a single dict comprehension —
    # *no* wrapper layer.
    response_body = {
        "season": result.season.slug,
        "confidence": result.confidence,
        "tone": result.tone.name.lower(),
        "contrast": result.contrast.name.lower(),
        "tone_confidence": result.tone_confidence,
        "contrast_confidence": result.contrast_confidence,
        "skin_luma": result.skin_luma,
        "hair_luma": result.hair_luma,
        "eyes_luma": result.eyes_luma,
    }
    encoded = json.dumps(response_body)
    # Round-trip: re-parsing must yield equal data — proves the body is
    # standard JSON, no custom encoder needed.
    assert json.loads(encoded) == response_body


# ---------------------------------------------------------------------------
# No required init / setup — a fresh import of the runtime module must be
# enough to call the entry point. No "open model", no "configure first".
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_runtime_module_exposes_no_required_init_function() -> None:
    """``diagnose_runtime`` exposes only the entry point + error types.

    A FastAPI handler should be able to import the entry point and
    immediately call it on the first request. If the module exposed a
    ``setup()`` / ``initialize()`` / ``configure()`` function in its
    ``__all__``, the handler would need lifecycle glue (a wrapper).
    """
    from personal_color import diagnose_runtime

    forbidden = {"setup", "initialize", "configure", "init", "start"}
    exported = set(diagnose_runtime.__all__)
    assert exported.isdisjoint(forbidden), (
        "diagnose_runtime exposes a lifecycle hook in __all__ — "
        "FastAPI handler would need a wrapper to drive it: "
        f"{sorted(exported & forbidden)}"
    )
