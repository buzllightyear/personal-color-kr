"""Tests for the Fal.ai storage upload step (Seed Contract AC 3).

# What this file pins down

The 3-step Fal.ai img2img flow begins with uploading the user's selfie
bytes to Fal storage and receiving back a short-lived HTTP URL. This
file pins:

  * The HTTP shape we send (URL, method, headers, multipart field).
  * The allowlist parsing of the response (only the documented ``url``
    key escapes the layer; every other field is discarded).
  * The error classification rules the outer ``edit_image`` retry loop
    depends on:
      - HTTP 429 / 5xx, network error, timeout      → ``VendorError`` (retryable)
      - HTTP 4xx (excluding 429), malformed JSON,
        missing/empty/non-string ``url``            → ``ValueError`` (non-retryable)
  * The per-phase timeout ceiling (3s) — the upload step must never
    consume the budget reserved for the edit (15s) and download (3s)
    phases.
  * The redaction discipline — no API key, no upload URL, and no
    HTTP header value reaches a log record at any level.

# Why transport-level mocks?

The Seed Contract bans conditional branches for mocks in production
code, so we exercise the *real* ``httpx.Client`` against an
``httpx.MockTransport`` (the same primitive ``respx`` and ``pytest-httpx``
are built on top of). ``monkeypatch.setattr`` swaps the
module-resident ``httpx.Client`` symbol for a thin factory that
injects the mock transport — the adapter's source code is unchanged.

# Why a dedicated test file?

Sibling AC tests (``test_fal_ai_api_key.py``, ``test_fal_ai_defaults.py``,
``test_fal_ai_preset_to_prompt.py``) intentionally scope themselves to a
single concern — the env loader, the model-param defaults, the preset
mapping. Keeping the upload-step tests in their own file mirrors that
structure: easier to grep, parallel-safe to author, and the next
sibling AC (img2img POST, download) can follow the same pattern
without conflicts.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Final

import httpx
import pytest

from image_edit.fal_ai_vendor_caller import (
    FalAiVendorCaller,
    _FAL_STORAGE_RESPONSE_URL_KEY,
    _FAL_STORAGE_UPLOAD_FIELD,
    _FAL_STORAGE_UPLOAD_URL,
    _FAL_UPLOAD_TIMEOUT_CEILING_SECONDS,
)
from image_edit.vendor_client import VendorError

# A clearly-fake API key. The test suite asserts the value never appears
# in any captured log record, so we keep it distinct from any string we
# log on purpose (e.g. byte counts, elapsed seconds).
_TEST_API_KEY: Final[str] = "fake-id-12345:fake-secret-do-not-use-67890"

# Minimal non-empty selfie payload. The adapter treats bytes as opaque,
# so any non-empty payload works. We use a short, recognisable byte
# string so failed assertions print something legible.
_FAKE_SELFIE_BYTES: Final[bytes] = b"FAKE_SELFIE_PAYLOAD"

# The URL Fal storage "returns" in successful mocks. Distinctive enough
# that an accidental log leak would be obvious in test output.
_FAKE_UPLOAD_URL: Final[str] = "https://v3.fal.media/files/elephant/leak-canary-url.png"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# Capture the real ``httpx.Client`` constructor at module import — *before*
# any test monkeypatches the symbol — so the mock factory can build a real
# Client configured with ``MockTransport`` without recursing into itself.
_REAL_HTTPX_CLIENT: Final[type[httpx.Client]] = httpx.Client


def _install_mock_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.Request]:
    """Replace ``httpx.Client`` inside the adapter module with a mock.

    Returns a captured list of the requests routed through the mock,
    so tests can assert on the request shape (URL, headers, body,
    multipart field name).

    The replacement is module-scoped via ``monkeypatch``, so the
    real ``httpx.Client`` is restored automatically at the end of
    each test — no cross-test contamination and no global side
    effects.

    The factory uses :data:`_REAL_HTTPX_CLIENT` (captured at import
    time) to build the underlying ``httpx.Client``; calling ``httpx.Client``
    after monkeypatching would recurse into the factory itself.
    """
    captured: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        # Materialise the body so multipart assertions can inspect it
        # after the request has been "sent" to the mock. ``request.read()``
        # is the documented way to do this in httpx.
        request.read()
        captured.append(request)
        return handler(request)

    transport = httpx.MockTransport(recording_handler)

    def _client_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        # Forward all kwargs (timeout, etc.) and inject the mock
        # transport. The adapter never passes ``transport=``
        # itself, so this hijack is invisible to production code.
        kwargs["transport"] = transport
        return _REAL_HTTPX_CLIENT(*args, **kwargs)

    monkeypatch.setattr(
        "image_edit.fal_ai_vendor_caller.httpx.Client",
        _client_factory,
    )
    return captured


def _make_caller() -> FalAiVendorCaller:
    """Build a caller with a recognisable fake key.

    Kept as a tiny helper so the key value lives in exactly one place
    — the leak-canary assertions in this file all check that the
    same literal never reaches a log record.
    """
    return FalAiVendorCaller(api_key=_TEST_API_KEY)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_upload_returns_url_from_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful 200 response yields exactly the JSON ``url`` value."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            json={
                _FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL,
                # Extra fields that the allowlist must discard. We embed
                # a leak-canary string here so the "never logs the
                # response payload" assertions can detect a regression
                # that returned more than just the URL.
                "internal_secret_token": "LEAK-CANARY-INTERNAL-TOKEN",
                "expires_at": "2099-12-31T23:59:59Z",
            },
        )

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    url = caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    # The adapter returns the URL string, NOT the JSON payload — so
    # leak-canary fields can never reach the next step in the flow.
    assert url == _FAKE_UPLOAD_URL


@pytest.mark.unit
def test_upload_request_shape_is_correct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The adapter POSTs to the right URL with the right method + headers."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        ),
    )

    caller = _make_caller()
    caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    assert len(captured) == 1
    request = captured[0]
    # URL: must match the documented storage upload endpoint.
    assert str(request.url) == _FAL_STORAGE_UPLOAD_URL
    # Method: POST per Fal's documented contract.
    assert request.method == "POST"
    # Authorization header carries the ``Key <api_key>`` scheme — the
    # same scheme the smoke script and Fal docs use.
    assert request.headers["Authorization"] == f"Key {_TEST_API_KEY}"
    # Accept JSON so a misroute returning HTML fails fast.
    assert request.headers["Accept"] == "application/json"


@pytest.mark.unit
def test_upload_sends_multipart_with_documented_field_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The selfie bytes ride in the ``file`` field of a multipart body."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        ),
    )

    caller = _make_caller()
    caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    body = captured[0].content
    # ``multipart/form-data; boundary=...`` content type marks the body
    # as a multipart payload built by httpx.
    content_type = captured[0].headers["Content-Type"]
    assert content_type.startswith("multipart/form-data"), content_type
    # The boundary-delimited body must contain a Content-Disposition
    # header naming the documented field ("file") and the raw bytes
    # we passed in.
    assert (
        f'name="{_FAL_STORAGE_UPLOAD_FIELD}"'.encode("ascii") in body
    ), "multipart body did not name the documented upload field"
    assert (
        _FAKE_SELFIE_BYTES in body
    ), "multipart body did not include the selfie bytes verbatim"


@pytest.mark.unit
def test_upload_return_type_is_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The return type is ``str`` — never bytes, dict, or Response."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        ),
    )

    caller = _make_caller()
    result = caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)
    assert isinstance(result, str)


# ---------------------------------------------------------------------------
# Timeout ceiling
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_upload_clips_timeout_to_phase_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A generous end-to-end budget is clipped to the 3s upload ceiling."""
    observed_timeouts: list[httpx.Timeout] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        )

    transport = httpx.MockTransport(handler)

    def _capturing_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        # The adapter passes ``timeout=`` — capture and forward.
        timeout = kwargs.get("timeout")
        if timeout is not None:
            observed_timeouts.append(httpx.Timeout(timeout))
        kwargs["transport"] = transport
        return _REAL_HTTPX_CLIENT(*args, **kwargs)

    monkeypatch.setattr(
        "image_edit.fal_ai_vendor_caller.httpx.Client", _capturing_factory
    )

    caller = _make_caller()
    # 25s is the end-to-end budget; the upload step must clip to ≤3s.
    caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=25.0)

    assert observed_timeouts, "adapter did not pass a timeout to httpx.Client"
    # The Timeout object carries the connect/read/write/pool values.
    # We only care that the overall (read) ceiling is ≤ 3.0.
    timeout = observed_timeouts[0]
    assert (
        timeout.read is not None and timeout.read <= _FAL_UPLOAD_TIMEOUT_CEILING_SECONDS
    )


@pytest.mark.unit
def test_upload_preserves_tight_budget_below_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tight retry-loop budget (<3s) wins over the phase ceiling."""
    observed_timeouts: list[float] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        )

    transport = httpx.MockTransport(handler)

    def _capturing_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        t = kwargs.get("timeout")
        if t is not None:
            observed_timeouts.append(float(t))
        kwargs["transport"] = transport
        return _REAL_HTTPX_CLIENT(*args, **kwargs)

    monkeypatch.setattr(
        "image_edit.fal_ai_vendor_caller.httpx.Client", _capturing_factory
    )

    caller = _make_caller()
    caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=0.75)

    assert observed_timeouts == [0.75], (
        "adapter should pass tight budgets through unchanged; "
        f"saw {observed_timeouts!r}"
    )


@pytest.mark.unit
def test_upload_rejects_zero_or_negative_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``timeout <= 0`` raises VendorError before any HTTP attempt."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: pytest.fail("no HTTP call should be made"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="exhausted"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=0.0)

    with pytest.raises(VendorError, match="exhausted"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=-0.5)

    assert captured == [], "no request should have been sent"


# ---------------------------------------------------------------------------
# Transient (retryable) failures → VendorError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_upload_5xx_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """Server faults are transient — translate to ``VendorError``."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="server fault details"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match=f"HTTP {status}"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_429_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Rate-limit 429 is transient (the outer loop will back off + retry)."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(429, json={"error": "rate limited"}),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="HTTP 429"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_timeout_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An ``httpx.TimeoutException`` translates to ``VendorError``."""

    def handler(_request: httpx.Request) -> httpx.Response:
        # Raising inside the handler propagates through the transport.
        raise httpx.ReadTimeout("simulated upload read timeout")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="timed out"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_network_error_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``httpx.ConnectError`` (and siblings) translate to ``VendorError``."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated DNS failure")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="transport error"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


# ---------------------------------------------------------------------------
# Permanent (non-retryable) failures → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("status", [400, 401, 403, 404, 415, 422])
def test_upload_4xx_excluding_429_raises_value_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """Client errors are non-retryable — must short-circuit the loop."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="client error details"),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match=f"HTTP {status}"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_unexpected_status_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 3xx (or 1xx) is unexpected on a storage upload — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(301, headers={"Location": "https://nope"}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="unexpected HTTP 301"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_non_json_response_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 with non-JSON body is a contract violation — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            text="<html>not JSON</html>",
            headers={"Content-Type": "text/html"},
        ),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="non-JSON body"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_non_object_json_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 with JSON ``[...]`` is not a mapping — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, json=["not", "an", "object"]),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="not a JSON object"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_missing_url_field_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ``url`` key in the response is a contract violation."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, json={"other": "field"}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing required"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_empty_url_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty ``url`` string is not actionable downstream — reject it."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, json={_FAL_STORAGE_RESPONSE_URL_KEY: ""}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing required"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


@pytest.mark.unit
def test_upload_non_string_url_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-string ``url`` (int / list / null) is a contract violation."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, json={_FAL_STORAGE_RESPONSE_URL_KEY: 12345}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing required"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)


# ---------------------------------------------------------------------------
# Logging / redaction discipline
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_upload_debug_log_contains_elapsed_and_bytes(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The DEBUG breadcrumb names elapsed seconds and the input byte count."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        ),
    )

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG, logger="image_edit.fal_ai_vendor_caller"):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    messages = [r.getMessage() for r in caplog.records]
    assert any(
        "upload phase complete" in m for m in messages
    ), f"expected DEBUG breadcrumb after successful upload; saw: {messages!r}"
    assert any(
        f"upload_bytes={len(_FAKE_SELFIE_BYTES)}" in m for m in messages
    ), "DEBUG log must record the input payload size"


@pytest.mark.unit
def test_upload_log_never_contains_api_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No log record at any level may carry the API key literal."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        ),
    )

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    for record in caplog.records:
        message = record.getMessage()
        assert _TEST_API_KEY not in message, (
            "API key value leaked into a log record — Seed Contract "
            "forbids embedding FAL_API_KEY in any log statement."
        )
        # Also check the structured args, since ``%s`` formatting might
        # not embed the secret in ``getMessage()`` for every call shape.
        for arg in record.args or ():
            assert _TEST_API_KEY not in str(
                arg
            ), "API key value leaked into a log record's args."


@pytest.mark.unit
def test_upload_log_never_contains_storage_url(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No log record may carry the returned Fal storage URL."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200, json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL}
        ),
    )

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    for record in caplog.records:
        message = record.getMessage()
        assert _FAKE_UPLOAD_URL not in message, (
            "Returned upload URL leaked into a log record — Seed "
            "Contract forbids logging fal storage URLs."
        )
        for arg in record.args or ():
            assert _FAKE_UPLOAD_URL not in str(
                arg
            ), "Returned upload URL leaked into a log record's args."


@pytest.mark.unit
def test_upload_log_never_contains_response_payload(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Extra response fields (beyond ``url``) must not reach any log."""
    canary = "LEAK-CANARY-RESPONSE-EXTRA-FIELD"
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            json={
                _FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL,
                "internal_token": canary,
                "trace_id": canary,
            },
        ),
    )

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    for record in caplog.records:
        assert canary not in record.getMessage()
        for arg in record.args or ():
            assert canary not in str(arg)


@pytest.mark.unit
def test_upload_error_messages_do_not_embed_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exception messages must not echo the API key (4xx / 5xx paths)."""
    # Hit every classified error branch and assert none of the
    # exception messages embed the API key value.
    handlers: list[tuple[str, Callable[[httpx.Request], httpx.Response]]] = [
        ("500", lambda _r: httpx.Response(500, text="server error")),
        ("429", lambda _r: httpx.Response(429, text="rate limited")),
        ("400", lambda _r: httpx.Response(400, text="bad request")),
        ("404", lambda _r: httpx.Response(404, text="not found")),
        ("301", lambda _r: httpx.Response(301)),
    ]
    caller = _make_caller()
    for tag, handler in handlers:
        _install_mock_transport(monkeypatch, handler)
        try:
            caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)
        except (VendorError, ValueError) as exc:
            assert _TEST_API_KEY not in str(
                exc
            ), f"{tag} branch leaked API key into exception message"
        else:
            pytest.fail(f"{tag} branch did not raise as expected")


# ---------------------------------------------------------------------------
# Thread safety: stateless after __init__
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_upload_is_stateless_across_invocations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each call routes through a fresh httpx.Client — no shared mutable state."""
    call_count = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        return httpx.Response(
            200,
            json={
                _FAL_STORAGE_RESPONSE_URL_KEY: f"{_FAKE_UPLOAD_URL}?n={call_count['n']}"
            },
        )

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    first = caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)
    second = caller._upload_selfie_to_storage(_FAKE_SELFIE_BYTES, timeout=3.0)

    assert first != second, "each call must see the fresh mock response"
    assert call_count["n"] == 2
    # ``FalAiVendorCaller`` uses ``__slots__`` to forbid attribute
    # injection — no mutable per-call state can be stashed there.
    assert caller.__slots__ == ("_api_key", "_authorization_header")
