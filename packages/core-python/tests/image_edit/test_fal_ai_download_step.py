"""Tests for the Fal.ai CDN download step (Seed Contract AC 5).

# What this file pins down

The 3-step Fal.ai img2img flow's *final* step dereferences the CDN URL
returned by :meth:`FalAiVendorCaller._post_img2img_request` and returns
the raw edited image bytes. This file pins:

  * The HTTP shape we send (URL = the opaque CDN URL handed in,
    method = ``GET``, no ``Authorization`` header so the API key
    cannot reach a CDN access log, ``Accept: */*`` so a future
    encoding rotation by Fal cannot silently break the leg).
  * The bytes-only return contract — every other piece of the
    response (headers, status code, framework metadata) is
    deliberately discarded so it cannot leak through the layer
    boundary.
  * The error classification rules the outer ``edit_image`` retry
    loop depends on:
      - HTTP 429 / 5xx, network error, timeout      → ``VendorError`` (retryable)
      - HTTP 4xx (excluding 429), unexpected 3xx,
        empty 200 body                              → ``ValueError`` (non-retryable)
  * The per-phase timeout ceiling (3s) — the download step must never
    consume the budget reserved for the upload (3s) + edit (15s)
    phases or the retry-loop bookkeeping margin.
  * The redaction discipline — no API key (which is never even sent
    to the CDN), no CDN URL, no response payload metadata reaches a
    log record at any level.

# Why transport-level mocks?

The Seed Contract bans conditional branches for mocks in production
code, so we exercise the *real* ``httpx.Client`` against an
``httpx.MockTransport`` (the same primitive ``respx`` and
``pytest-httpx`` are built on top of). ``monkeypatch.setattr`` swaps
the module-resident ``httpx.Client`` symbol for a thin factory that
injects the mock transport — the adapter's source code is unchanged.

# Why a dedicated test file?

Sibling AC tests (``test_fal_ai_api_key.py``,
``test_fal_ai_defaults.py``, ``test_fal_ai_preset_to_prompt.py``,
``test_fal_ai_upload_step.py``, ``test_fal_ai_request_builder.py``,
``test_fal_ai_edit_step.py``) intentionally scope themselves to a
single concern. Keeping the download-step tests in their own file
mirrors that structure, parallels the upload / edit step files
almost exactly so reviewers can A/B-compare the three, and lets the
end-to-end ``__call__`` wiring AC follow the same pattern without
conflicts.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Final

import httpx
import pytest

from image_edit.fal_ai_vendor_caller import (
    _FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS,
    FalAiVendorCaller,
)
from image_edit.vendor_client import VendorError

# A clearly-fake API key. The test suite asserts the value never
# appears in any captured log record or exception message — and in
# fact the download step deliberately does NOT send the
# ``Authorization`` header at all, so a leak would be a regression
# in either direction (logged value, or sent over the wire).
_TEST_API_KEY: Final[str] = "fake-id-12345:fake-secret-do-not-use-67890"

# The CDN URL we feed into the download step. Distinctive enough that
# an accidental log/exception leak would be obvious in test output.
# Deliberately not shared with the upload-step or edit-step fixtures
# — these tests live in their own file so they cannot accidentally
# rely on those constants.
_FAKE_CDN_URL: Final[str] = (
    "https://v3.fal.media/files/giraffe/download-step-canary.png"
)

# A recognisable, non-empty payload the mock CDN "delivers". Bytes
# are opaque to the adapter; we use a short literal so failed
# assertions print something legible. The leading PNG magic number
# is purely cosmetic — the adapter never inspects body content.
_FAKE_IMAGE_BYTES: Final[bytes] = b"\x89PNG\r\n\x1a\nDOWNLOAD-STEP-CANARY-PAYLOAD"


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

    Returns a captured list of the requests routed through the mock so
    tests can assert on the request shape (URL, method, headers). The
    replacement is module-scoped via ``monkeypatch`` so the real
    ``httpx.Client`` is restored automatically at the end of each test
    — no cross-test contamination, no global side effects.
    """
    captured: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        # Materialise the body for completeness even though the
        # download step uses GET (which carries no request body in
        # this adapter). Keeps the helper symmetrical with the
        # upload/edit-step helpers so a reviewer can compare them
        # side-by-side.
        request.read()
        captured.append(request)
        return handler(request)

    transport = httpx.MockTransport(recording_handler)

    def _client_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        # Forward all kwargs (timeout, etc.) and inject the mock
        # transport. The adapter never passes ``transport=`` itself,
        # so this hijack is invisible to production code.
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
    — the leak-canary assertions in this file all check that the same
    literal never reaches a log record, an exception message, or any
    HTTP header sent to the CDN.
    """
    return FalAiVendorCaller(api_key=_TEST_API_KEY)


def _ok_response() -> httpx.Response:
    """Build a minimal well-formed 200 response delivering image bytes."""
    return httpx.Response(
        status_code=200,
        content=_FAKE_IMAGE_BYTES,
        headers={
            "Content-Type": "image/png",
            # Leak-canary header so "never logs response metadata"
            # assertions can detect a regression that started
            # echoing headers.
            "x-fal-cdn-node": "LEAK-CANARY-CDN-NODE-ID",
        },
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_returns_response_body_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful 200 yields exactly the response body bytes."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    result = caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    # The adapter returns the bytes verbatim — no decoding, no
    # re-encoding, no size cap. A regression that started normalising
    # the payload (e.g. re-encoding to a fixed format) would fail
    # this exact-equality assertion.
    assert result == _FAKE_IMAGE_BYTES


@pytest.mark.unit
def test_download_request_targets_provided_cdn_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The adapter GETs the exact CDN URL handed in — no rewriting."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    assert len(captured) == 1
    request = captured[0]
    # URL: exactly the string the upstream parser handed in.
    # Rewriting the URL (host substitution, query-string trimming)
    # would be a contract violation — Fal's signed URLs are opaque.
    assert str(request.url) == _FAKE_CDN_URL
    # Method: GET, not HEAD or POST.
    assert request.method == "GET"


@pytest.mark.unit
def test_download_request_omits_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The download GET deliberately does NOT carry the FAL API key.

    Sending the credential to a CDN endpoint would risk it appearing
    in the CDN's access log — exactly the kind of leak the Seed
    Contract's "never log FAL_API_KEY" rule guards against inside this
    process. The CDN URL is already signed by Fal, so the request is
    authenticated by the URL itself.
    """
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    request = captured[0]
    # The Authorization header must be absent (not present-but-empty,
    # not present-with-a-different-scheme). httpx exposes headers as
    # a case-insensitive multi-dict; ``in`` checks the key.
    assert "Authorization" not in request.headers

    # And the bare key value also must not appear on any header — a
    # regression that added the key under a different header name
    # (e.g. ``X-Api-Key``) is still a leak.
    for value in request.headers.values():
        assert _TEST_API_KEY not in value


@pytest.mark.unit
def test_download_request_accepts_wildcard_encoding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``Accept: */*`` so Fal can deliver any image encoding."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    request = captured[0]
    # Pinning the wildcard so a future regression that hard-codes
    # ``image/png`` would surface here. The adapter's contract is
    # "opaque bytes in, opaque bytes out" — narrowing ``Accept``
    # silently breaks the moment Fal rotates encoding defaults.
    assert request.headers["Accept"] == "*/*"


@pytest.mark.unit
def test_download_return_type_is_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The return type is ``bytes`` — never str, dict, or Response."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    result = caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)
    assert isinstance(result, bytes)
    # And non-empty: zero-byte responses are rejected up-front (see
    # the dedicated test below) so a non-empty return is part of the
    # contract.
    assert len(result) > 0


@pytest.mark.unit
def test_download_emits_debug_breadcrumb_with_elapsed_and_size(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The DEBUG breadcrumb names elapsed + bytes but NOT the URL."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG, logger="image_edit.fal_ai_vendor_caller"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    messages = [r.getMessage() for r in caplog.records]
    assert any(
        "download phase complete" in m for m in messages
    ), f"expected DEBUG breadcrumb after successful download; saw: {messages!r}"
    # ``elapsed`` and ``downloaded_bytes`` are the two operationally
    # useful values; assert both surface so a future regression that
    # silently dropped the breadcrumb's only useful payload fails
    # loudly.
    assert any("elapsed=" in m for m in messages)
    assert any("downloaded_bytes=" in m for m in messages)


# ---------------------------------------------------------------------------
# Timeout ceiling
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_clips_timeout_to_phase_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A generous end-to-end budget is clipped to the 3s download ceiling."""
    observed_timeouts: list[httpx.Timeout] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        return _ok_response()

    transport = httpx.MockTransport(handler)

    def _capturing_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        timeout = kwargs.get("timeout")
        if timeout is not None:
            observed_timeouts.append(httpx.Timeout(timeout))
        kwargs["transport"] = transport
        return _REAL_HTTPX_CLIENT(*args, **kwargs)

    monkeypatch.setattr(
        "image_edit.fal_ai_vendor_caller.httpx.Client", _capturing_factory
    )

    caller = _make_caller()
    # 25s is the end-to-end budget; the download step must clip to ≤3s.
    caller._download_image_bytes(_FAKE_CDN_URL, timeout=25.0)

    assert observed_timeouts, "adapter did not pass a timeout to httpx.Client"
    timeout = observed_timeouts[0]
    assert (
        timeout.read is not None
        and timeout.read <= _FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS
    )


@pytest.mark.unit
def test_download_preserves_tight_budget_below_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tight retry-loop budget (<3s) wins over the phase ceiling."""
    observed_timeouts: list[float] = []

    transport = httpx.MockTransport(lambda _r: _ok_response())

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
    caller._download_image_bytes(_FAKE_CDN_URL, timeout=0.75)

    assert observed_timeouts == [0.75], (
        "adapter should pass tight budgets through unchanged; "
        f"saw {observed_timeouts!r}"
    )


@pytest.mark.unit
def test_download_rejects_zero_or_negative_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``timeout <= 0`` raises VendorError before any HTTP attempt."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: pytest.fail("no HTTP call should be made"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="exhausted"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=0.0)

    with pytest.raises(VendorError, match="exhausted"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=-0.25)

    assert captured == [], "no request should have been sent"


# ---------------------------------------------------------------------------
# Transient (retryable) failures → VendorError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_download_5xx_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """CDN faults are transient — translate to ``VendorError``."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="cdn fault details"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match=f"HTTP {status}"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)


@pytest.mark.unit
def test_download_429_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CDN rate-limit 429 is transient — outer loop will back off + retry."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(429, text="rate limited by cdn"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="HTTP 429"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)


@pytest.mark.unit
def test_download_timeout_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An ``httpx.TimeoutException`` translates to ``VendorError``."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("simulated cdn read timeout")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="timed out"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)


@pytest.mark.unit
def test_download_network_error_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``httpx.ConnectError`` (and siblings) translate to ``VendorError``."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated cdn DNS failure")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="transport error"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)


# ---------------------------------------------------------------------------
# Permanent (non-retryable) failures → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("status", [400, 401, 403, 404, 410, 422])
def test_download_4xx_excluding_429_raises_value_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """CDN client errors are non-retryable — must short-circuit the loop."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="cdn client error details"),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match=f"HTTP {status}"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)


@pytest.mark.unit
def test_download_unexpected_redirect_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 3xx is unexpected on a CDN GET — non-retryable contract violation."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(301, headers={"Location": "https://nope"}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="unexpected HTTP 301"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)


@pytest.mark.unit
def test_download_empty_body_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 with empty body cannot be a valid image — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, content=b""),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="empty body"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)


# ---------------------------------------------------------------------------
# Logging / redaction discipline
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_log_never_contains_api_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No log record at any level may carry the API key literal."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    for record in caplog.records:
        message = record.getMessage()
        assert _TEST_API_KEY not in message, (
            "API key value leaked into a log record — Seed Contract "
            "forbids embedding FAL_API_KEY in any log statement."
        )
        for arg in record.args or ():
            assert _TEST_API_KEY not in str(
                arg
            ), "API key value leaked into a log record's args."


@pytest.mark.unit
def test_download_log_never_contains_cdn_url(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The CDN URL must not reach any log record *the adapter emits*.

    Scoped to the adapter's own logger (``image_edit.fal_ai_vendor_caller``)
    because the Seed Contract's redaction discipline binds the adapter's
    own log statements, not the underlying transport's. ``httpx`` itself
    emits an INFO-level access log line that necessarily contains the
    request URL — that is the transport's own observability, configured
    independently of this adapter, and operators who want to silence it
    do so at the ``logging.getLogger("httpx")`` level. The contract this
    file defends is "FalAiVendorCaller's own breadcrumb never names the
    URL", and that is exactly what we assert.
    """
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG, logger="image_edit.fal_ai_vendor_caller"):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    adapter_records = [
        r for r in caplog.records if r.name == "image_edit.fal_ai_vendor_caller"
    ]
    assert adapter_records, (
        "expected at least one DEBUG breadcrumb from the adapter logger; "
        "see test_download_emits_debug_breadcrumb_with_elapsed_and_size"
    )
    for record in adapter_records:
        message = record.getMessage()
        assert _FAKE_CDN_URL not in message, (
            "CDN URL leaked into an adapter log record — Seed Contract "
            "forbids the adapter from logging fal storage URLs."
        )
        for arg in record.args or ():
            assert _FAKE_CDN_URL not in str(arg)


@pytest.mark.unit
def test_download_log_never_contains_response_headers(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """CDN response headers (request IDs, edge nodes) must not leak."""
    canary = "LEAK-CANARY-CDN-NODE-ID"
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    for record in caplog.records:
        assert canary not in record.getMessage()
        for arg in record.args or ():
            assert canary not in str(arg)


@pytest.mark.unit
def test_download_error_messages_do_not_embed_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exception messages on every classified branch must not echo the key."""
    handlers: list[tuple[str, Callable[[httpx.Request], httpx.Response]]] = [
        ("500", lambda _r: httpx.Response(500, text="cdn server error")),
        ("429", lambda _r: httpx.Response(429, text="rate limited")),
        ("404", lambda _r: httpx.Response(404, text="not found")),
        ("403", lambda _r: httpx.Response(403, text="signed url expired")),
        ("301", lambda _r: httpx.Response(301)),
        ("empty", lambda _r: httpx.Response(200, content=b"")),
    ]
    caller = _make_caller()
    for tag, handler in handlers:
        _install_mock_transport(monkeypatch, handler)
        try:
            caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)
        except (VendorError, ValueError) as exc:
            assert _TEST_API_KEY not in str(
                exc
            ), f"{tag} branch leaked API key into exception message"
        else:
            pytest.fail(f"{tag} branch did not raise as expected")


@pytest.mark.unit
def test_download_error_messages_do_not_embed_cdn_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exception messages must not echo the CDN URL either."""
    handlers: list[tuple[str, Callable[[httpx.Request], httpx.Response]]] = [
        ("500", lambda _r: httpx.Response(500, text="cdn server error")),
        ("429", lambda _r: httpx.Response(429, text="rate limited")),
        ("404", lambda _r: httpx.Response(404, text="not found")),
        ("403", lambda _r: httpx.Response(403, text="signed url expired")),
        ("301", lambda _r: httpx.Response(301)),
        ("empty", lambda _r: httpx.Response(200, content=b"")),
    ]
    caller = _make_caller()
    for tag, handler in handlers:
        _install_mock_transport(monkeypatch, handler)
        try:
            caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)
        except (VendorError, ValueError) as exc:
            assert _FAKE_CDN_URL not in str(
                exc
            ), f"{tag} branch leaked CDN URL into exception message"
        else:
            pytest.fail(f"{tag} branch did not raise as expected")


# ---------------------------------------------------------------------------
# Bytes-only allowlist: no response metadata escapes the layer
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_returns_only_body_no_headers_or_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Headers and metadata in the response must not influence the return."""
    canary_bytes = b"BODY-ONLY-CANARY-PAYLOAD"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=canary_bytes,
            headers={
                # Headers that, if they bled into the return, would
                # change the result. The adapter must return ONLY the
                # body bytes — every other attribute of the Response
                # is discarded.
                "Content-Type": "image/png",
                "x-fal-request-id": "must-not-influence-return",
                "x-fal-cdn-node": "must-not-influence-return",
                "etag": "must-not-influence-return",
            },
        )

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    result = caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    # Exact-equality on the body bytes proves no header / metadata
    # was concatenated, prepended, or otherwise mixed into the return.
    assert result == canary_bytes
    # And specifically — none of the header values should appear in
    # the returned bytes (defence-in-depth in case the previous
    # assertion regressed to a `startswith` check).
    assert b"must-not-influence-return" not in result
    assert b"image/png" not in result


# ---------------------------------------------------------------------------
# Thread safety: stateless after __init__
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_is_stateless_across_invocations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each call routes through a fresh httpx.Client — no shared state."""
    call_count = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        # Vary the body per call so a regression that cached the
        # first response would surface as repeated identical bytes.
        return httpx.Response(
            200,
            content=f"call-{call_count['n']}-payload".encode("ascii"),
        )

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    first = caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)
    second = caller._download_image_bytes(_FAKE_CDN_URL, timeout=3.0)

    assert first != second, "each call must see the fresh mock response"
    assert call_count["n"] == 2
    # ``FalAiVendorCaller`` uses ``__slots__`` to forbid attribute
    # injection — no mutable per-call state can be stashed there.
    assert caller.__slots__ == ("_api_key", "_authorization_header")
