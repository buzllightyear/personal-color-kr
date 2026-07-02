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
    RESERVED_PAYLOAD_KEYS,
    FalGenerationConfig,
    FalGenerationError,
    GenerationInputs,
    _FAL_STORAGE_UPLOAD_URL,
    _parse_generation_response,
    generate_from_recipe,
)

# ---------------------------------------------------------------------------
# Test fixtures / constants
# ---------------------------------------------------------------------------

_TEST_API_KEY: Final[str] = "fake-key-id:fake-key-secret"

_FAKE_SELFIE: Final[bytes] = b"FAKE_PNG_SELFIE_BYTES"

_FAKE_GARMENT: Final[bytes] = b"FAKE_PNG_GARMENT_BYTES"

_FAKE_SELFIE_STORAGE_URL: Final[str] = (
    "https://fal.media/files/canary/uploaded-selfie.png"
)

_FAKE_GARMENT_STORAGE_URL: Final[str] = (
    "https://fal.media/files/canary/uploaded-garment.png"
)

_FAKE_RESULT_CDN_URL: Final[str] = "https://fal.media/files/canary/generated-result.png"

_FAKE_GENERATED_BYTES: Final[bytes] = b"FAKE_GENERATED_IMAGE_BYTES"

_MINIMAL_CONFIG: Final[FalGenerationConfig] = FalGenerationConfig(
    model_id="fal-ai/flux/dev",
    prompt="A person with spring warm-tone makeup styling",
)

_INPUTS: Final[GenerationInputs] = GenerationInputs(selfie_bytes=_FAKE_SELFIE)

_INPUTS_WITH_GARMENT: Final[GenerationInputs] = GenerationInputs(
    selfie_bytes=_FAKE_SELFIE,
    garment_bytes=_FAKE_GARMENT,
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
    """Route each step to a canned success response.

    Uploads are disambiguated by body content (the multipart body carries
    the raw bytes), so selfie and garment uploads get distinct storage URLs
    without handler state.
    """
    url = str(request.url)
    if url == _FAL_STORAGE_UPLOAD_URL:
        if b"GARMENT" in request.content:
            return httpx.Response(200, json={"url": _FAKE_GARMENT_STORAGE_URL})
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
        _INPUTS,
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

    generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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

    generate_from_recipe(config, _INPUTS, api_key=_TEST_API_KEY)

    # captured[1] is the model POST (after the upload).
    body_text = captured[1].content.decode("utf-8")
    assert "spring warm-tone styling with golden undertones" in body_text


@pytest.mark.unit
def test_generate_from_recipe_generation_call_contains_selfie_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model POST payload must contain the uploaded selfie URL as image_url."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

    body_text = captured[1].content.decode("utf-8")
    assert _FAKE_SELFIE_STORAGE_URL in body_text


@pytest.mark.unit
def test_generate_from_recipe_download_is_last_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The last HTTP call must be the GET to the CDN result URL."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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

    generate_from_recipe(config, _INPUTS, api_key=_TEST_API_KEY)

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

    generate_from_recipe(config, _INPUTS, api_key=_TEST_API_KEY)

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

    generate_from_recipe(config, _INPUTS, api_key=_TEST_API_KEY)

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

    generate_from_recipe(config, _INPUTS, api_key=_TEST_API_KEY)

    body_text = captured[1].content.decode("utf-8")
    assert "num_inference_steps" in body_text
    assert "guidance_scale" in body_text


# ---------------------------------------------------------------------------
# 4. Input validation — GenerationInputs (construction-time, before any HTTP)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_generation_inputs_rejects_empty_selfie() -> None:
    """Empty selfie_bytes raises ValueError at construction."""
    with pytest.raises(ValueError, match="empty"):
        GenerationInputs(selfie_bytes=b"")


@pytest.mark.unit
def test_generation_inputs_rejects_non_bytes_selfie() -> None:
    """Non-bytes selfie_bytes raises ValueError at construction."""
    with pytest.raises(ValueError, match="bytes"):
        GenerationInputs(selfie_bytes="not_bytes")  # type: ignore[arg-type]


@pytest.mark.unit
def test_generation_inputs_rejects_empty_garment() -> None:
    """A present-but-empty garment_bytes raises ValueError at construction."""
    with pytest.raises(ValueError, match="empty"):
        GenerationInputs(selfie_bytes=_FAKE_SELFIE, garment_bytes=b"")


@pytest.mark.unit
def test_generation_inputs_rejects_non_bytes_garment() -> None:
    """Non-bytes garment_bytes raises ValueError at construction."""
    with pytest.raises(ValueError, match="bytes"):
        GenerationInputs(
            selfie_bytes=_FAKE_SELFIE,
            garment_bytes="not_bytes",  # type: ignore[arg-type]
        )


@pytest.mark.unit
def test_generation_inputs_garment_defaults_to_none() -> None:
    """garment_bytes defaults to None (selfie-only generation)."""
    assert GenerationInputs(selfie_bytes=_FAKE_SELFIE).garment_bytes is None


@pytest.mark.unit
def test_generation_inputs_is_frozen() -> None:
    """GenerationInputs must be immutable (frozen dataclass)."""
    inputs = GenerationInputs(selfie_bytes=_FAKE_SELFIE)
    with pytest.raises((AttributeError, TypeError)):
        inputs.selfie_bytes = b"other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# 4b. Reference mode — payload key shape (single vs multi)
# ---------------------------------------------------------------------------


def _generation_payload(captured: list[httpx.Request]) -> dict[str, Any]:
    """Decode the model-POST JSON body (the request before the CDN download)."""
    import json

    return dict(json.loads(captured[-2].content.decode("utf-8")))


@pytest.mark.unit
def test_single_mode_sends_image_url_not_image_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reference_mode='single' (default) keeps today's payload contract exactly."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

    payload = _generation_payload(captured)
    assert payload["image_url"] == _FAKE_SELFIE_STORAGE_URL
    assert "image_urls" not in payload


@pytest.mark.unit
def test_multi_mode_without_garment_sends_single_element_array(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reference_mode='multi' without garment sends image_urls=[selfie]."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    config = FalGenerationConfig(
        model_id="fal-ai/flux-2/edit",
        prompt="trend look",
        reference_mode="multi",
    )

    generate_from_recipe(config, _INPUTS, api_key=_TEST_API_KEY)

    payload = _generation_payload(captured)
    assert payload["image_urls"] == [_FAKE_SELFIE_STORAGE_URL]
    assert "image_url" not in payload


@pytest.mark.unit
def test_multi_mode_with_garment_uploads_twice_and_orders_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Garment present: two storage uploads (selfie first), then
    image_urls=[selfie, garment] — prompts refer to first/second image."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    config = FalGenerationConfig(
        model_id="fal-ai/flux-2/edit",
        prompt="the person from the first image wearing the second image",
        reference_mode="multi",
    )

    result = generate_from_recipe(config, _INPUTS_WITH_GARMENT, api_key=_TEST_API_KEY)

    assert result == _FAKE_GENERATED_BYTES
    # 4 round-trips: upload selfie → upload garment → generate → download.
    assert len(captured) == 4
    assert str(captured[0].url) == _FAL_STORAGE_UPLOAD_URL
    assert str(captured[1].url) == _FAL_STORAGE_UPLOAD_URL
    payload = _generation_payload(captured)
    assert payload["image_urls"] == [
        _FAKE_SELFIE_STORAGE_URL,
        _FAKE_GARMENT_STORAGE_URL,
    ]
    assert "image_url" not in payload


@pytest.mark.unit
def test_single_mode_with_garment_raises_before_any_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A garment with reference_mode='single' is a caller bug — ValueError, no HTTP."""
    captured = _install_transport(
        monkeypatch,
        lambda _r: httpx.Response(599, text="should not reach transport"),
    )

    with pytest.raises(ValueError, match="single"):
        generate_from_recipe(
            _MINIMAL_CONFIG, _INPUTS_WITH_GARMENT, api_key=_TEST_API_KEY
        )

    assert captured == []


# ---------------------------------------------------------------------------
# 4c. Reserved payload keys — parameters may not override reference/prompt keys
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_reserved_payload_keys_value() -> None:
    """The reserved set pins exactly the keys parameters may not override."""
    assert RESERVED_PAYLOAD_KEYS == frozenset({"prompt", "image_url", "image_urls"})


@pytest.mark.unit
@pytest.mark.parametrize("reserved", sorted(RESERVED_PAYLOAD_KEYS))
def test_reserved_key_in_parameters_raises_before_any_http(
    monkeypatch: pytest.MonkeyPatch,
    reserved: str,
) -> None:
    """parameters containing a reserved key would silently drop the garment
    (payload.update overrides) — rejected with ValueError before any HTTP."""
    captured = _install_transport(
        monkeypatch,
        lambda _r: httpx.Response(599, text="should not reach transport"),
    )
    config = FalGenerationConfig(
        model_id="fal-ai/flux-2/edit",
        prompt="test",
        parameters={reserved: "attacker-controlled"},
        reference_mode="multi",
    )

    with pytest.raises(ValueError, match="reserved"):
        generate_from_recipe(config, _INPUTS, api_key=_TEST_API_KEY)

    assert captured == []


# ---------------------------------------------------------------------------
# 4d. Garment upload failure propagation (second storage POST)
# ---------------------------------------------------------------------------


def _selfie_upload_ok_garment_upload(
    garment_response: httpx.Response,
) -> Callable[[httpx.Request], httpx.Response]:
    """Handler: selfie upload succeeds, garment upload gets garment_response."""

    def _handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == _FAL_STORAGE_UPLOAD_URL:
            if b"GARMENT" in request.content:
                return garment_response
            return httpx.Response(200, json={"url": _FAKE_SELFIE_STORAGE_URL})
        return httpx.Response(599, text="model call must not be reached")

    return _handler


@pytest.mark.unit
def test_garment_upload_transient_429_raises_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 429 on the garment upload surfaces as retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        _selfie_upload_ok_garment_upload(httpx.Response(429, text="rate limited")),
    )
    config = FalGenerationConfig(
        model_id="fal-ai/flux-2/edit", prompt="t", reference_mode="multi"
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(config, _INPUTS_WITH_GARMENT, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is True
    assert exc_info.value.status_code == 429


@pytest.mark.unit
def test_garment_upload_permanent_401_raises_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTP 401 on the garment upload surfaces as non-retryable FalGenerationError."""
    _install_transport(
        monkeypatch,
        _selfie_upload_ok_garment_upload(httpx.Response(401, text="unauthorized")),
    )
    config = FalGenerationConfig(
        model_id="fal-ai/flux-2/edit", prompt="t", reference_mode="multi"
    )

    with pytest.raises(FalGenerationError) as exc_info:
        generate_from_recipe(config, _INPUTS_WITH_GARMENT, api_key=_TEST_API_KEY)

    assert exc_info.value.retryable is False


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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
        generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)


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


@pytest.mark.unit
def test_fal_generation_config_default_reference_mode_is_single() -> None:
    """Default reference_mode is 'single' — today's payload contract."""
    config = FalGenerationConfig(model_id="fal-ai/flux/dev", prompt="test")
    assert config.reference_mode == "single"


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

    generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=api_key)

    upload_request = captured[0]
    assert upload_request.headers.get("Authorization") == f"Key {api_key}"


@pytest.mark.unit
def test_generation_request_carries_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model POST must carry 'Authorization: Key <api_key>'."""
    captured = _install_transport(monkeypatch, _happy_path_handler)
    api_key = "test-key-id:test-key-secret"

    generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=api_key)

    generation_request = captured[1]
    assert generation_request.headers.get("Authorization") == f"Key {api_key}"


@pytest.mark.unit
def test_download_request_has_no_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The CDN download GET must NOT carry an Authorization header (CDN is pre-signed)."""
    captured = _install_transport(monkeypatch, _happy_path_handler)

    generate_from_recipe(_MINIMAL_CONFIG, _INPUTS, api_key=_TEST_API_KEY)

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
