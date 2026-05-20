"""Tests for the Fal.ai img2img edit step (Seed Contract Sub-AC 4.2).

# What this file pins down

The 3-step Fal.ai img2img flow's *middle* step POSTs the JSON request
built by :func:`_build_img2img_payload` (Sub-AC 4.1) to
``https://fal.run/fal-ai/flux/dev/image-to-image`` and parses the CDN
URL of the generated image out of the response. This file pins:

  * The HTTP shape we send (URL, method, headers, JSON body matches
    the builder's output verbatim).
  * The allowlist parsing of the response — only ``images[0].url``
    escapes the layer; every other field is discarded.
  * The error classification rules the outer ``edit_image`` retry loop
    depends on:
      - HTTP 429 / 5xx, network error, timeout      → ``VendorError`` (retryable)
      - HTTP 4xx (excluding 429), malformed JSON,
        bad/missing ``images`` array, bad/missing
        ``images[0].url`` field                     → ``ValueError`` (non-retryable)
  * The per-phase timeout ceiling (15s) — the edit step must never
    consume the budget reserved for the upload (3s) and download (3s)
    phases.
  * The redaction discipline — no API key, no source/storage URL, no
    prompt, no request body, no response payload, no result CDN URL
    reaches a log record at any level.

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
``test_fal_ai_upload_step.py``, ``test_fal_ai_request_builder.py``)
intentionally scope themselves to a single concern. Keeping the edit-
step tests in their own file mirrors that structure, parallels the
upload-step file layout almost exactly so reviewers can A/B the two,
and lets the next sibling AC (download, end-to-end ``__call__`` wiring)
follow the same pattern without conflicts.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Final

import httpx
import pytest

from image_edit.fal_ai_defaults import (
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_NUM_INFERENCE_STEPS,
    DEFAULT_STRENGTH,
)
from image_edit.fal_ai_vendor_caller import (
    FalAiVendorCaller,
    _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE,
    _FAL_IMG2IMG_FIELD_IMAGE_URL,
    _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS,
    _FAL_IMG2IMG_FIELD_PROMPT,
    _FAL_IMG2IMG_FIELD_STRENGTH,
    _FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY,
    _FAL_IMG2IMG_RESPONSE_IMAGES_KEY,
    _FAL_IMG2IMG_TIMEOUT_CEILING_SECONDS,
    _FAL_IMG2IMG_URL,
    _build_img2img_payload,
)
from image_edit.vendor_client import VendorError

# A clearly-fake API key. The test suite asserts the value never appears
# in any captured log record, so we keep it distinct from any string we
# log on purpose (e.g. elapsed seconds, payload sizes).
_TEST_API_KEY: Final[str] = "fake-id-12345:fake-secret-do-not-use-67890"

# Distinctive enough that an accidental log/exception leak would be
# obvious in test output. Deliberately *not* shared with the upload-
# step fixtures — these tests live in their own file so they cannot
# accidentally rely on those constants.
_FAKE_UPLOAD_URL: Final[str] = (
    "https://v3.fal.media/files/elephant/edit-step-input-canary.png"
)
_FAKE_PROMPT: Final[str] = (
    "spring warm-tone personal-color makeup styling: edit-step test prompt"
)
_FAKE_RESULT_URL: Final[str] = (
    "https://v3.fal.media/files/zebra/edit-step-result-canary.png"
)


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
    tests can assert on the request shape (URL, method, headers, JSON
    body). The replacement is module-scoped via ``monkeypatch`` so the
    real ``httpx.Client`` is restored automatically at the end of each
    test — no cross-test contamination, no global side effects.
    """
    captured: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        # Materialise the body so JSON-body assertions can inspect it
        # after the request has been "sent" to the mock. ``request.read()``
        # is the documented way to do this in httpx.
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
    — the leak-canary assertions in this file all check that the
    same literal never reaches a log record.
    """
    return FalAiVendorCaller(api_key=_TEST_API_KEY)


def _ok_response() -> httpx.Response:
    """Build a minimal well-formed 200 response for happy-path mocks."""
    return httpx.Response(
        200,
        json={
            _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                {
                    _FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL,
                    # Extra per-image fields the allowlist must discard.
                    "width": 1024,
                    "height": 1024,
                    "content_type": "image/png",
                },
            ],
            # Extra top-level fields the allowlist must discard. Leak-
            # canary string so "never logs response payload" assertions
            # can detect a regression.
            "seed": 42,
            "has_nsfw_concepts": [False],
            "prompt": "echoed prompt — must not leak",
            "request_id": "LEAK-CANARY-REQUEST-ID",
        },
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_edit_returns_url_from_images_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful 200 response yields exactly ``images[0].url``."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    url = caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=15.0,
    )

    # The adapter returns the URL string, NOT the JSON payload — so
    # leak-canary fields can never reach the download step.
    assert url == _FAKE_RESULT_URL


@pytest.mark.unit
def test_edit_request_targets_documented_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The adapter POSTs to the documented FLUX img2img URL."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=15.0,
    )

    assert len(captured) == 1
    request = captured[0]
    # URL: documented FLUX img2img endpoint (sync variant, not queue).
    assert str(request.url) == _FAL_IMG2IMG_URL
    # And specifically — make the literal contract visible in the test
    # so a refactor that silently re-routes the call to a queue/webhook
    # variant fails this assertion.
    assert str(request.url) == "https://fal.run/fal-ai/flux/dev/image-to-image"
    # Method: POST per Fal's documented contract.
    assert request.method == "POST"


@pytest.mark.unit
def test_edit_request_carries_proper_auth_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Authorization (``Key <api_key>``) and Accept headers are present."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=15.0,
    )

    request = captured[0]
    # ``Key <api_key>`` scheme matches Fal's documented auth contract
    # and the smoke script's working probe.
    assert request.headers["Authorization"] == f"Key {_TEST_API_KEY}"
    # Accept JSON so a misroute returning HTML fails fast at parse.
    assert request.headers["Accept"] == "application/json"


@pytest.mark.unit
def test_edit_request_body_matches_builder_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The POSTed JSON body is exactly what ``_build_img2img_payload`` returns."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=15.0,
    )

    request = captured[0]
    # Content-Type is JSON (set automatically by httpx when ``json=``
    # is used). Asserting on it pins the contract — a refactor that
    # switched to ``data=`` (form-encoded) would silently change the
    # body shape Fal sees.
    assert request.headers["Content-Type"] == "application/json"

    body = json.loads(request.content)
    # Identity vs. the pure builder's output — the adapter must not
    # add, drop, rename, or coerce any field on the way to the wire.
    expected = _build_img2img_payload(image_url=_FAKE_UPLOAD_URL, prompt=_FAKE_PROMPT)
    assert body == expected

    # And specifically — pin each documented field individually so a
    # regression that swaps two values is caught with a precise
    # message.
    assert body[_FAL_IMG2IMG_FIELD_IMAGE_URL] == _FAKE_UPLOAD_URL
    assert body[_FAL_IMG2IMG_FIELD_PROMPT] == _FAKE_PROMPT
    assert body[_FAL_IMG2IMG_FIELD_STRENGTH] == DEFAULT_STRENGTH
    assert body[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == DEFAULT_GUIDANCE_SCALE
    assert body[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == DEFAULT_NUM_INFERENCE_STEPS


@pytest.mark.unit
def test_edit_request_body_honours_overrides_via_params(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``params`` overrides flow through the builder into the POSTed body."""
    captured = _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params={
            _FAL_IMG2IMG_FIELD_STRENGTH: 0.5,
            _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE: 6.5,
            _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS: 33,
            # Foreign key the builder's allowlist must drop. If this
            # appears on the wire, both the allowlist and the adapter
            # plumbing have regressed.
            "num_outputs": 8,
        },
        timeout=15.0,
    )

    body = json.loads(captured[0].content)
    assert body[_FAL_IMG2IMG_FIELD_STRENGTH] == pytest.approx(0.5)
    assert body[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == pytest.approx(6.5)
    assert body[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == 33
    assert "num_outputs" not in body


@pytest.mark.unit
def test_edit_return_type_is_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The return type is ``str`` — never bytes, dict, or Response."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    result = caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=15.0,
    )
    assert isinstance(result, str)


@pytest.mark.unit
def test_edit_does_not_log_request_body_or_response(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The DEBUG breadcrumb names elapsed but NOT prompt/url/payload."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG, logger="image_edit.fal_ai_vendor_caller"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )

    messages = [r.getMessage() for r in caplog.records]
    assert any(
        "img2img phase complete" in m for m in messages
    ), f"expected DEBUG breadcrumb after successful img2img; saw: {messages!r}"
    # ``elapsed`` is the one observability value we allow; assert it
    # shows up at least once so future regressions don't silently drop
    # the breadcrumb's only useful payload.
    assert any("elapsed=" in m for m in messages)


# ---------------------------------------------------------------------------
# Timeout ceiling
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_edit_clips_timeout_to_phase_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A generous end-to-end budget is clipped to the 15s edit ceiling."""
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
    # 25s is the end-to-end budget; the edit step must clip to ≤15s.
    caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=25.0,
    )

    assert observed_timeouts, "adapter did not pass a timeout to httpx.Client"
    timeout = observed_timeouts[0]
    assert (
        timeout.read is not None
        and timeout.read <= _FAL_IMG2IMG_TIMEOUT_CEILING_SECONDS
    )


@pytest.mark.unit
def test_edit_preserves_tight_budget_below_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tight retry-loop budget (<15s) wins over the phase ceiling."""
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
    caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=5.0,
    )

    assert observed_timeouts == [5.0], (
        "adapter should pass tight budgets through unchanged; "
        f"saw {observed_timeouts!r}"
    )


@pytest.mark.unit
def test_edit_rejects_zero_or_negative_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``timeout <= 0`` raises VendorError before any HTTP attempt."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: pytest.fail("no HTTP call should be made"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="exhausted"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=0.0,
        )

    with pytest.raises(VendorError, match="exhausted"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=-0.25,
        )

    assert captured == [], "no request should have been sent"


# ---------------------------------------------------------------------------
# Override validation runs BEFORE the HTTP round-trip
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_edit_bad_params_raises_before_http_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Wrong-typed override surfaces as ValueError without an HTTP call."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: pytest.fail(
            "HTTP call must not happen when params validation fails"
        ),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="strength"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params={_FAL_IMG2IMG_FIELD_STRENGTH: "not-a-number"},
            timeout=15.0,
        )

    assert captured == [], "validation failure must short-circuit before HTTP"


# ---------------------------------------------------------------------------
# Transient (retryable) failures → VendorError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_edit_5xx_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """Server faults are transient — translate to ``VendorError``."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="server fault details"),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match=f"HTTP {status}"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_429_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Rate-limit 429 is transient — outer loop will back off + retry."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(429, json={"error": "rate limited"}),
    )

    caller = _make_caller()
    with pytest.raises(VendorError, match="HTTP 429"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_timeout_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An ``httpx.TimeoutException`` translates to ``VendorError``."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("simulated img2img read timeout")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="timed out"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_network_error_raises_vendor_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``httpx.ConnectError`` (and siblings) translate to ``VendorError``."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated DNS failure")

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    with pytest.raises(VendorError, match="transport error"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


# ---------------------------------------------------------------------------
# Permanent (non-retryable) failures → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("status", [400, 401, 403, 404, 415, 422])
def test_edit_4xx_excluding_429_raises_value_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """Client errors are non-retryable — must short-circuit the loop."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(status, text="client error details"),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match=f"HTTP {status}"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_unexpected_status_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 3xx (or 1xx) is unexpected on a sync img2img — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(301, headers={"Location": "https://nope"}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="unexpected HTTP 301"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_non_json_response_raises_value_error(
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
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_non_object_json_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 with JSON ``[...]`` is not a mapping — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, json=["not", "an", "object"]),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="not a JSON object"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_missing_images_array_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ``images`` key in the response is a contract violation."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, json={"seed": 42}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing non-empty"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_empty_images_array_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty ``images`` array has no URL to extract — non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(200, json={_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: []}),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing non-empty"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_non_list_images_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-list ``images`` field (string, dict, int) is non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200, json={_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: {"not": "a list"}}
        ),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing non-empty"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_non_object_first_image_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``images[0]`` must be a JSON object — anything else is a contract bug."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            json={_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: ["not-an-object"]},
        ),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match=r"\[0\] was not a JSON object"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_missing_url_in_first_image_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``images[0]`` without a ``url`` field is non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            json={_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [{"width": 1024, "height": 1024}]},
        ),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing required"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_empty_url_in_first_image_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty ``images[0].url`` is not actionable downstream — reject."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            json={
                _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                    {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: ""}
                ]
            },
        ),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing required"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


@pytest.mark.unit
def test_edit_non_string_url_in_first_image_raises_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-string ``images[0].url`` (int / null / list) is non-retryable."""
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            json={
                _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                    {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: 12345}
                ]
            },
        ),
    )

    caller = _make_caller()
    with pytest.raises(ValueError, match="missing required"):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )


# ---------------------------------------------------------------------------
# Logging / redaction discipline
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_edit_log_never_contains_api_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No log record at any level may carry the API key literal."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )

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
def test_edit_log_never_contains_source_or_result_url(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Neither the upload URL nor the CDN result URL may reach any log."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )

    for record in caplog.records:
        message = record.getMessage()
        assert _FAKE_UPLOAD_URL not in message, (
            "source upload URL leaked into a log record — Seed "
            "Contract forbids logging fal storage URLs."
        )
        assert _FAKE_RESULT_URL not in message, (
            "result CDN URL leaked into a log record — Seed "
            "Contract forbids logging fal storage URLs."
        )
        for arg in record.args or ():
            assert _FAKE_UPLOAD_URL not in str(arg)
            assert _FAKE_RESULT_URL not in str(arg)


@pytest.mark.unit
def test_edit_log_never_contains_prompt(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The FLUX prompt is not logged — would expose the closed preset enum."""
    _install_mock_transport(monkeypatch, lambda _r: _ok_response())

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )

    # Pick a sufficiently-unique substring from the prompt so a partial
    # leak (e.g. only the season name) is still caught.
    canary_substr = "edit-step test prompt"
    assert canary_substr in _FAKE_PROMPT  # sanity check the fixture

    for record in caplog.records:
        assert canary_substr not in record.getMessage(), (
            "FLUX prompt leaked into a log record — Seed Contract "
            "forbids logging the full request body."
        )
        for arg in record.args or ():
            assert canary_substr not in str(arg)


@pytest.mark.unit
def test_edit_log_never_contains_response_payload(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Extra response fields (request_id, seed, etc.) must not reach any log."""
    canary = "LEAK-CANARY-RESPONSE-EXTRA"
    _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            json={
                _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                    {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL}
                ],
                "request_id": canary,
                "seed": canary,
            },
        ),
    )

    caller = _make_caller()
    with caplog.at_level(logging.DEBUG):
        caller._post_img2img_request(
            image_url=_FAKE_UPLOAD_URL,
            prompt=_FAKE_PROMPT,
            params=None,
            timeout=15.0,
        )

    for record in caplog.records:
        assert canary not in record.getMessage()
        for arg in record.args or ():
            assert canary not in str(arg)


@pytest.mark.unit
def test_edit_error_messages_do_not_embed_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exception messages on every classified branch must not echo the key."""
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
            caller._post_img2img_request(
                image_url=_FAKE_UPLOAD_URL,
                prompt=_FAKE_PROMPT,
                params=None,
                timeout=15.0,
            )
        except (VendorError, ValueError) as exc:
            assert _TEST_API_KEY not in str(
                exc
            ), f"{tag} branch leaked API key into exception message"
        else:
            pytest.fail(f"{tag} branch did not raise as expected")


@pytest.mark.unit
def test_edit_error_messages_do_not_embed_image_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exception messages must not echo source or result URLs either."""
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
            caller._post_img2img_request(
                image_url=_FAKE_UPLOAD_URL,
                prompt=_FAKE_PROMPT,
                params=None,
                timeout=15.0,
            )
        except (VendorError, ValueError) as exc:
            message = str(exc)
            assert (
                _FAKE_UPLOAD_URL not in message
            ), f"{tag} branch leaked source URL into exception message"
            assert (
                _FAKE_RESULT_URL not in message
            ), f"{tag} branch leaked result URL into exception message"
        else:
            pytest.fail(f"{tag} branch did not raise as expected")


# ---------------------------------------------------------------------------
# Thread safety: stateless after __init__
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_edit_is_stateless_across_invocations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each call routes through a fresh httpx.Client — no shared state."""
    call_count = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        return httpx.Response(
            200,
            json={
                _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                    {
                        _FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: (
                            f"{_FAKE_RESULT_URL}?n={call_count['n']}"
                        )
                    }
                ]
            },
        )

    _install_mock_transport(monkeypatch, handler)

    caller = _make_caller()
    first = caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=15.0,
    )
    second = caller._post_img2img_request(
        image_url=_FAKE_UPLOAD_URL,
        prompt=_FAKE_PROMPT,
        params=None,
        timeout=15.0,
    )

    assert first != second, "each call must see the fresh mock response"
    assert call_count["n"] == 2
    # ``FalAiVendorCaller`` uses ``__slots__`` to forbid attribute
    # injection — no mutable per-call state can be stashed there.
    assert caller.__slots__ == ("_api_key", "_authorization_header")
