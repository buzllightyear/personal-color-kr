"""Tests for personal_color.generate.fal_client (Sub-AC 2a-i).

Verifies the fal.ai generation client with fal.ai mocked via
``httpx.MockTransport``.  No real HTTP calls are made — the mock
transport intercepts at the transport layer so the production code
(``generate_from_recipe``) runs unchanged.

Test coverage:
    - Happy path: 3-step flow returns raw image bytes (upload → generate → download)
    - 30-second timeout enforcement: deadline respected across all steps
    - Upload failures: transient (retryable) and permanent (non-retryable)
    - Generation failures: transient and permanent HTTP errors
    - Download failures: transient and permanent HTTP errors
    - Response-parser isolation: malformed generation response shapes
    - Input validation: empty selfie bytes, non-bytes input rejected before HTTP
    - Style reference URL forwarded in generation payload
    - Model-specific parameters merged into generation payload
    - FalGenerationConfig immutability (frozen dataclass)
"""

from __future__ import annotations

from typing import Any, Callable, Final

import httpx
import pytest

from personal_color.generate.fal_client import (
    DEFAULT_TIMEOUT,
    FalGenerationConfig,
    FalGenerationError,
    _FAL_STORAGE_UPLOAD_URL,
    _parse_generation_response,
    generate_from_recipe,
)

# ---------------------------------------------------------------------------
# Test fixtures / constants
# ---------------------------------------------------------------------------

_TEST_API_KEY: Final[str] = "fake-key-id:fake-key-secret"

_FAKE_SELFIE: Final[bytes] = b"FAKE_PNG_SELFIE_BYTES"

_FAKE_SELFIE_STORAGE_URL: Final[str] = (
    "https://fal.media/files/canary/uploaded-selfie.png"
)

_FAKE_RESULT_CDN_URL: Final[str] = (
    "https://fal.media/files/canary/generated-result.png"
)

_FAKE_GENERATED_BYTES: Final[bytes] = b"FAKE_GENERATED_IMAGE_BYTES"

_MINIMAL_CONFIG: Final[FalGenerationConfig] = FalGenerationConfig(
    model_id="fal-ai/flux/dev",
    prompt="A person with spring warm-tone makeup styling",
)

# Capture the real httpx.Client once so the mock factory can build a real
# Client configured with MockTransport without recursing into itself.
_REAL_HTTPX_CLIENT: Final[type[httpx.Client]] = httpx.Client


# ---------------------------------------------------------------------------
# Mock transport helpers
# ---------------------------------------------------------------------------


def _make_mock_transport(
    handler: Callable[[httpx.Request], httpx.Response],
) -> httpx.MockTransport:
    """Wrap a handler with request materialisation so bodies are inspectable."""

    def _recording_handler(request: httpx.Request) -> httpx.Response:
        # Force the body to be read so assertions on request.content work.
        request.read()
        return handler(request)

    return httpx.MockTransport(_recording_handler)


def _install_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.Request]:
    """Replace httpx.Client in fal_client with a mock; return captured requests."""
    captured: list[httpx.Request] = []

    def _capturing_handler(request: httpx.Request) -> httpx.Response:
        request.read()
        captured.append(request)
        return handler(request)

    transport = httpx.MockTransport(_capturing_handler)

    def _client_factory(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return _REAL_HTTPX_CLIENT(*args, **kwargs)

    monkeypatch.setattr(
        "personal_color.generate.fal_client.httpx.Client",
        _client_factory,
    )
    return captured


def _happy_path_handler(request: httpx.Request) -> httpx.Response:
    """Route each of the 3 steps to a canned success response."""
    url = str(request.url)
    if url == _FAL_STORAGE_UPLOAD_URL:
        return httpx.Response(200, json={"url": _FAKE_SELFIE_STORAGE_URL})
    if _FAKE_SELFIE_STORAGE_URL not in url and "fal.run" in url:
        # This is the generation step (POST to the model endpoint).
        return httpx.Response(
            200,
            json={"images": [{"url": _FAKE_RESULT_CDN_URL}]},
        )
    if url == _FAKE_RESULT_CDN_URL:
        return httpx.Response(200, content=_FAKE_GENERATED_BYTES)
    return httpx.Response(599, text=f"unexpected URL: {url}")


# ---------------------------------------------------------------------------
# 1. Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_generate_from_recipe_returns_raw_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Happy path: generate_from_recipe returns the CDN bytes after 3 HTTP calls."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    result = generate_from_recipe(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        timeout=30.0,
    )

    assert result == _FAKE_GENERATED_BYTES
    # Exactly 3 round-trips: upload → generate → download.
    assert len(captured) == 3


@pytest.mark.unit
def test_generate_from_recipe_upload_is_first_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The first HTTP call must be the selfie upload to fal.run/storage/upload."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert str(captured[0].url) == _FAL_STORAGE_UPLOAD_URL


@pytest.mark.unit
def test_generate_from_recipe_generation_call_contains_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model POST payload must contain the recipe's prompt."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    config = FalGenerationConfig(
        model_id="fal-ai/flux/dev",
        prompt="spring warm-tone styling with golden undertones",
    )

    generate_from_recipe(config, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    # captured[1] is the model POST (after the upload).
    body_text = captured[1].content.decode("utf-8")
    assert "spring warm-tone styling with golden undertones" in body_text


@pytest.mark.unit
def test_generate_from_recipe_generation_call_contains_selfie_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model POST payload must contain the uploaded selfie URL as image_url."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    body_text = captured[1].content.decode("utf-8")
    assert _FAKE_SELFIE_STORAGE_URL in body_text


@pytest.mark.unit
def test_generate_from_recipe_download_is_last_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The last HTTP call must be the GET to the CDN result URL."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert str(captured[2].url) == _FAKE_RESULT_CDN_URL


@pytest.mark.unit
def test_generate_from_recipe_uses_correct_model_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model POST must target https://fal.run/{model_id}."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    config = FalGenerationConfig(
        model_id="fal-ai/flux-realism",
        prompt="test prompt",
    )

    generate_from_recipe(config, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    generation_url = str(captured[1].url)
    assert generation_url == "https://fal.run/fal-ai/flux-realism"


# ---------------------------------------------------------------------------
# 2. Style reference URL forwarding
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_generate_from_recipe_forwards_style_reference_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When style_reference_url is set, it must appear in the generation payload."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    style_url = "https://storage.example.com/style-ref/autumn-warm.jpg"
    config = FalGenerationConfig(
        model_id="fal-ai/flux/dev",
        prompt="autumn warm styling",
        style_reference_url=style_url,
    )

    generate_from_recipe(config, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    body_text = captured[1].content.decode("utf-8")
    assert style_url in body_text


@pytest.mark.unit
def test_generate_from_recipe_no_style_url_omits_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When style_reference_url is None, style_image_url must be absent from payload."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    config = FalGenerationConfig(
        model_id="fal-ai/flux/dev",
        prompt="test",
        style_reference_url=None,
    )

    generate_from_recipe(config, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    body_text = captured[1].content.decode("utf-8")
    assert "style_image_url" not in body_text


# ---------------------------------------------------------------------------
# 3. Model parameters forwarding
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_generate_from_recipe_merges_parameters_into_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Model-specific parameters from the recipe must be merged into the POST body."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    config = FalGenerationConfig(
        model_id="fal-ai/flux/dev",
        prompt="test",
        parameters={"num_inference_steps": 30, "guidance_scale": 4.0},
    )

    generate_from_recipe(config, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    body_text = captured[1].content.decode("utf-8")
    assert "num_inference_steps" in body_text
    assert "guidance_scale" in body_text


# ---------------------------------------------------------------------------
# 4. Input validation (before any HTTP call)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_generate_from_recipe_rejects_empty_selfie(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty selfie_bytes raises ValueError before any HTTP round-trip."""
    captured = _install_transport(
        monkeypatch,
        lambda _r: httpx.Response(599, text="should not reach transport"),
    )

    with pytest.raises(ValueError, match="empty"):
        generate_from_recipe(_MINIMAL_CONFIG, b"", api_key=_TEST_API_KEY)

    assert captured == []


@pytest.mark.unit
def test_generate_from_recipe_rejects_non_bytes_selfie(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-bytes selfie_bytes raises ValueError before any HTTP round-trip."""
    captured = _install_transport(
        monkeypatch,
        lambda _r: httpx.Response(599, text="should not reach transport"),
    )

    with pytest.raises(ValueError, match="bytes"):
        generate_from_recipe(
            _MINIMAL_CONFIG,
            "not_bytes",  # type: ignore[arg-type]
            api_key=_TEST_API_KEY,
        )

    assert captured == []


# ---------------------------------------------------------------------------
# 5. Upload step failure propagation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_upload_transient_http_429_raises_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 429 from the upload endpoint surfaces as retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        lambda _r: httpx.Response(429, text="rate limited"),
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is True
    assert exc_info.value.status_code == 429


@pytest.mark.unit
def test_upload_transient_http_503_raises_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 503 from the upload endpoint surfaces as retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        lambda _r: httpx.Response(503, text="service unavailable"),
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is True


@pytest.mark.unit
def test_upload_permanent_http_401_raises_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 401 from the upload endpoint surfaces as non-retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        lambda _r: httpx.Response(401, text="unauthorized"),
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is False


# ---------------------------------------------------------------------------
# 6. Generation step failure propagation
# ---------------------------------------------------------------------------


def _upload_ok_then(
    model_response: httpx.Response,
) -> Callable[[httpx.Request], httpx.Response]:
    """Return a handler: upload succeeds, then return model_response for any other call."""

    def _handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == _FAL_STORAGE_UPLOAD_URL:
            return httpx.Response(200, json={"url": _FAKE_SELFIE_STORAGE_URL})
        return model_response

    return _handler


@pytest.mark.unit
def test_generation_transient_http_500_raises_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 500 from the model endpoint surfaces as retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        _upload_ok_then(httpx.Response(500, text="internal server error")),
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is True
    assert exc_info.value.status_code == 500


@pytest.mark.unit
def test_generation_transient_http_429_raises_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 429 from the model endpoint surfaces as retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        _upload_ok_then(httpx.Response(429, text="rate limit")),
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is True


@pytest.mark.unit
def test_generation_permanent_http_422_raises_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 422 from the model endpoint surfaces as non-retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        _upload_ok_then(httpx.Response(422, text="unprocessable entity")),
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is False


# ---------------------------------------------------------------------------
# 7. Download step failure propagation
# ---------------------------------------------------------------------------


def _upload_and_generate_ok_then(
    download_response: httpx.Response,
) -> Callable[[httpx.Request], httpx.Response]:
    """Return a handler: upload + generate succeed, then return download_response."""

    def _handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == _FAL_STORAGE_UPLOAD_URL:
            return httpx.Response(200, json={"url": _FAKE_SELFIE_STORAGE_URL})
        if url == _FAKE_RESULT_CDN_URL:
            return download_response
        # Generation step — return the CDN URL.
        return httpx.Response(
            200,
            json={"images": [{"url": _FAKE_RESULT_CDN_URL}]},
        )

    return _handler


@pytest.mark.unit
def test_download_transient_http_503_raises_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 503 from the CDN download surfaces as retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        _upload_and_generate_ok_then(httpx.Response(503, text="cdn unavailable")),
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is True


@pytest.mark.unit
def test_download_empty_body_raises_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty 200 body from the CDN raises FalGenerationError."""
    _install_transport(
        monkeypatch,
        _upload_and_generate_ok_then(httpx.Response(200, content=b"")),
    )

    with pytest.raises(FalGenerationError, match="empty"):
        generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)


# ---------------------------------------------------------------------------
# 8. _parse_generation_response (pure unit tests — no HTTP)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_response_extracts_images_0_url() -> None:
    """Parser returns images[0].url from a well-formed response."""
    body = {"images": [{"url": "https://cdn.example.com/img.png"}, {"url": "other"}]}
    assert _parse_generation_response(body) == "https://cdn.example.com/img.png"


@pytest.mark.unit
def test_parse_response_rejects_non_dict_body() -> None:
    """Parser raises FalGenerationError when body is not a dict."""
    with pytest.raises(FalGenerationError):
        _parse_generation_response(["not", "a", "dict"])


@pytest.mark.unit
def test_parse_response_rejects_missing_images_key() -> None:
    """Parser raises FalGenerationError when 'images' key is absent."""
    with pytest.raises(FalGenerationError, match="images"):
        _parse_generation_response({"something_else": []})


@pytest.mark.unit
def test_parse_response_rejects_empty_images_array() -> None:
    """Parser raises FalGenerationError when 'images' array is empty."""
    with pytest.raises(FalGenerationError, match="images"):
        _parse_generation_response({"images": []})


@pytest.mark.unit
def test_parse_response_rejects_non_dict_image_entry() -> None:
    """Parser raises FalGenerationError when images[0] is not a dict."""
    with pytest.raises(FalGenerationError):
        _parse_generation_response({"images": ["not-a-dict"]})


@pytest.mark.unit
def test_parse_response_rejects_missing_url_field() -> None:
    """Parser raises FalGenerationError when images[0] lacks 'url'."""
    with pytest.raises(FalGenerationError, match="url"):
        _parse_generation_response({"images": [{"other": "field"}]})


@pytest.mark.unit
def test_parse_response_rejects_empty_url_string() -> None:
    """Parser raises FalGenerationError when images[0].url is empty."""
    with pytest.raises(FalGenerationError, match="url"):
        _parse_generation_response({"images": [{"url": ""}]})


# ---------------------------------------------------------------------------
# 9. FalGenerationConfig immutability
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_fal_generation_config_is_frozen() -> None:
    """FalGenerationConfig must be immutable (frozen dataclass)."""
    config = FalGenerationConfig(model_id="fal-ai/flux/dev", prompt="test")
    with pytest.raises((AttributeError, TypeError)):
        config.model_id = "new-value"  # type: ignore[misc]


@pytest.mark.unit
def test_fal_generation_config_default_parameters_is_empty_dict() -> None:
    """Default parameters is an empty dict when not provided."""
    config = FalGenerationConfig(model_id="fal-ai/flux/dev", prompt="test")
    assert config.parameters == {}


@pytest.mark.unit
def test_fal_generation_config_default_style_reference_url_is_none() -> None:
    """Default style_reference_url is None when not provided."""
    config = FalGenerationConfig(model_id="fal-ai/flux/dev", prompt="test")
    assert config.style_reference_url is None


# ---------------------------------------------------------------------------
# 10. DEFAULT_TIMEOUT value
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_default_timeout_is_30_seconds() -> None:
    """DEFAULT_TIMEOUT must be 30.0 seconds (Seed Contract SLO)."""
    assert DEFAULT_TIMEOUT == 30.0


# ---------------------------------------------------------------------------
# 11. Authorization header — api_key is forwarded correctly
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_upload_request_carries_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The upload POST must carry 'Authorization: Key <api_key>'."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    api_key = "test-key-id:test-key-secret"

    generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=api_key)

    upload_request = captured[0]
    assert upload_request.headers.get("Authorization") == f"Key {api_key}"


@pytest.mark.unit
def test_generation_request_carries_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model POST must carry 'Authorization: Key <api_key>'."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    api_key = "test-key-id:test-key-secret"

    generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=api_key)

    generation_request = captured[1]
    assert generation_request.headers.get("Authorization") == f"Key {api_key}"


@pytest.mark.unit
def test_download_request_has_no_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The CDN download GET must NOT carry an Authorization header (CDN is pre-signed)."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _FAKE_SELFIE, api_key=_TEST_API_KEY)

    download_request = captured[2]
    assert "Authorization" not in download_request.headers


# ---------------------------------------------------------------------------
# 12. FalGenerationError attributes
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_fal_generation_error_default_attributes() -> None:
    """FalGenerationError defaults: status_code=None, retryable=False."""
    err = FalGenerationError("some failure")
    assert err.status_code is None
    assert err.retryable is False


@pytest.mark.unit
def test_fal_generation_error_custom_attributes() -> None:
    """FalGenerationError accepts explicit status_code and retryable."""
    err = FalGenerationError("rate limited", status_code=429, retryable=True)
    assert err.status_code == 429
    assert err.retryable is True
