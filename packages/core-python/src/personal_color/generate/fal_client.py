"""fal.ai generation client for the trend recipe pipeline (Sub-AC 2a-i).

# Purpose

Provides :func:`generate_from_recipe`, the single entry point for
server-side AI image generation driven by operator-authored trend
recipes. The caller supplies a pre-resolved recipe config (model,
prompt, parameters) plus raw selfie bytes; this module handles the
3-step fal.ai HTTP flow and returns the generated image as raw bytes.

# 3-step HTTP flow

  1. **Upload** — POST the selfie bytes to ``https://fal.run/storage/upload``
     to obtain a short-lived HTTP URL that fal.ai model endpoints can
     dereference.  Uses at most 5 s of the 30 s budget.
  2. **Generate** — POST to ``https://fal.run/{model_id}`` with the
     selfie URL as ``image_url``, the recipe's resolved prompt, optional
     style-reference URL, and the recipe's model-specific parameters.
     Uses at most 22 s of the remaining budget.
  3. **Download** — GET the CDN URL returned in ``images[0].url`` and
     return the raw bytes to the caller.  Uses at most 5 s of the
     remaining budget.

# Timeout contract

The total elapsed time for all three steps must not exceed ``timeout``
(default 30 s).  Each step clips its own budget to a per-phase ceiling
so a slow upload cannot starve the generation step.  When the deadline
is already exhausted before a step starts, :class:`FalGenerationError`
is raised immediately (``retryable=True``) so the outer pipeline can
decide whether to surface a timeout or retry.

# Security posture

  * ``api_key`` is passed as a parameter, never read from the
    environment here.  The caller is responsible for loading it via
    :mod:`image_edit.fal_ai_api_key` (the single authorised loader).
  * The API key NEVER appears in log statements, exception messages, or
    HTTP headers other than ``Authorization``.
  * Response bodies are parsed with a strict allowlist: only
    ``images[0].url`` crosses the parsing boundary; every other field
    is silently discarded.
  * The selfie URL returned by the storage step is never logged.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Final

import httpx

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Endpoint constants
# ---------------------------------------------------------------------------

#: Base URL for all fal.ai models served via the synchronous REST surface.
_FAL_RUN_BASE_URL: Final[str] = "https://fal.run"

#: Fal.ai temporary-storage upload endpoint.  Returns a short-lived HTTP
#: URL the model endpoint can dereference; Fal's server-side TTL handles
#: cleanup automatically.
_FAL_STORAGE_UPLOAD_URL: Final[str] = "https://fal.run/storage/upload"

#: Total per-call budget in seconds.  30 s matches the Seed Contract's
#: end-to-end generate + reject + watermark SLO; this module consumes the
#: generation slice only.
DEFAULT_TIMEOUT: Final[float] = 30.0

#: Per-phase ceiling for the selfie upload step (seconds).
#: Keeps the upload slice from consuming the generation budget.
_UPLOAD_TIMEOUT_CEILING: Final[float] = 5.0

#: Per-phase ceiling for the model generation step (seconds).
#: FLUX-class models take 10–20 s; 22 s leaves headroom for upload and download.
_GENERATE_TIMEOUT_CEILING: Final[float] = 22.0

#: Per-phase ceiling for the CDN download step (seconds).
_DOWNLOAD_TIMEOUT_CEILING: Final[float] = 5.0

# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FalGenerationConfig:
    """Recipe-derived parameters for a single fal.ai generation call.

    The caller is responsible for resolving ``prompt_template`` into a
    concrete ``prompt`` (template variable expansion, personal-color
    modifier injection, etc.) and for resolving ``style_reference_key``
    from object-storage key to an accessible HTTP URL before constructing
    this config.  This module treats both values as opaque strings.

    Attributes:
        model_id: fal.ai model path, e.g. ``"fal-ai/flux/dev"`` or
            ``"fal-ai/flux-realism"``.  Combined with
            :data:`_FAL_RUN_BASE_URL` to form the request endpoint.
        prompt: The fully-resolved generation prompt.  Passed verbatim
            as the ``"prompt"`` field in the fal.ai request payload.
        parameters: Model-specific knobs merged into the request payload
            after ``prompt`` and ``image_url`` so they can override
            any default (e.g. ``{"num_inference_steps": 30}``).
        style_reference_url: Optional HTTP(S) URL for a style-reference
            image.  When not ``None``, passed as ``"style_image_url"``
            in the request payload to support models that accept a
            separate style conditioning image.  ``None`` (default)
            omits the field entirely.
    """

    model_id: str
    prompt: str
    parameters: dict[str, Any] = field(default_factory=dict)
    style_reference_url: str | None = None


class FalGenerationError(Exception):
    """Raised when the fal.ai generation call fails.

    Attributes:
        status_code: HTTP status code from fal.ai, or ``None`` for
            transport-level errors (timeout, connection reset, DNS).
        retryable: ``True`` when the failure is transient (HTTP 429,
            5xx, or timeout) and the outer pipeline *may* retry within
            the 30 s budget.  ``False`` for permanent failures (HTTP
            4xx excluding 429) where retrying with the same inputs would
            produce the same outcome.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


# ---------------------------------------------------------------------------
# Step 1: selfie upload
# ---------------------------------------------------------------------------


def _upload_selfie(
    selfie_bytes: bytes,
    api_key: str,
    timeout: float,
) -> str:
    """Upload selfie bytes to fal.run storage and return the storage URL.

    Args:
        selfie_bytes: Raw image bytes to upload.  Treated as opaque.
        api_key: fal.ai API key for the ``Authorization`` header.
        timeout: Seconds budget for this HTTP call.  Clipped to
            :data:`_UPLOAD_TIMEOUT_CEILING` internally.

    Returns:
        Non-empty HTTP URL at which fal.ai servers can retrieve the
        uploaded selfie.  Short-lived; intended for immediate use in
        the generation step.

    Raises:
        FalGenerationError: On HTTP errors, transport failures, or
            response-parsing failures.
    """
    if timeout <= 0:
        raise FalGenerationError(
            "fal upload: deadline exhausted before HTTP call",
            retryable=True,
        )

    effective_timeout = min(timeout, _UPLOAD_TIMEOUT_CEILING)
    headers = {
        "Authorization": f"Key {api_key}",
        "Accept": "application/json",
    }
    files = {
        "file": ("selfie", selfie_bytes, "application/octet-stream"),
    }

    try:
        with httpx.Client(timeout=effective_timeout) as client:
            response = client.post(
                _FAL_STORAGE_UPLOAD_URL,
                headers=headers,
                files=files,
            )
    except httpx.TimeoutException:
        raise FalGenerationError(
            "fal upload: request timed out",
            retryable=True,
        ) from None
    except httpx.HTTPError as exc:
        raise FalGenerationError(
            f"fal upload: transport error ({type(exc).__name__})",
            retryable=True,
        ) from None

    status = response.status_code
    if status == 429 or 500 <= status < 600:
        raise FalGenerationError(
            f"fal upload: transient HTTP {status}",
            status_code=status,
            retryable=True,
        )
    if not (200 <= status < 300):
        raise FalGenerationError(
            f"fal upload: unexpected HTTP {status}",
            status_code=status,
            retryable=False,
        )

    try:
        body: Any = response.json()
    except ValueError as exc:
        raise FalGenerationError(
            "fal upload: response was not valid JSON",
        ) from exc

    if not isinstance(body, dict):
        raise FalGenerationError("fal upload: response was not a JSON object")

    url = body.get("url")
    if not isinstance(url, str) or not url:
        raise FalGenerationError(
            "fal upload: response missing required 'url' string field"
        )

    _LOGGER.debug(
        "fal upload complete upload_bytes=%d",
        len(selfie_bytes),
    )
    return url


# ---------------------------------------------------------------------------
# Step 2a: response parser (pure, no I/O)
# ---------------------------------------------------------------------------


def _parse_generation_response(body: object) -> str:
    """Extract ``images[0].url`` from a fal.ai model response.

    Pure function — no I/O, no logging, no module-level side effects.
    Every structural check lives here so the HTTP round-trip in
    :func:`_call_model` can be tested independently.

    Args:
        body: Decoded JSON body of a 200 response.  Typed as ``object``
            to force explicit ``isinstance`` checks.

    Returns:
        The non-empty CDN URL at ``body["images"][0]["url"]``.

    Raises:
        FalGenerationError: On any structural violation (wrong type,
            missing key, empty string).  All violations are permanent —
            the same malformed response would arise on retry.
    """
    if not isinstance(body, dict):
        raise FalGenerationError("fal generate: response was not a JSON object")

    images = body.get("images")
    if not isinstance(images, list) or not images:
        raise FalGenerationError(
            "fal generate: response missing non-empty 'images' array"
        )

    first = images[0]
    if not isinstance(first, dict):
        raise FalGenerationError("fal generate: images[0] was not a JSON object")

    url = first.get("url")
    if not isinstance(url, str) or not url:
        raise FalGenerationError(
            "fal generate: images[0] missing required 'url' string field"
        )

    return url


# ---------------------------------------------------------------------------
# Step 2b: model call
# ---------------------------------------------------------------------------


def _call_model(
    config: FalGenerationConfig,
    selfie_url: str,
    api_key: str,
    timeout: float,
) -> str:
    """POST to the fal.ai model endpoint and return the result image URL.

    Args:
        config: Recipe-derived generation config.
        selfie_url: Storage URL of the uploaded selfie (from step 1).
        api_key: fal.ai API key.
        timeout: Seconds budget.  Clipped to
            :data:`_GENERATE_TIMEOUT_CEILING` internally.

    Returns:
        CDN URL of the first generated image (``images[0].url``).

    Raises:
        FalGenerationError: On HTTP errors or response-parsing failures.
    """
    if timeout <= 0:
        raise FalGenerationError(
            "fal generate: deadline exhausted before HTTP call",
            retryable=True,
        )

    effective_timeout = min(timeout, _GENERATE_TIMEOUT_CEILING)
    endpoint = f"{_FAL_RUN_BASE_URL}/{config.model_id}"

    # Build payload: selfie URL first, then prompt, then optional style
    # reference, then model-specific parameters (so parameters can
    # intentionally override any of the above if needed).
    payload: dict[str, Any] = {
        "image_url": selfie_url,
        "prompt": config.prompt,
    }
    if config.style_reference_url is not None:
        payload["style_image_url"] = config.style_reference_url
    if config.parameters:
        payload.update(config.parameters)

    headers = {
        "Authorization": f"Key {api_key}",
        "Accept": "application/json",
    }

    try:
        with httpx.Client(timeout=effective_timeout) as client:
            response = client.post(endpoint, headers=headers, json=payload)
    except httpx.TimeoutException:
        raise FalGenerationError(
            "fal generate: request timed out",
            retryable=True,
        ) from None
    except httpx.HTTPError as exc:
        raise FalGenerationError(
            f"fal generate: transport error ({type(exc).__name__})",
            retryable=True,
        ) from None

    status = response.status_code
    if status == 429 or 500 <= status < 600:
        raise FalGenerationError(
            f"fal generate: transient HTTP {status}",
            status_code=status,
            retryable=True,
        )
    if not (200 <= status < 300):
        raise FalGenerationError(
            f"fal generate: client error HTTP {status}",
            status_code=status,
            retryable=False,
        )

    try:
        body: object = response.json()
    except ValueError as exc:
        raise FalGenerationError(
            "fal generate: response was not valid JSON",
        ) from exc

    result_url = _parse_generation_response(body)

    _LOGGER.debug("fal generate complete model_id=%s", config.model_id)
    return result_url


# ---------------------------------------------------------------------------
# Step 3: download generated image
# ---------------------------------------------------------------------------


def _download_image(image_url: str, timeout: float) -> bytes:
    """Download the generated image and return raw bytes.

    Args:
        image_url: CDN URL returned by the generation step.
        timeout: Seconds budget.  Clipped to
            :data:`_DOWNLOAD_TIMEOUT_CEILING` internally.

    Returns:
        Non-empty raw image bytes.

    Raises:
        FalGenerationError: On HTTP errors, transport failures, or empty
            response body.
    """
    if timeout <= 0:
        raise FalGenerationError(
            "fal download: deadline exhausted before HTTP call",
            retryable=True,
        )

    effective_timeout = min(timeout, _DOWNLOAD_TIMEOUT_CEILING)

    try:
        with httpx.Client(timeout=effective_timeout) as client:
            response = client.get(image_url, headers={"Accept": "*/*"})
    except httpx.TimeoutException:
        raise FalGenerationError(
            "fal download: request timed out",
            retryable=True,
        ) from None
    except httpx.HTTPError as exc:
        raise FalGenerationError(
            f"fal download: transport error ({type(exc).__name__})",
            retryable=True,
        ) from None

    status = response.status_code
    if status == 429 or 500 <= status < 600:
        raise FalGenerationError(
            f"fal download: transient HTTP {status}",
            status_code=status,
            retryable=True,
        )
    if not (200 <= status < 300):
        raise FalGenerationError(
            f"fal download: unexpected HTTP {status}",
            status_code=status,
            retryable=False,
        )

    content = response.content
    if not content:
        raise FalGenerationError("fal download: CDN returned empty body")

    _LOGGER.debug("fal download complete downloaded_bytes=%d", len(content))
    return content


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_from_recipe(
    config: FalGenerationConfig,
    selfie_bytes: bytes,
    *,
    api_key: str,
    timeout: float = DEFAULT_TIMEOUT,
) -> bytes:
    """Generate an AI image from a recipe config and selfie within a hard timeout.

    Orchestrates the 3-step fal.ai HTTP flow:

      1. Upload ``selfie_bytes`` to fal.run storage → storage URL.
      2. POST to ``https://fal.run/{config.model_id}`` with the selfie
         URL, prompt, optional style reference, and parameters → CDN URL.
      3. GET the CDN URL → raw image bytes.

    The deadline is computed once at entry; each step receives the
    *remaining* budget (``deadline - now``) so a slow upload cannot allow
    the generation step to overrun the overall window.

    Args:
        config: Recipe-derived generation parameters.  The caller is
            responsible for resolving the prompt template and for
            converting any ``style_reference_key`` storage key to an
            accessible HTTP URL before constructing the config.
        selfie_bytes: Raw selfie image bytes (PNG or JPEG).  Must be
            non-empty; an empty payload is rejected immediately without
            any HTTP round-trip.
        api_key: fal.ai API key in ``"<key_id>:<key_secret>"`` format.
            Loaded server-side from the root ``.env`` via
            :mod:`image_edit.fal_ai_api_key`; never hard-coded, never
            logged, never sent to the mobile client.
        timeout: Total seconds budget for the entire 3-step flow.
            Defaults to :data:`DEFAULT_TIMEOUT` (30 s).  Each internal
            step clips its own budget to a per-phase ceiling so a slow
            upload cannot starve the generation step.

    Returns:
        Raw, non-empty bytes of the first generated image as delivered
        by fal.ai's CDN.  The format (PNG / JPEG / WebP) is whatever
        the fal.ai model returned — no re-encoding is applied here.

    Raises:
        ValueError: When ``selfie_bytes`` is empty or not bytes-like.
        FalGenerationError: On any HTTP or parsing failure.

            * ``retryable=True`` for transient failures (HTTP 429, 5xx,
              timeouts, transport errors).  The outer pipeline *may* retry
              within the 30 s budget using the elapsed time consumed so
              far to recompute the remaining window.
            * ``retryable=False`` for permanent failures (HTTP 4xx
              excluding 429, malformed response).  Retry would produce the
              same outcome; surface as a generation error to the user.
    """
    if not isinstance(selfie_bytes, (bytes, bytearray)):
        raise ValueError(
            f"selfie_bytes must be bytes-like, got {type(selfie_bytes).__name__}"
        )
    if not selfie_bytes:
        raise ValueError("selfie_bytes must not be empty")

    deadline = time.monotonic() + timeout

    # --- Step 1: upload selfie ---
    selfie_url = _upload_selfie(
        bytes(selfie_bytes),
        api_key,
        deadline - time.monotonic(),
    )

    # --- Step 2: call the model ---
    result_url = _call_model(
        config,
        selfie_url,
        api_key,
        deadline - time.monotonic(),
    )

    # --- Step 3: download result ---
    return _download_image(result_url, deadline - time.monotonic())


__all__ = [
    "DEFAULT_TIMEOUT",
    "FalGenerationConfig",
    "FalGenerationError",
    "generate_from_recipe",
]
