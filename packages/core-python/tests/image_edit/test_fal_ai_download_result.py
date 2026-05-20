"""Tests for the `_download_result` semantic alias (Sub-AC 2.3).

# What this file pins down

Sub-AC 2.3 ships :meth:`FalAiVendorCaller._download_result` as a
domain-vocabulary alias for the wire-vocabulary :meth:`_download_image_bytes`
already shipped by sibling AC 5. This file pins:

  * The alias **exists** as a public-ish method on the class with the
    exact signature Sub-AC 2.3 calls out (``_download_result(result_url) -> bytes``).
  * The alias **GETs the result URL** via the real ``httpx`` transport
    layer and returns raw image bytes (binary content retrieval
    verified through ``httpx.MockTransport``).
  * The alias **inherits the error-classification contract** from the
    underlying implementation — transient (5xx, 429, timeout, network
    error) ⇒ :class:`VendorError`, permanent (4xx, 3xx, empty body)
    ⇒ :class:`ValueError`. This is what the outer ``edit_image``
    retry loop depends on, so the alias is unsafe to ship without
    direct coverage on each branch.
  * The alias is **referentially equivalent** to ``_download_image_bytes``
    — they call the same code path. A regression that silently forked
    the two methods would surface in :func:`test_alias_delegates_to_download_image_bytes`.

# Why a dedicated test file (rather than appending to test_fal_ai_download_step.py)?

The AC 5 file (``test_fal_ai_download_step.py``) is the canonical
test surface for the underlying ``_download_image_bytes`` method and
already carries 31 passing tests. Co-locating Sub-AC 2.3's alias
coverage in that file would blur the AC boundary and make a future
refactor that splits the alias out harder to review. Mirroring the
sibling-file pattern (``test_fal_ai_request_builder.py`` vs
``test_fal_ai_response_parser.py`` vs ``test_fal_ai_edit_step.py``)
keeps each AC's tests independently locatable.

# Why transport-level mocks?

The Seed Contract forbids conditional branches for mocks in
production code, so this file exercises the real ``httpx.Client``
against an ``httpx.MockTransport`` — exactly the primitive ``respx``
and ``pytest-httpx`` are built on top of. ``monkeypatch.setattr``
swaps the module-resident ``httpx.Client`` symbol for a thin factory
that injects the mock transport; the adapter source is unchanged.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any, Callable, Final

import httpx
import pytest

from image_edit.fal_ai_vendor_caller import (
    _FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS,
    FalAiVendorCaller,
)
from image_edit.vendor_client import VendorError

# A clearly-fake API key. The alias delegates to a method that never
# sends the key on the CDN GET (signed URL is self-authenticating).
# We assert the literal value cannot reach any captured log record or
# exception message regardless.
_TEST_API_KEY: Final[str] = "fake-id-99999:fake-secret-alias-canary-22222"

# Distinct URL from the AC 5 file's ``_FAKE_CDN_URL`` so a regression
# that started reusing fixtures across files would surface immediately.
_FAKE_RESULT_URL: Final[str] = (
    "https://v3.fal.media/files/zebra/download-result-alias-canary.png"
)

# Distinct payload from the AC 5 file. Bytes are opaque to the
# adapter; the leading PNG magic is purely cosmetic so failing
# diffs print something legible.
_FAKE_IMAGE_BYTES: Final[bytes] = (
    b"\x89PNG\r\n\x1a\nDOWNLOAD-RESULT-ALIAS-CANARY-PAYLOAD"
)


# ---------------------------------------------------------------------------
# Helpers (mirror the AC 5 helpers so reviewers can A/B-compare the files)
# ---------------------------------------------------------------------------


# Capture the real ``httpx.Client`` constructor at module import — before
# any test monkeypatches the symbol — so the mock factory can build a
# real Client configured with ``MockTransport`` without recursing.
_REAL_HTTPX_CLIENT: Final[type[httpx.Client]] = httpx.Client


def _install_mock_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.Request]:
    """Replace ``httpx.Client`` inside the adapter module with a mock."""
    captured: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        request.read()
        captured.append(request)
        return handler(request)

    transport = httpx.MockTransport(recording_handler)

    def _client_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return _REAL_HTTPX_CLIENT(*args, **kwargs)

    monkeypatch.setattr(
        "image_edit.fal_ai_vendor_caller.httpx.Client",
        _client_factory,
    )
    return captured


def _make_caller() -> FalAiVendorCaller:
    """Build a caller with a recognisable fake key."""
    return FalAiVendorCaller(api_key=_TEST_API_KEY)


def _ok_response() -> httpx.Response:
    """Minimal well-formed 200 response delivering image bytes."""
    return httpx.Response(
        status_code=200,
        content=_FAKE_IMAGE_BYTES,
        headers={
            "Content-Type": "image/png",
            "x-fal-cdn-node": "ALIAS-LEAK-CANARY-CDN-NODE",
        },
    )


# ---------------------------------------------------------------------------
# Signature + alias identity
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_result_exists_with_documented_signature() -> None:
    """``_download_result(result_url, timeout) -> bytes`` is the documented shape."""
    method = FalAiVendorCaller._download_result
    sig = inspect.signature(method)
    # bound-method params on the class read as (self, result_url, timeout)
    params = list(sig.parameters.values())
    assert [p.name for p in params] == ["self", "result_url", "timeout"], (
        f"Sub-AC 2.3 fixes the parameter names; saw {[p.name for p in params]!r}"
    )
    assert sig.return_annotation is bytes, (
        "Sub-AC 2.3 fixes the bytes-only return contract; "
        f"saw return annotation {sig.return_annotation!r}"
    )


@pytest.mark.unit
def test_download_result_is_a_method_on_the_class() -> None:
    """The alias must live on the class, not as a free function."""
    # ``__qualname__`` distinguishes a class method from a module-scope
    # function: the former carries the dotted class name as a prefix.
    assert (
        FalAiVendorCaller._download_result.__qualname__
        == "FalAiVendorCaller._download_result"
    )


@pytest.mark.unit
def test_alias_delegates_to_download_image_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The alias and the underlying method return identical bytes.

    Equivalence-under-identical-inputs is the contract Sub-AC 2.3 ships
    — a future refactor that forked the two code paths would silently
    drift the alias's error behaviour relative to the canonical
    implementation and break the outer retry loop.
    """
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    via_alias = caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    # Re-install a fresh mock so the second call sees the same response
    # (the recording handler captures both invocations into the same list).
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())
    via_canonical = caller._download_image_bytes(_FAKE_RESULT_URL, timeout=3.0)

    assert via_alias == via_canonical == _FAKE_IMAGE_BYTES


# ---------------------------------------------------------------------------
# Happy path: binary content retrieval
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_result_returns_raw_image_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful 200 yields exactly the response body bytes."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    result = caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    # Exact-equality on the raw bytes proves no decoding, no
    # re-encoding, no size cap, and no header concatenation.
    assert result == _FAKE_IMAGE_BYTES


@pytest.mark.unit
def test_download_result_return_type_is_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The runtime return type matches the static ``bytes`` annotation."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    result = caller._download_result(_FAKE_RESULT_URL, timeout=3.0)
    assert isinstance(result, bytes)
    # Non-empty: zero-byte responses are rejected up-front (see
    # ``test_download_result_empty_body_raises_value_error``).
    assert len(result) > 0


@pytest.mark.unit
def test_download_result_targets_provided_url_as_get(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The alias GETs the exact URL handed in — no rewriting, no other verb."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    assert len(captured) == 1
    request = captured[0]
    assert str(request.url) == _FAKE_RESULT_URL
    assert request.method == "GET"


@pytest.mark.unit
def test_download_result_returns_arbitrary_binary_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The alias is opaque to body shape — every byte returned verbatim.

    Pins the "binary content retrieval" half of Sub-AC 2.3's contract
    with a non-ASCII payload that includes null bytes and high-bit
    bytes, ensuring a regression that started ``str``-decoding the
    body (e.g. ``response.text``) would lose information here.
    """
    # 256-byte payload covering every possible byte value so a
    # codec-mediated truncation (UTF-8, latin-1, etc.) would corrupt at
    # least one byte and fail the equality below.
    arbitrary = bytes(range(256))
    _install_mock_transport(
        monkeypatch, lambda _r: httpx.Response(200, content=arbitrary)
    )

    caller = _make_caller()
    result = caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    assert result == arbitrary
    assert len(result) == 256


# ---------------------------------------------------------------------------
# Error handling (Sub-AC 2.3 explicitly calls this out)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_download_result_5xx_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """5xx is transient — translate to ``VendorError`` via the alias too."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="cdn server fault"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match=f"HTTP {status}"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)


@pytest.mark.unit
def test_download_result_429_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """429 is transient — the outer retry loop owns the back-off."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(429, text="cdn rate limited"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="HTTP 429"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)


@pytest.mark.unit
def test_download_result_timeout_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``httpx.TimeoutException`` ⇒ ``VendorError`` via the alias too."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("simulated alias-path read timeout")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="timed out"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)


@pytest.mark.unit
def test_download_result_network_error_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transport-level errors ⇒ ``VendorError`` (transient)."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated alias-path DNS failure")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="transport error"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)


@pytest.mark.unit
@pytest.mark.parametrize("status", [400, 401, 403, 404, 410, 422])
def test_download_result_4xx_excluding_429_raises_value_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """4xx (excluding 429) is non-retryable — short-circuit the loop."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="cdn client error"),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match=f"HTTP {status}"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)


@pytest.mark.unit
def test_download_result_unexpected_redirect_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 3xx on a CDN GET is a contract violation — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(301, headers={"Location": "https://nope"}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="unexpected HTTP 301"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)


@pytest.mark.unit
def test_download_result_empty_body_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 with zero-byte body cannot be a valid image — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, content=b""),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="empty body"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)


@pytest.mark.unit
def test_download_result_rejects_zero_or_negative_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``timeout <= 0`` raises ``VendorError`` before any HTTP attempt."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: pytest.fail("no HTTP call should be made on exhausted budget"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="exhausted"):
        caller._download_result(_FAKE_RESULT_URL, timeout=0.0)

    with pytest.raises(VendorError, match="exhausted"):
        caller._download_result(_FAKE_RESULT_URL, timeout=-1.5)

    assert captured == [], "no request should have been sent on exhausted budget"


# ---------------------------------------------------------------------------
# Timeout discipline (the alias inherits the 3s phase ceiling)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_result_clips_timeout_to_phase_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A generous end-to-end budget is clipped to the 3s download ceiling."""
    observed_timeouts: list[httpx.Timeout] = []

    transport = httpx.MockTransport(lambda _r: _ok_response())

    def _capturing_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        t = kwargs.get("timeout")
        if t is not None:
            observed_timeouts.append(httpx.Timeout(t))
        kwargs["transport"] = transport
        return _REAL_HTTPX_CLIENT(*args, **kwargs)

    monkeypatch.setattr(
        "image_edit.fal_ai_vendor_caller.httpx.Client", _capturing_factory
    )

    caller = _make_caller()
    caller._download_result(_FAKE_RESULT_URL, timeout=25.0)

    assert observed_timeouts, "adapter did not pass a timeout to httpx.Client"
    timeout = observed_timeouts[0]
    assert (
        timeout.read is not None
        and timeout.read <= _FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS
    )


@pytest.mark.unit
def test_download_result_preserves_tight_budget_below_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retry-loop deadline tighter than 3s wins over the phase ceiling."""
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
    caller._download_result(_FAKE_RESULT_URL, timeout=0.5)

    assert observed_timeouts == [0.5], (
        "alias must pass tight budgets through unchanged; "
        f"saw {observed_timeouts!r}"
    )


# ---------------------------------------------------------------------------
# Redaction discipline (the alias inherits AC 5's posture)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_result_does_not_send_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The CDN GET must not carry the FAL API key (signed URL ⇒ no auth)."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    request = captured[0]
    assert "Authorization" not in request.headers
    for value in request.headers.values():
        assert _TEST_API_KEY not in value


@pytest.mark.unit
def test_download_result_log_never_contains_api_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No log record at any level may carry the API key literal."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    for record in caplog.records:
        assert _TEST_API_KEY not in record.getMessage()
        for arg in record.args or ():
            assert _TEST_API_KEY not in str(arg)


@pytest.mark.unit
def test_download_result_log_never_contains_result_url(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The result URL must not reach any adapter-emitted log record.

    Scoped to the adapter's own logger because the Seed Contract binds
    the adapter's own log statements, not the underlying transport's.
    """
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG, logger="image_edit.fal_ai_vendor_caller"):
        caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    adapter_records = [
        r for r in caplog.records if r.name == "image_edit.fal_ai_vendor_caller"
    ]
    assert adapter_records, "expected the AC 5 DEBUG breadcrumb to fire"
    for record in adapter_records:
        assert _FAKE_RESULT_URL not in record.getMessage()
        for arg in record.args or ():
            assert _FAKE_RESULT_URL not in str(arg)


@pytest.mark.unit
def test_download_result_error_messages_redact_url_and_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exception text on every classified branch is free of secrets."""
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
            caller._download_result(_FAKE_RESULT_URL, timeout=3.0)
        except (VendorError, ValueError) as exc:
            message = str(exc)
            assert _TEST_API_KEY not in message, (
                f"{tag} branch leaked API key into exception message"
            )
            assert _FAKE_RESULT_URL not in message, (
                f"{tag} branch leaked result URL into exception message"
            )
        else:
            pytest.fail(f"{tag} branch did not raise as expected")


# ---------------------------------------------------------------------------
# Bytes-only allowlist: no response metadata escapes via the alias
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_download_result_returns_only_body_no_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Headers and metadata in the response must not influence the return."""
    canary = b"ALIAS-BODY-ONLY-CANARY"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=canary,
            headers={
                "Content-Type": "image/png",
                "x-fal-request-id": "must-not-influence-alias-return",
                "etag": "must-not-influence-alias-return",
            },
        )

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    result = caller._download_result(_FAKE_RESULT_URL, timeout=3.0)

    assert result == canary
    assert b"must-not-influence-alias-return" not in result
    assert b"image/png" not in result
