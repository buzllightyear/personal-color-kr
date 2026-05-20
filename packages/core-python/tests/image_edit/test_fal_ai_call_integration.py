"""Integration tests for ``FalAiVendorCaller.__call__`` (Seed Contract AC 21).

# What this file pins down

The 3-step Fal.ai img2img flow has been individually exercised by 10
sibling test files (api key, defaults, preset mapping, request builder,
response parser, upload step, edit step, download step, download
result alias, params overrides). Those tests cover each *piece* in
isolation; this file pins the *orchestration*: that ``__call__``
actually wires the three HTTP steps together in the documented order
(upload → edit → download) and returns the final edited bytes.

A failure here means the adapter cannot be invoked end-to-end, even if
all the sub-method tests pass — exactly the regression that the
Phase 3.1 Stage 2 evaluation surfaced when ``__call__`` was still a
``NotImplementedError`` scaffold.

# Why a dedicated integration test?

The sibling AC tests deliberately keep each step in isolation so a
regression in one HTTP round-trip can't mask a regression in another.
This file is the inverse: a single test stitching all three round-trips
into one ``MockTransport`` so a regression in the orchestration order,
the budget bookkeeping, or the preset → prompt boundary is caught
*here* — not after a slow Phase 4 FastAPI smoke run.

# Mock transport at the transport layer (not the production code)

The Seed Contract bans conditional branches for mocks in production
code. This file follows the same ``monkeypatch.setattr`` swap on
``httpx.Client`` that the upload / edit / download tests use, with a
single dispatch handler that routes each of the three URLs to a
distinct canned response.
"""

from __future__ import annotations

from typing import Any, Callable, Final

import httpx
import pytest

from image_edit.fal_ai_vendor_caller import (
    FalAiVendorCaller,
    _FAL_IMG2IMG_RESPONSE_IMAGES_KEY,
    _FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY,
    _FAL_IMG2IMG_URL,
    _FAL_STORAGE_RESPONSE_URL_KEY,
    _FAL_STORAGE_UPLOAD_URL,
    _PRESET_TO_PROMPT,
)
from image_edit.vendor_client import VendorRequest

# A clearly-fake API key. Distinct from any byte string the adapter
# logs on purpose (elapsed seconds, upload size, downloaded bytes).
_TEST_API_KEY: Final[str] = "fake-id-12345:fake-secret-do-not-use-67890"

# Minimal non-empty selfie payload — the adapter treats bytes as
# opaque. The string is recognisable so failed assertions print
# something legible.
_FAKE_SELFIE_BYTES: Final[bytes] = b"FAKE_SELFIE_PAYLOAD"

# The URL Fal storage "returns" in successful mocks. Distinctive
# enough that an accidental log leak would be obvious in test output.
_FAKE_UPLOAD_URL: Final[str] = (
    "https://v3.fal.media/files/elephant/leak-canary-upload-url.png"
)

# The URL the FLUX img2img endpoint "returns" in successful mocks.
# Distinct from the upload URL so an orchestration regression that
# accidentally passed the upload URL to the download step would
# surface as a clear test failure.
_FAKE_RESULT_URL: Final[str] = (
    "https://v3.fal.media/files/giraffe/leak-canary-result-url.png"
)

# The bytes the CDN "returns" on the final GET. Non-empty per the
# adapter's `bytes` return contract; recognisable so the integration
# test's final assertion prints something legible on failure.
_FAKE_EDITED_BYTES: Final[bytes] = b"FAKE_EDITED_IMAGE_BYTES"


# Capture the real ``httpx.Client`` constructor at module import —
# *before* any test monkeypatches the symbol — so the mock factory can
# build a real Client configured with ``MockTransport`` without
# recursing into itself.
_REAL_HTTPX_CLIENT: Final[type[httpx.Client]] = httpx.Client


def _install_mock_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.Request]:
    """Replace ``httpx.Client`` inside the adapter module with a mock.

    Returns a captured list of the requests routed through the mock,
    so tests can assert on the request order and shape.
    """
    captured: list[httpx.Request] = []

    def recording_handler(request: httpx.Request) -> httpx.Response:
        # Materialise the body so multipart / JSON assertions can
        # inspect it after the mock "sends" the request.
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


def _three_step_handler(request: httpx.Request) -> httpx.Response:
    """Dispatch each of the three URLs to its canned success response."""
    url = str(request.url)
    if url == _FAL_STORAGE_UPLOAD_URL:
        return httpx.Response(
            status_code=200,
            json={_FAL_STORAGE_RESPONSE_URL_KEY: _FAKE_UPLOAD_URL},
        )
    if url == _FAL_IMG2IMG_URL:
        return httpx.Response(
            status_code=200,
            json={
                _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                    {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL}
                ],
            },
        )
    if url == _FAKE_RESULT_URL:
        return httpx.Response(status_code=200, content=_FAKE_EDITED_BYTES)
    return httpx.Response(
        status_code=599,
        text=f"unexpected URL in integration test: {url}",
    )


@pytest.mark.unit
def test_call_orchestrates_upload_edit_download_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The full happy path returns the CDN bytes after 3 round-trips in order.

    Pins the AC 21 contract: ``__call__`` wires the 3 sub-methods
    together. Any regression that drops a step, reorders the flow, or
    swaps URLs between steps surfaces as either a wrong request count,
    a wrong URL sequence, or a wrong return value.
    """
    captured = _install_mock_transport(monkeypatch, _three_step_handler)

    caller = FalAiVendorCaller(api_key=_TEST_API_KEY)
    request = VendorRequest(
        selfie_bytes=_FAKE_SELFIE_BYTES,
        params={"preset": "spring-warm"},
        vendor="fal-ai",
    )

    edited = caller(request, attempt_timeout=20.0)

    # The bytes that crossed the layer boundary are exactly the CDN's
    # response body — no decoding, no re-encoding, no padding.
    assert edited == _FAKE_EDITED_BYTES

    # Exactly three HTTP round-trips: upload, edit, download.
    assert len(captured) == 3
    assert str(captured[0].url) == _FAL_STORAGE_UPLOAD_URL
    assert str(captured[1].url) == _FAL_IMG2IMG_URL
    assert str(captured[2].url) == _FAKE_RESULT_URL

    # The edit step's POST body must carry the preset-resolved prompt
    # — proving the boundary translation actually happened, not just
    # that the URL was right.
    edit_body = captured[1].content.decode("utf-8")
    expected_prompt = _PRESET_TO_PROMPT["spring-warm"]
    assert expected_prompt in edit_body


@pytest.mark.unit
def test_call_rejects_missing_preset_before_any_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A `VendorRequest` without `params['preset']` short-circuits as ValueError.

    Pins the boundary discipline: the preset → prompt resolution lives
    at the adapter boundary, and an upstream caller that forgot to
    populate the preset MUST fail before any Fal credit is spent.
    """
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(599, text="should not reach transport"),
    )

    caller = FalAiVendorCaller(api_key=_TEST_API_KEY)
    request = VendorRequest(
        selfie_bytes=_FAKE_SELFIE_BYTES,
        params={},  # no `preset` key
        vendor="fal-ai",
    )

    with pytest.raises(ValueError, match="preset"):
        caller(request, attempt_timeout=20.0)

    # No HTTP round-trip happened.
    assert captured == []


@pytest.mark.unit
def test_call_rejects_unknown_preset_before_any_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A preset outside the closed enum surfaces as ValueError, no HTTP."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(599, text="should not reach transport"),
    )

    caller = FalAiVendorCaller(api_key=_TEST_API_KEY)
    request = VendorRequest(
        selfie_bytes=_FAKE_SELFIE_BYTES,
        params={"preset": "mid-autumn-festival"},
        vendor="fal-ai",
    )

    with pytest.raises(ValueError, match="unknown preset"):
        caller(request, attempt_timeout=20.0)

    assert captured == []


@pytest.mark.unit
def test_call_rejects_non_string_preset_before_any_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-string preset surfaces as ValueError, no HTTP."""
    captured = _install_mock_transport(
        monkeypatch,
        lambda _r: httpx.Response(599, text="should not reach transport"),
    )

    caller = FalAiVendorCaller(api_key=_TEST_API_KEY)
    request = VendorRequest(
        selfie_bytes=_FAKE_SELFIE_BYTES,
        params={"preset": 42},
        vendor="fal-ai",
    )

    with pytest.raises(ValueError, match="preset"):
        caller(request, attempt_timeout=20.0)

    assert captured == []
