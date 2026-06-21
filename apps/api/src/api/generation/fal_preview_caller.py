"""fal.ai recipe preview caller for the admin preview endpoint.

Provides :func:`call_fal_recipe_preview`, a synchronous function that POSTs
to a fal.ai model endpoint and returns the first generated image URL.
Designed to be run inside ``asyncio.to_thread`` from the async admin
preview endpoint so the event loop is not blocked during the HTTP call.

Security posture
----------------
* The fal.ai API key is passed in as a *parameter* rather than read
  directly here.  The caller (the admin router) is responsible for loading
  the key via the ``image_edit.fal_ai_api_key`` module from core-python
  (the single authorised key-loading surface per the Phase 4.1 AC12
  absence invariant).
* The key NEVER appears in log statements, exception messages, response
  payloads, or HTTP headers other than the ``Authorization`` field.
* This module does NOT reference the environment variable name used for
  the fal.ai API key — that string lives exclusively in core-python.

fal.ai REST contract
---------------------
The endpoint is ``POST https://fal.run/{model_id}`` where ``model_id``
comes from the recipe row (e.g. ``"fal-ai/flux/dev"``).

Minimal JSON payload::

    {
        "prompt": "<recipe.prompt_template>",
        "image_url": "<style_reference_url>",  # optional — omitted when None
        ...recipe.parameters...               # merged verbatim
    }

The response is expected to carry an ``"images"`` array; the first
element's ``"url"`` field is the only value returned.  All other response
fields are discarded (allowlist strategy).
"""

from __future__ import annotations

import logging
from typing import Any, Final

import httpx

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# Base URL for all fal.ai models served via the synchronous REST endpoint.
_FAL_RUN_BASE_URL: Final[str] = "https://fal.run"

# Allowlisted response field names.  Only these two cross the module
# boundary; every other key in the fal.ai response is silently discarded.
_IMAGES_KEY: Final[str] = "images"
_URL_KEY: Final[str] = "url"

# Default timeout (seconds) for a single preview call.  The preview is
# admin-only and not latency-sensitive for end-users, but 25 s is enough
# for FLUX-class models and matches the Phase 1 generation budget.
_DEFAULT_TIMEOUT: Final[float] = 25.0


class FalPreviewError(Exception):
    """Raised when the fal.ai preview call fails.

    Attributes
    ----------
    status_code:
        The HTTP status code from fal.ai, or ``None`` for transport-level
        errors (timeout, connection reset, DNS failure).
    retryable:
        ``True`` when the failure is transient (HTTP 429, 5xx, timeout)
        and the caller *may* retry.  ``False`` for permanent failures
        (HTTP 4xx excluding 429) where a retry with the same inputs would
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


def _parse_fal_response(body: object) -> str:
    """Extract ``images[0].url`` from a fal.ai model response.

    Pure function — no I/O, no logging, no module-level side effects.
    Every structural check lives here so the HTTP round-trip in
    :func:`call_fal_recipe_preview` can be tested independently of
    response parsing.

    Parameters
    ----------
    body:
        The decoded JSON body of a 200 response from the fal.ai model
        endpoint.  Typed as ``object`` to force explicit ``isinstance``
        checks and prevent accidental assumptions about the wire shape.

    Returns
    -------
    str
        The non-empty CDN URL at ``body["images"][0]["url"]``.

    Raises
    ------
    FalPreviewError
        On any structural violation (wrong type, missing key, empty
        string).  All violations are *permanent*: the same malformed
        response would arise on retry, so the caller should not retry.
    """
    if not isinstance(body, dict):
        raise FalPreviewError("fal preview: response was not a JSON object")

    images = body.get(_IMAGES_KEY)
    if not isinstance(images, list) or not images:
        raise FalPreviewError(
            f"fal preview: response missing non-empty {_IMAGES_KEY!r} array"
        )

    first = images[0]
    if not isinstance(first, dict):
        raise FalPreviewError(
            f"fal preview: {_IMAGES_KEY!r}[0] was not a JSON object"
        )

    url = first.get(_URL_KEY)
    if not isinstance(url, str) or not url:
        raise FalPreviewError(
            f"fal preview: {_IMAGES_KEY!r}[0] missing required {_URL_KEY!r} string"
        )

    return url


def call_fal_recipe_preview(
    *,
    model_id: str,
    prompt: str,
    style_reference_url: str | None = None,
    parameters: dict[str, Any] | None = None,
    api_key: str,
    timeout: float = _DEFAULT_TIMEOUT,
) -> str:
    """Call a fal.ai model and return the first output image URL.

    Synchronous.  Intended to be executed via ``asyncio.to_thread`` from
    the async admin preview endpoint so the event loop is never blocked
    during the HTTP call to fal.ai.

    The fal.ai request payload is built from the recipe fields as follows:

      * ``prompt`` is placed in the ``"prompt"`` field.
      * ``style_reference_url`` (when not ``None``) is placed in the
        ``"image_url"`` field, enabling img2img-capable models to use the
        recipe's style reference image.
      * All entries from ``parameters`` are merged into the payload so
        model-specific knobs (``num_inference_steps``, ``guidance_scale``,
        ``strength``, etc.) flow through verbatim.

    The response is expected to match the fal.ai standard shape::

        {"images": [{"url": "https://..."}], ...}

    Only ``images[0]["url"]`` crosses the module boundary; every other
    response field is discarded (allowlist strategy).

    Parameters
    ----------
    model_id:
        fal.ai model path, e.g. ``"fal-ai/flux/dev"`` or
        ``"fal-ai/flux-realism"``.  Combined with
        :data:`_FAL_RUN_BASE_URL` to form the request endpoint.
    prompt:
        The recipe's prompt string.  For a preview call this is typically
        the raw ``prompt_template`` from the recipe row; template variable
        expansion is the caller's responsibility.
    style_reference_url:
        Optional HTTP(S) URL for a style reference image.  When provided,
        passed to the model as ``"image_url"`` to support img2img-capable
        models.  ``None`` (default) omits the field entirely, producing a
        text-to-image request.
    parameters:
        Optional dict of model-specific parameters merged into the
        payload verbatim.  Unknown keys are forwarded as-is — the module
        does not validate or filter ``parameters`` because model contracts
        vary and validation is the caller's responsibility.
    api_key:
        The fal.ai API key (``"<key_id>:<key_secret>""`` format).  Used
        to build the ``Authorization: Key <api_key>`` header.  Never
        logged or included in exception messages.
    timeout:
        Total seconds budget for the HTTP call (default 25 s).

    Returns
    -------
    str
        The first generated image URL returned by fal.ai.

    Raises
    ------
    FalPreviewError
        On any HTTP or response-parsing failure.

        * ``retryable=True`` — HTTP 429, 5xx, or transport-level errors
          (timeout, connection reset).  The caller *may* retry.
        * ``retryable=False`` — HTTP 4xx (excluding 429) or structural
          response violations.  Retry is pointless.
        * ``status_code`` — the HTTP status code, or ``None`` for
          transport errors.
    """
    endpoint = f"{_FAL_RUN_BASE_URL}/{model_id}"

    # Build payload: prompt first, then optional style reference,
    # then model-specific parameters (so parameters can override defaults
    # if the recipe intentionally re-sets a field).
    payload: dict[str, Any] = {"prompt": prompt}
    if style_reference_url is not None:
        payload["image_url"] = style_reference_url
    if parameters:
        payload.update(parameters)

    headers = {
        "Authorization": f"Key {api_key}",
        "Accept": "application/json",
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(endpoint, headers=headers, json=payload)
    except httpx.TimeoutException:
        raise FalPreviewError(
            "fal preview: request timed out",
            retryable=True,
        ) from None
    except httpx.HTTPError as exc:
        raise FalPreviewError(
            f"fal preview: transport error ({type(exc).__name__})",
            retryable=True,
        ) from None

    status = response.status_code

    # Transient failures: rate limit (429) or server fault (5xx).
    if status == 429 or 500 <= status < 600:
        raise FalPreviewError(
            f"fal preview: transient HTTP {status}",
            status_code=status,
            retryable=True,
        )

    # Permanent client errors: malformed request, bad credentials, etc.
    if 400 <= status < 500:
        raise FalPreviewError(
            f"fal preview: client error HTTP {status}",
            status_code=status,
            retryable=False,
        )

    # Unexpected status (1xx, 3xx).
    if not (200 <= status < 300):
        raise FalPreviewError(
            f"fal preview: unexpected HTTP {status}",
            status_code=status,
            retryable=False,
        )

    try:
        body: object = response.json()
    except ValueError as exc:
        raise FalPreviewError(
            "fal preview: response body was not valid JSON",
        ) from exc

    image_url = _parse_fal_response(body)

    _LOGGER.debug(
        "fal preview complete model_id=%s",
        model_id,
    )

    return image_url


__all__ = [
    "FalPreviewError",
    "call_fal_recipe_preview",
]
