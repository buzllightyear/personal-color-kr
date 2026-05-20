"""Fal.ai concrete vendor adapter (Seed Contract AC 10).

This module provides :class:`FalAiVendorCaller`, the concrete
``VendorCaller`` Protocol implementation that wires
``fal-ai/flux/dev/image-to-image`` calls into the existing
``image_edit`` subsystem.

# Why a dedicated adapter

The ``image_edit`` package was designed (sub-AC 9.1) around a stable
*Protocol* boundary so each commoditised vendor — Nano Banana,
Replicate, Fal.ai — can be plugged in as a drop-in callable without
mutating the shared retry / timeout / latency machinery. This file is
the Fal.ai-specific half of that contract.

# Boundary contract (AC 1)

The adapter satisfies the ``VendorCaller`` ``Protocol`` exactly:

    ``__call__(self, request: VendorRequest, attempt_timeout: float) -> bytes``

  * **Input**: an immutable, pre-validated :class:`VendorRequest`
    carrying ``selfie_bytes`` plus an opaque ``params`` mapping. The
    adapter does NOT re-validate — :meth:`VendorRequest.__post_init__`
    is the single validation site (per Seed Contract constraint).
  * **Output**: raw, downloaded ``bytes`` of the edited image. No
    JSON, no dicts, no metadata — the bytes-in / bytes-out contract
    is enforced at this layer so Fal-specific response shapes never
    leak past the adapter (allowlist PII strategy).
  * **Errors**: transient failures (HTTP 429 / 5xx, network reset,
    timeouts) MUST surface as :class:`VendorError` so the existing
    ``edit_image`` retry loop can absorb them. Non-retryable failures
    (HTTP 4xx, missing key, schema mismatch) MUST raise a different
    exception so the retry loop short-circuits.

# 3-step HTTP encapsulation

The Fal.ai img2img surface is not a single endpoint:

  1. Upload the selfie bytes to fal storage → temporary HTTP URL.
  2. POST ``fal-ai/flux/dev/image-to-image`` with that URL plus the
     resolved prompt → CDN URL pointing at the edited image.
  3. Download the CDN URL → raw edited bytes.

All three steps are encapsulated inside :meth:`__call__` so the
caller still sees a single ``bytes → bytes`` operation that fits the
existing Protocol shape unchanged.

# Thread safety

Instances are stateless after ``__init__`` (only the immutable
``api_key`` plus configuration constants are stored). Concurrent
invocations from multiple threads share no mutable state, so the
adapter is safe to inject as a singleton into the existing
``edit_image`` wrapper.

# Security

  * ``FAL_API_KEY`` is loaded *exclusively* from the server-side
    ``.env`` via :mod:`config.env` (sibling AC). It never appears in
    log statements, exception messages, or the response payload.
  * The mobile bundle (``apps/mobile/src/config/vendor-keys.ts``)
    INTENTIONALLY does not contain a ``falApiKey`` field — the key
    must never leave the Python process.
  * The adapter strips the Fal.ai JSON response down to
    ``images[0].url`` only; the remaining response body is discarded
    before any caller can observe it.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Final, Mapping

import httpx

from .fal_ai_defaults import (
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_NUM_INFERENCE_STEPS,
    DEFAULT_STRENGTH,
)
from .vendor_client import VendorError, VendorRequest

# ---------------------------------------------------------------------------
# Logger
# ---------------------------------------------------------------------------
#
# Module-level logger anchored on ``__name__`` so log records are tagged with
# the dotted import path (``image_edit.fal_ai_vendor_caller``). Operators can
# filter on that prefix to surface DEBUG breadcrumbs for the 3-step Fal.ai
# flow without having to set the root logger to DEBUG.
#
# The logger is silent unless the parent application opts into DEBUG level —
# matching the Seed Contract's observability principle of "log breadcrumbs at
# DEBUG, never at INFO+ where they could be persisted to disk without
# operator awareness". The redaction discipline (no FAL_API_KEY value, no
# upload URL, no CDN URL) is enforced by *what we log*, not by a custom
# filter, because adding a redaction filter would create a second code path
# where a regression could silently re-leak the secret.
_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level Fal.ai constants
# ---------------------------------------------------------------------------
#
# NOTE: The model-parameter defaults, the preset → prompt mapping, and
# the ``FAL_API_KEY`` loader live in sibling sections of this module
# and are populated by sibling tasks of the same orchestration.
# Anchoring them at module scope (rather than inside the class) keeps
# them ``Final`` for type-checkers and trivially importable from tests
# that want to assert "the adapter actually used the documented
# defaults".

#: Fal.ai img2img endpoint. The synchronous variant — no queue
#: polling, no webhook — keeps the adapter shape inside the 25s budget
#: established by ``DEFAULT_TIMEOUT_SECONDS``.
_FAL_IMG2IMG_URL: Final[str] = "https://fal.run/fal-ai/flux/dev/image-to-image"

#: Fal.ai temporary-storage upload endpoint. Returns a short-lived
#: HTTP URL that the img2img endpoint can dereference; Fal.ai's
#: server-side TTL handles cleanup so the adapter does NOT issue an
#: explicit delete call (per Seed Contract constraint).
_FAL_STORAGE_UPLOAD_URL: Final[str] = "https://fal.run/storage/upload"

#: Multipart form-data field name the upload endpoint expects for the
#: selfie payload. Pinned as a Final constant — rather than inlined as a
#: literal string in the upload method — so tests can assert on the exact
#: field shape without re-declaring the magic string and silently
#: drifting if the contract is ever tuned.
_FAL_STORAGE_UPLOAD_FIELD: Final[str] = "file"

#: JSON response key that carries the temporary HTTP URL returned by the
#: storage upload endpoint. The adapter discards every other field in
#: the response (allowlist PII strategy per the Seed Contract): only
#: this one string crosses the layer boundary, and even then it never
#: reaches the caller — it is fed directly into the img2img request and
#: never logged.
_FAL_STORAGE_RESPONSE_URL_KEY: Final[str] = "url"

#: Per-phase timeout floor (seconds) for the upload step. The 25s
#: end-to-end budget in :data:`vendor_client.DEFAULT_TIMEOUT_SECONDS`
#: decomposes as upload (3s) + edit (15s) + download (3s) + margin (4s);
#: this floor enforces the 3s ceiling so a slow ``.env``-misconfigured
#: vendor cannot silently consume the budget reserved for the edit step.
#: The actual per-call timeout is always ``min(attempt_remaining, floor)``
#: so a tight retry-loop budget still wins over the floor.
_FAL_UPLOAD_TIMEOUT_CEILING_SECONDS: Final[float] = 3.0

#: Per-phase timeout floor (seconds) for the img2img edit step. The 25s
#: end-to-end budget decomposes as upload (3s) + edit (15s) + download
#: (3s) + margin (4s); this ceiling pins the 15s share that the edit
#: step may consume. As with the upload ceiling, the actual per-call
#: timeout is ``min(attempt_remaining, ceiling)`` so a tight retry-loop
#: budget always wins.
_FAL_IMG2IMG_TIMEOUT_CEILING_SECONDS: Final[float] = 15.0

#: Per-phase timeout floor (seconds) for the download step. The 25s
#: end-to-end budget decomposes as upload (3s) + edit (15s) + download
#: (3s) + margin (4s); this ceiling pins the 3s share that the download
#: of the CDN-hosted edited image may consume. As with the other phase
#: ceilings, the actual per-call timeout is ``min(attempt_remaining,
#: ceiling)`` so a tight retry-loop budget always wins. The 3s budget is
#: appropriate because the only payload moving over this leg is a single
#: edited image whose size is bounded by FLUX's 1024×1024 default — well
#: under a megabyte even when re-encoded as PNG, and typically delivered
#: via a CDN edge close to the caller.
_FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS: Final[float] = 3.0

#: JSON response key carrying the array of generated images returned by
#: the ``fal-ai/flux/dev/image-to-image`` endpoint. The adapter reads
#: only this single field (and only its first element's ``url``) — every
#: other key in the response is discarded before any caller can observe
#: it (allowlist PII strategy per the Seed Contract).
_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: Final[str] = "images"

#: JSON key (inside each entry of the ``images`` array) carrying the
#: CDN URL of a generated image. Pinned as a Final constant so tests
#: can assert on the exact field shape without re-declaring the magic
#: string. Note: this key name happens to coincide with
#: :data:`_FAL_STORAGE_RESPONSE_URL_KEY` ("url"), but they live in
#: structurally different positions of two distinct response bodies —
#: pinning each one separately documents that intent and survives a
#: future contract change to either endpoint.
_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: Final[str] = "url"

# ---------------------------------------------------------------------------
# img2img request-builder field names (Sub-AC 4.1)
# ---------------------------------------------------------------------------
#
# # Why field-name constants?
#
# The ``fal-ai/flux/dev/image-to-image`` endpoint accepts a JSON body
# whose keys are part of Fal's public contract. Pinning each key as a
# ``Final[str]`` constant — rather than inlining the string literals
# inside :func:`_build_img2img_payload` — gives us three things:
#
#   1. **A single point of drift.** If Fal renames ``num_inference_steps``
#      to ``steps`` tomorrow, exactly one binding moves. Without the
#      constants the same magic string would be repeated across the
#      builder, the override-allowlist check, and every test assertion.
#   2. **Importable by tests.** ``test_fal_ai_request_builder.py`` can
#      ``from ... import _FAL_IMG2IMG_FIELD_STRENGTH`` and assert on the
#      built payload without re-declaring the magic string — so a test
#      cannot silently keep passing after the contract changes.
#   3. **Tooling-visible.** ``Final`` annotations let mypy ``--strict``
#      narrow these to literal string types, which lets downstream
#      ``TypedDict`` consumers (Phase 4 FastAPI form) match on them.
#
# The values mirror Fal's documented FLUX img2img request schema as of
# the orchestration date. They are intentionally lowercase + snake-case
# because that is what the JSON body must literally contain.

#: Fal img2img JSON field carrying the source-image HTTP URL returned by
#: the storage upload step.
_FAL_IMG2IMG_FIELD_IMAGE_URL: Final[str] = "image_url"

#: Fal img2img JSON field carrying the resolved FLUX prompt — i.e. the
#: value :data:`_PRESET_TO_PROMPT` returns for the user's diagnosed
#: season preset.
_FAL_IMG2IMG_FIELD_PROMPT: Final[str] = "prompt"

#: Fal img2img JSON field controlling how aggressively FLUX rewrites the
#: input image (0.0 passthrough … 1.0 full re-synthesis). Defaults to
#: :data:`DEFAULT_STRENGTH`; may be overridden per call via
#: :attr:`VendorRequest.params`.
_FAL_IMG2IMG_FIELD_STRENGTH: Final[str] = "strength"

#: Fal img2img JSON field controlling classifier-free guidance. Defaults
#: to :data:`DEFAULT_GUIDANCE_SCALE`; may be overridden per call.
_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE: Final[str] = "guidance_scale"

#: Fal img2img JSON field controlling FLUX denoising steps per
#: generation. Defaults to :data:`DEFAULT_NUM_INFERENCE_STEPS`; may be
#: overridden per call.
_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS: Final[str] = "num_inference_steps"

#: The closed allowlist of :attr:`VendorRequest.params` keys this adapter
#: forwards into the img2img payload. Any other key in ``params`` is
#: silently ignored — the Mapping slot is shared across vendors and may
#: legitimately carry keys this adapter does not understand (e.g. a
#: future Replicate-only ``num_outputs`` field). Discarding unknown keys
#: matches the same allowlist-PII discipline that applies to vendor
#: response bodies on the way out.
_FAL_IMG2IMG_OVERRIDABLE_FIELDS: Final[frozenset[str]] = frozenset(
    {
        _FAL_IMG2IMG_FIELD_STRENGTH,
        _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE,
        _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS,
    }
)


def _build_img2img_payload(
    *,
    image_url: str,
    prompt: str,
    params: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Build the JSON body for ``fal-ai/flux/dev/image-to-image``.

    Sub-AC 4.1 of the Fal.ai adapter. Pure function — no I/O, no
    logging, no exception chaining onto a transport. Given the upload
    step's resolved ``image_url`` and the preset-resolved ``prompt``,
    returns the dict that :meth:`FalAiVendorCaller.__call__` will JSON-
    encode and POST to :data:`_FAL_IMG2IMG_URL`.

    # Why a dedicated builder?

    Splitting the request construction out of :meth:`__call__` is the
    only way to test the payload shape without touching the network at
    all. The 3-step HTTP flow inside ``__call__`` is integration-shaped
    (timeouts, retries, mock transports); the request builder is the
    one piece of that flow that is genuinely *pure*. Keeping it pure
    makes Phase 4's FastAPI form-default reuse trivial — the form
    handler will compute the same dict from the same inputs without
    pulling in ``httpx`` or any adapter state.

    # Default sourcing

    The three FLUX-tuning knobs default to the values published by the
    sibling :mod:`image_edit.fal_ai_defaults` module — that is the
    single source of truth for the personal-color calibration. The
    builder never re-defines the magic numbers; importing them keeps
    the defaults auditable in exactly one place.

    # Override policy

    Callers may pass a :class:`Mapping` (typically
    :attr:`VendorRequest.params`) carrying per-call overrides. The
    builder honours only the keys named in
    :data:`_FAL_IMG2IMG_OVERRIDABLE_FIELDS` — every other key is
    silently discarded so that the shared ``params`` slot can carry
    vendor-agnostic flags without poisoning the Fal payload. Override
    values are *type-checked*: a wrong-shape value (``bool`` where a
    number is expected, ``str`` where an ``int`` is expected) raises
    :class:`ValueError`. That is the right exception class for the
    outer retry loop because:

      * The contract was wrong at construction time — retrying with
        the same ``params`` would fail identically.
      * ``ValueError`` is the same class that
        :meth:`VendorRequest.__post_init__` raises for malformed
        input, so the calling pipeline already knows how to surface
        it as a user-facing error.

    Notably we do *not* range-check (e.g. strength ∈ [0.0, 1.0]) — Fal
    will return a 4xx if a number is out of range, which the upload-
    step error classifier already converts into a non-retryable
    :class:`ValueError`. Re-implementing Fal's validation locally would
    only drift when Fal tunes its accepted ranges.

    Args:
        image_url: The temporary HTTP URL returned by the storage
            upload step. Must already be a non-empty string; this is
            a tight internal contract (the upload step rejects an
            empty / non-string response) so we trust it verbatim.
        prompt: The FLUX prompt resolved from
            :data:`_PRESET_TO_PROMPT` for the user's diagnosed
            season preset. Must already be a non-empty string by the
            same logic — the preset → prompt mapping is closed at
            import time.
        params: Optional overrides for the three documented FLUX
            knobs (``strength``, ``guidance_scale``,
            ``num_inference_steps``). ``None`` (the default) means
            "use the calibrated defaults verbatim". Unknown keys are
            ignored.

    Returns:
        A fresh ``dict`` ready for JSON serialisation. The builder
        never returns a cached or shared mapping — each call yields a
        new object so callers can mutate the returned dict (e.g. to
        slot in adapter-internal debug fields) without race risk.
        The dict is structurally a ``dict[str, str | float | int]``
        but typed as ``dict[str, object]`` because :class:`Mapping`
        carries ``object`` values and we do not want to force every
        downstream caller into a ``cast``.

    Raises:
        ValueError: When an override value carried by ``params`` has
            the wrong type — e.g. ``params["strength"] = "max"`` or
            ``params["num_inference_steps"] = 28.5``. The message
            names the offending key and the observed type so the
            operator can fix the call site.
    """
    # Start from the calibrated defaults. Every field is materialised
    # eagerly so the return type is a complete, JSON-ready payload —
    # there is no "partial dict" state a caller could observe.
    payload: dict[str, object] = {
        _FAL_IMG2IMG_FIELD_IMAGE_URL: image_url,
        _FAL_IMG2IMG_FIELD_PROMPT: prompt,
        _FAL_IMG2IMG_FIELD_STRENGTH: DEFAULT_STRENGTH,
        _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE: DEFAULT_GUIDANCE_SCALE,
        _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS: DEFAULT_NUM_INFERENCE_STEPS,
    }

    if params is None:
        return payload

    # ----- strength override -----
    if _FAL_IMG2IMG_FIELD_STRENGTH in params:
        raw = params[_FAL_IMG2IMG_FIELD_STRENGTH]
        # ``bool`` is a subclass of ``int`` in Python, so we reject it
        # explicitly: True/False slipping in as 1.0/0.0 is almost
        # certainly a caller bug, not a deliberate calibration choice.
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError(
                "fal img2img: params["
                f"{_FAL_IMG2IMG_FIELD_STRENGTH!r}] must be a number, "
                f"got {type(raw).__name__}"
            )
        # Normalise ``int`` → ``float`` so the JSON payload always
        # encodes ``strength`` as a JSON number with a fractional part
        # rather than an integer literal. Both are accepted by Fal but
        # tests can assert on the float shape unambiguously.
        payload[_FAL_IMG2IMG_FIELD_STRENGTH] = float(raw)

    # ----- guidance_scale override -----
    if _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE in params:
        raw = params[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE]
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError(
                "fal img2img: params["
                f"{_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE!r}] must be a number, "
                f"got {type(raw).__name__}"
            )
        payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] = float(raw)

    # ----- num_inference_steps override -----
    if _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS in params:
        raw = params[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS]
        # Steps are integral by Fal's contract — accept ``int`` only.
        # ``bool`` is again rejected explicitly because ``True`` would
        # otherwise pass the ``int`` check and silently become 1 step.
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise ValueError(
                "fal img2img: params["
                f"{_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS!r}] must be an int, "
                f"got {type(raw).__name__}"
            )
        payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] = raw

    return payload


# ---------------------------------------------------------------------------
# img2img response parser (Sub-AC 4.3)
# ---------------------------------------------------------------------------
#
# # Why a dedicated parser?
#
# The Fal.ai ``fal-ai/flux/dev/image-to-image`` endpoint returns a JSON
# object with many fields — ``images`` (list of generated images),
# ``seed``, ``has_nsfw_concepts``, ``prompt`` (echoed), ``request_id``,
# ``timings``, ``inference_time``, etc. The Seed Contract's allowlist-PII
# strategy demands that *exactly one* value crosses the layer boundary:
# the CDN URL at ``images[0].url``. Every other field — request IDs,
# seeds, echoed prompts, model metadata — is discarded *before* any
# caller can observe it.
#
# Splitting the response parser out of :meth:`_post_img2img_request` (the
# HTTP round-trip) is the only way to test the allowlist discipline
# without involving httpx, the Authorization header, the network, or the
# timeout budget. The HTTP step is integration-shaped (timeouts, retries,
# mock transports); the parser is the one piece of the edit step that is
# genuinely *pure*. Keeping it pure makes Phase 4's FastAPI form-default
# reuse trivial — the form handler can pre-validate cached responses
# without pulling in ``httpx`` or any adapter state.
#
# # Error classification contract
#
# Every contract violation surfaces as :class:`ValueError`. That is
# deliberate and matches the rest of the edit step's classification:
#   * The outer ``edit_image`` retry loop only retries
#     :class:`VendorError`, so any failure raised from a parsed-but-
#     malformed response will short-circuit immediately. Retrying a
#     server that returned a response missing the ``images`` field will
#     produce the same malformed response, so retry is pointless.
#   * :class:`ValueError` is the same class :meth:`VendorRequest.__post_init__`
#     and :func:`_build_img2img_payload` raise, so the calling pipeline
#     already knows how to surface it as a non-retryable client-side
#     error.
#
# # Redaction discipline
#
# The exception messages emitted by this parser deliberately do NOT echo
# the offending value — only the *name* of the missing/wrong field.
# Echoing the value would risk leaking the API key (if a misroute
# returned an echo of the request), the storage URL (if Fal echoes
# ``image_url``), or fragments of the user's selfie metadata. Naming the
# field is enough for an operator to diagnose; reproducing the value is
# not.


def _parse_img2img_response(body: object) -> str:
    """Extract ``images[0].url`` from a parsed FLUX img2img response.

    Sub-AC 4.3 of the Fal.ai adapter. Pure function — no I/O, no
    logging, no exception chaining onto a transport, no module-level
    side effects. Given the already-decoded JSON body of a successful
    ``fal-ai/flux/dev/image-to-image`` 200 response, returns the
    single string that crosses the layer boundary into the download
    step.

    # Why ``object`` for the input?

    The caller (:meth:`FalAiVendorCaller._post_img2img_request`) decodes
    the response via ``httpx.Response.json()``, which returns ``Any``.
    Typing this parameter as ``object`` forces every downstream check
    to go through ``isinstance`` — there is no static guarantee that
    the wire payload conforms to Fal's schema. The strict typing is
    intentional: ``mypy --strict`` flags any unchecked attribute
    access, which is the right discipline for code that translates
    untrusted vendor JSON into a typed string.

    # Allowlist discipline

    The parser walks exactly two levels (``body["images"][0]["url"]``)
    and returns *only* the URL string. Every other key in the body —
    ``seed``, ``request_id``, ``has_nsfw_concepts``, echoed ``prompt``,
    model version, timings — is implicitly discarded by virtue of
    never being read. A regression that started reading any of those
    fields would need to widen the function's signature, making the
    leak visible at the type level.

    # No URL validation

    The function does NOT validate the *shape* of the returned URL —
    no scheme check, no host allowlist, no length cap. The Fal CDN
    contract is opaque; pinning a host pattern locally would only
    drift the moment Fal rotates its delivery layer. The download
    step (Step 3, sibling AC) is the right layer to enforce a "https
    only" or "no localhost" policy because that is where the URL is
    actually dereferenced.

    Args:
        body: The decoded JSON body of a 200 response from the FLUX
            img2img endpoint. Typically a ``dict`` (because that's
            what :func:`json.loads` returns for an object), but typed
            as ``object`` so the function correctly rejects any wire
            shape that is not a JSON object — e.g. a JSON array
            (``[]``), a bare string, or ``null``.

    Returns:
        The non-empty ``str`` CDN URL at ``body["images"][0]["url"]``.
        The string is returned verbatim — no whitespace stripping, no
        case normalisation — because the URL is opaque to the
        adapter and must be dereferenced exactly as Fal returned it.

    Raises:
        ValueError: On any of the following contract violations,
            each with a precise message naming only the offending
            field (never the offending value):

              * ``body`` is not a JSON object (Mapping).
              * ``body["images"]`` is missing, not a list, or empty.
              * ``body["images"][0]`` is not a JSON object.
              * ``body["images"][0]["url"]`` is missing, not a
                string, or empty.

            All four are *permanent* contract violations: retrying
            the same request would produce the same malformed
            response. The outer ``edit_image`` retry loop only
            retries :class:`VendorError`, so raising ``ValueError``
            short-circuits the loop immediately and surfaces the
            failure to the operator.
    """
    # ----- top-level shape -----
    # Reject everything that is not a JSON object up-front. A JSON
    # array body (``[]``) would otherwise pass the ``Mapping.get``
    # call below as ``AttributeError`` — a confusing exception class
    # for the retry loop. Forcing ``isinstance`` gives a precise,
    # non-retryable error class.
    if not isinstance(body, Mapping):
        raise ValueError("fal img2img: response was not a JSON object")

    # ----- images array -----
    # Fal's documented schema returns a JSON array of objects, each
    # with a ``url`` field. We require a non-empty list and a Mapping
    # entry at index 0 — anything else is a contract violation the
    # download step cannot recover from.
    images = body.get(_FAL_IMG2IMG_RESPONSE_IMAGES_KEY)
    if not isinstance(images, list) or len(images) == 0:
        raise ValueError(
            f"fal img2img: response missing non-empty "
            f"{_FAL_IMG2IMG_RESPONSE_IMAGES_KEY!r} array"
        )

    # ----- first image entry -----
    # We deliberately read only ``images[0]`` — Fal returns ``num_outputs``
    # entries when the caller asks for multiples, but the adapter's
    # contract is "one selfie in → one edited selfie out". A future AC
    # that adds multi-output support must widen the return type
    # explicitly; silently picking the first of N would hide that
    # contract change.
    first = images[0]
    if not isinstance(first, Mapping):
        raise ValueError(
            f"fal img2img: response "
            f"{_FAL_IMG2IMG_RESPONSE_IMAGES_KEY!r}[0] was not a JSON object"
        )

    # ----- url field (the one allowlisted value) -----
    # An empty string is rejected explicitly. ``urllib.parse.urlparse('')``
    # would happily produce a "valid" but useless URL, so we close that
    # path here rather than waiting for the download step to fail with
    # an opaque transport error.
    result_url = first.get(_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY)
    if not isinstance(result_url, str) or not result_url:
        raise ValueError(
            f"fal img2img: response "
            f"{_FAL_IMG2IMG_RESPONSE_IMAGES_KEY!r}[0] missing required "
            f"{_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY!r} string field"
        )

    return result_url


# ---------------------------------------------------------------------------
# Season preset → FLUX prompt mapping (AC 6)
# ---------------------------------------------------------------------------
#
# # Why a closed mapping
#
# The Seed Contract pins personal-color diagnosis to a *closed* enum of
# four seasons (spring-warm / summer-cool / autumn-warm / winter-cool).
# Translating that domain enum into a FLUX prompt is the one Fal.ai-
# specific concern that the rest of the diagnosis pipeline must not see —
# the upstream classifier emits ``"spring-warm"`` and downstream callers
# expect edited bytes; the prompt vocabulary is private to this adapter.
#
# # Why module-scope ``Final[Mapping[str, str]]``
#
#   * ``Final`` tells mypy ``--strict`` that the binding is never
#     rebound, so the test suite can rely on identity (``is``) checks
#     when asserting the mapping is a single source of truth.
#   * Module scope (not class scope, not function scope) means the dict
#     is built once at import time. A future refactor that re-builds
#     the dict per call would silently regress on allocation overhead
#     and break referential identity tests.
#   * ``Mapping[str, str]`` (read-only Protocol) discourages callers
#     from mutating the dict in place. Python cannot statically enforce
#     this without a third-party frozen-dict, but the type annotation
#     signals intent and ``mypy --strict`` rejects mutation through
#     this binding.
#
# # Prompt design intent
#
# Each prompt:
#   * names the season explicitly (so a future debug log of the prompt
#     stays human-readable without needing a lookup table),
#   * names the season's temperature (warm / cool) — the dimension that
#     drives the actual color palette transformation in FLUX,
#   * is phrased as a *makeup / styling* directive so FLUX img2img
#     applies the change to the subject rather than the background.
#
# These prompts are intentionally English: Fal.ai's FLUX models are
# trained predominantly on English captions, and the diagnosis
# pipeline's Korean season names are translated here as the single
# point of language crossing.
_PRESET_TO_PROMPT: Final[Mapping[str, str]] = {
    "spring-warm": (
        "spring warm-tone personal-color makeup styling: bright, clear, "
        "peach and coral tones with golden undertones, fresh and "
        "luminous complexion, soft warm highlights"
    ),
    "summer-cool": (
        "summer cool-tone personal-color makeup styling: soft, muted "
        "rose, lavender, and dusty pink tones with cool blue undertones, "
        "delicate and airy complexion, gentle cool highlights"
    ),
    "autumn-warm": (
        "autumn warm-tone personal-color makeup styling: deep, muted "
        "terracotta, mustard, and warm brown tones with golden olive "
        "undertones, rich and earthy complexion, warm bronze highlights"
    ),
    "winter-cool": (
        "winter cool-tone personal-color makeup styling: bold, deep "
        "jewel tones with crisp cool blue undertones, high contrast, "
        "clear and porcelain complexion, sharp cool highlights"
    ),
}


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class FalAiVendorCaller:
    """Concrete ``VendorCaller`` adapter for Fal.ai FLUX img2img.

    Implements the ``VendorCaller`` Protocol declared in
    :mod:`image_edit.vendor_client` so an instance can be passed
    directly as the ``vendor_caller=`` keyword argument of
    :func:`image_edit.edit_image`.

    The Protocol contract is intentionally narrow: ``__call__`` takes
    a validated ``VendorRequest`` plus an attempt timeout budget and
    returns raw edited ``bytes``. This adapter encapsulates the
    3-step Fal HTTP flow (upload → edit → download) so the caller
    never observes Fal-specific URLs, JSON shapes, or storage tokens.

    Instances are stateless after ``__init__``. The only stored
    fields are immutable configuration values (API key,
    pre-computed Authorization header). No per-call buffer, no
    in-flight handle, no cached client state — concurrent invocations
    from multiple threads cannot corrupt each other.

    Args:
        api_key: The ``<key_id>:<key_secret>`` credential issued by
            https://fal.ai/dashboard/keys. Loaded server-side from
            the root ``.env`` via :mod:`config.env`. Must NEVER be
            hard-coded and must NEVER appear in the mobile bundle.

    Raises:
        ValueError: when ``api_key`` is missing, empty, or not a
            string. Eager validation at construction time means an
            operator who forgets to populate ``.env`` sees a precise
            error before any HTTP round-trip.
    """

    __slots__ = ("_api_key", "_authorization_header")

    def __init__(self, *, api_key: str) -> None:
        if not isinstance(api_key, str):
            raise TypeError(f"api_key must be a string, got {type(api_key).__name__}")
        if not api_key:
            raise ValueError("api_key must be a non-empty string")

        # Pre-build the Authorization header once at construction so
        # the hot path (``__call__``) does no string formatting per
        # attempt. The literal ``"Key "`` prefix matches Fal.ai's
        # documented auth contract (smoke_fal.py uses the same scheme).
        # Stored on ``__slots__`` to prevent accidental attribute
        # injection by callers — the adapter is meant to be opaque.
        self._api_key: str = api_key
        self._authorization_header: str = f"Key {api_key}"

    # ------------------------------------------------------------------
    # Step 1 of 3: upload selfie bytes to Fal storage (AC 3)
    # ------------------------------------------------------------------
    def _upload_selfie_to_storage(self, selfie_bytes: bytes, timeout: float) -> str:
        """Upload ``selfie_bytes`` to Fal storage and return its URL.

        Step 1 of the 3-step Fal.ai img2img flow. Encapsulates the
        ``POST https://fal.run/storage/upload`` round-trip so callers
        (the adapter's own :meth:`__call__`) deal only with a single
        ``bytes → str`` operation.

        The upload contract:

          * ``multipart/form-data`` body with a single ``file`` field
            carrying the raw selfie bytes (PNG / JPEG, validated upstream
            by :meth:`VendorRequest.__post_init__`).
          * ``Authorization: Key <api_key>`` header taken from the
            pre-computed value built in :meth:`__init__` — no per-call
            string formatting, no risk of accidentally logging the
            interpolated value.
          * ``Accept: application/json`` so Fal returns a structured
            response we can parse rather than HTML on misroute.

        On success, the adapter parses the JSON response, extracts only
        the ``url`` field (allowlist PII strategy), and returns that
        string. The remaining response fields — filename, size, mime
        type, etc. — are deliberately discarded so they cannot leak
        through the layer boundary or end up in a log line.

        Args:
            selfie_bytes: The raw image payload to upload. Treated as
                opaque bytes; this method does NOT re-validate (the
                ``VendorRequest`` boundary already did).
            timeout: Seconds remaining in the end-to-end budget at the
                moment this step starts. Clipped to
                :data:`_FAL_UPLOAD_TIMEOUT_CEILING_SECONDS` so the 3s
                upload budget cannot consume the slice reserved for
                the edit (15s) and download (3s) steps. ``timeout <= 0``
                is rejected up-front as :class:`VendorError` —
                "out of budget" is exactly the kind of transient signal
                the outer ``edit_image`` retry loop is designed to
                absorb (e.g. by giving up and surfacing
                :class:`VendorTimeoutError`).

        Returns:
            The temporary HTTP URL Fal storage returned. The URL is
            short-lived (server-side TTL handles cleanup; we do NOT
            issue an explicit delete) and is intended for immediate
            consumption by the img2img endpoint. The string is NOT
            logged at any level — see the security posture note in the
            module docstring.

        Raises:
            VendorError: HTTP 429 (rate limit), HTTP 5xx (server
                fault), network reset, DNS failure, or request timeout.
                Each of these is a *transient* condition the outer
                retry loop in :func:`vendor_client.edit_image` can
                absorb. Surfacing them as ``VendorError`` is what
                keeps that loop in charge of the retry policy — the
                adapter never decides "I'll retry myself".
            ValueError: HTTP 4xx (excluding 429), a JSON-decode failure,
                a missing ``url`` key, or a non-string ``url`` value.
                These signal a *permanent* problem (malformed request,
                broken contract) where retry is pointless; the outer
                loop will short-circuit because it only retries
                ``VendorError``.

        Thread safety:
            Reads only immutable state (``self._authorization_header``)
            and constructs a fresh :class:`httpx.Client` per call. No
            shared mutable buffer, no cached client handle —
            concurrent invocations from multiple threads cannot
            corrupt each other.

        Logging:
            Emits a single ``DEBUG`` breadcrumb at successful
            completion with ``elapsed_seconds`` and ``upload_bytes``
            (input payload length). The breadcrumb deliberately does
            NOT include the API key, the returned URL, or any HTTP
            header — those are the values the Seed Contract's
            redaction discipline pins as "never log under any
            circumstances".
        """
        # ----- eager budget check -----
        # ``edit_image`` already gates the call with ``remaining > 0``,
        # but the upload step's own ceiling is tighter (3s) and we want
        # a precise failure mode if a caller bypasses ``edit_image`` and
        # invokes the adapter directly with an exhausted budget.
        if timeout <= 0:
            raise VendorError("fal upload: attempt_timeout exhausted before HTTP call")

        # Clip to the per-phase ceiling so a long end-to-end budget
        # cannot starve the edit (15s) and download (3s) steps that run
        # after this one. The clipping is one-way (we never *extend* a
        # tight retry-loop deadline) — see Fal docstring above.
        effective_timeout = min(timeout, _FAL_UPLOAD_TIMEOUT_CEILING_SECONDS)

        upload_bytes = len(selfie_bytes)
        started_at = time.monotonic()

        # ----- build + send the request -----
        headers = {
            "Authorization": self._authorization_header,
            "Accept": "application/json",
        }
        # httpx's documented contract for in-memory multipart payloads:
        # the ``files`` parameter accepts ``{field: (filename, fileobj_or_bytes, mime)}``.
        # We pass the bytes directly (no on-disk temp file) so the upload
        # never touches the filesystem — the Seed Contract's "no implicit
        # resource cleanup" rule is satisfied trivially because there is
        # no file to clean up.
        files = {
            _FAL_STORAGE_UPLOAD_FIELD: (
                "selfie",
                selfie_bytes,
                "application/octet-stream",
            ),
        }

        try:
            # Fresh client per call so multi-threaded use is safe and so
            # the connection is closed promptly (no idle pool to drain).
            # The cost is minimal: httpx reuses the underlying transport
            # via the OS for the duration of the ``with`` block.
            with httpx.Client(timeout=effective_timeout) as client:
                response = client.post(
                    _FAL_STORAGE_UPLOAD_URL,
                    headers=headers,
                    files=files,
                )
        except httpx.TimeoutException:
            # Timeouts (connect, read, write, pool) are all transient —
            # the same retry that absorbs a 503 should absorb these.
            # Note the ``from None`` suppression: the underlying httpx
            # message can echo the URL, which would defeat the
            # "never log fal storage URLs" rule the moment a caller
            # ``logger.exception(...)``s the result.
            raise VendorError("fal upload: request timed out") from None
        except httpx.HTTPError as exc:
            # ConnectError / ReadError / NetworkError / RemoteProtocolError
            # all subclass ``httpx.HTTPError``. They are transient by
            # construction (the request never reached an HTTP status).
            # We deliberately ``from None`` for the same reason as above.
            raise VendorError(
                f"fal upload: transport error ({type(exc).__name__})"
            ) from None

        # ----- classify the HTTP status -----
        status = response.status_code
        if status == 429 or 500 <= status < 600:
            # Transient by contract: rate limit (429) or server fault
            # (5xx). Translate to ``VendorError`` so the outer retry
            # loop owns the backoff decision. We do NOT echo the
            # response body — it can contain ``x-fal-*`` tokens that
            # would be redaction targets if they reached a log line.
            raise VendorError(
                f"fal upload: transient HTTP {status} from storage endpoint"
            )
        if 400 <= status < 500:
            # 4xx (excluding 429) is a client error — malformed payload,
            # invalid API key, etc. Retrying cannot help; raise a
            # non-retryable exception so the outer loop short-circuits
            # immediately and the operator sees the failure fast.
            raise ValueError(
                f"fal upload: non-retryable HTTP {status} from storage endpoint"
            )
        if status < 200 or status >= 300:
            # 1xx / 3xx are unexpected on a POST to this endpoint
            # (Fal does not redirect storage uploads). Treat as a
            # contract violation — non-retryable.
            raise ValueError(
                f"fal upload: unexpected HTTP {status} from storage endpoint"
            )

        # ----- parse the response (allowlist) -----
        try:
            payload: Any = response.json()
        except ValueError as exc:
            # ``response.json()`` raises ``ValueError`` (a JSONDecodeError
            # subclass) on malformed JSON. That's already the correct
            # exception class for "non-retryable contract mismatch", so
            # we re-raise with a clearer message and explicitly chain
            # for debugging while keeping the original value out of
            # the message (it could contain anything).
            raise ValueError(
                "fal upload: storage endpoint returned non-JSON body"
            ) from exc

        if not isinstance(payload, Mapping):
            raise ValueError("fal upload: storage response was not a JSON object")

        upload_url = payload.get(_FAL_STORAGE_RESPONSE_URL_KEY)
        if not isinstance(upload_url, str) or not upload_url:
            # Either the key is missing, the value is the wrong type, or
            # the value is an empty string. All three are contract
            # violations the img2img step cannot recover from.
            raise ValueError(
                f"fal upload: storage response missing required "
                f"{_FAL_STORAGE_RESPONSE_URL_KEY!r} string field"
            )

        elapsed = time.monotonic() - started_at

        # ----- DEBUG breadcrumb (no URL, no key) -----
        # ``elapsed`` and ``upload_bytes`` are operationally useful
        # without leaking anything sensitive: the bytes count is the
        # size of the input the caller already has, and elapsed is
        # observed latency. The URL we just received is deliberately
        # absent from the log payload.
        _LOGGER.debug(
            "fal upload phase complete elapsed=%.3fs upload_bytes=%d",
            elapsed,
            upload_bytes,
        )

        return upload_url

    # ------------------------------------------------------------------
    # Step 2 of 3: POST img2img request to Fal.ai FLUX endpoint (AC 4.2)
    # ------------------------------------------------------------------
    def _post_img2img_request(
        self,
        *,
        image_url: str,
        prompt: str,
        params: Mapping[str, object] | None,
        timeout: float,
    ) -> str:
        """POST the FLUX img2img request and return the CDN result URL.

        Step 2 of the 3-step Fal.ai img2img flow. Encapsulates the
        ``POST https://fal.run/fal-ai/flux/dev/image-to-image`` round-trip
        so callers (the adapter's own :meth:`__call__`) deal only with a
        single ``(image_url, prompt, params) → str`` operation.

        The img2img contract:

          * ``application/json`` body built by :func:`_build_img2img_payload`
            so the payload shape (5 documented fields, override allowlist,
            type validation) is unit-tested as a pure function alongside
            the HTTP round-trip tested here.
          * ``Authorization: Key <api_key>`` header taken from the
            pre-computed value built in :meth:`__init__` — no per-call
            string formatting, no risk of accidentally logging the
            interpolated value.
          * ``Accept: application/json`` so a Fal-side outage that
            returns HTML fails fast at the JSON-decode step rather than
            propagating an opaque blob downstream.

        On success the adapter parses the response, extracts only
        ``images[0].url`` (allowlist PII strategy), and returns that
        string. The remaining response fields — request IDs, model
        version, seed, NSFW flags, etc. — are deliberately discarded
        so they cannot leak through the layer boundary or end up in a
        log line.

        Args:
            image_url: The temporary Fal-storage URL returned by step 1
                (:meth:`_upload_selfie_to_storage`). Must already be a
                non-empty string; upstream step rejects empties.
            prompt: The FLUX prompt resolved from :data:`_PRESET_TO_PROMPT`
                for the user's diagnosed season preset. Must already be
                a non-empty string by the same logic — the preset →
                prompt mapping is closed at import time.
            params: Optional :class:`Mapping` from
                :attr:`VendorRequest.params` carrying per-call overrides
                for the three calibrated FLUX knobs. ``None`` (or any
                Mapping with no allowlisted keys) means "use defaults".
                Wrong-typed override values raise :class:`ValueError`
                via :func:`_build_img2img_payload` — that surfaces
                before the HTTP round-trip so a malformed call never
                wastes a Fal credit.
            timeout: Seconds remaining in the end-to-end budget at the
                moment this step starts. Clipped to
                :data:`_FAL_IMG2IMG_TIMEOUT_CEILING_SECONDS` so the
                15s edit budget cannot consume the slices reserved for
                upload (3s) and download (3s). ``timeout <= 0`` is
                rejected up-front as :class:`VendorError`.

        Returns:
            The CDN URL Fal returned in ``images[0].url``. The URL is
            short-lived (Fal CDN's TTL handles cleanup) and is intended
            for immediate consumption by the download step. The string
            is NOT logged at any level — see the security posture note
            in the module docstring.

        Raises:
            VendorError: HTTP 429 (rate limit), HTTP 5xx (server
                fault), network reset, DNS failure, or request timeout.
                Each is a transient condition the outer
                :func:`vendor_client.edit_image` retry loop can absorb.
            ValueError: HTTP 4xx (excluding 429), wrong-typed override
                in ``params``, a JSON-decode failure, a missing
                ``images`` array, an empty ``images`` array, a non-
                Mapping ``images[0]``, a missing ``url`` key, or a
                non-string / empty ``url`` value. All signal a
                permanent contract violation where retry is pointless;
                the outer loop will short-circuit because it only
                retries :class:`VendorError`.

        Thread safety:
            Reads only immutable state (``self._authorization_header``)
            and constructs a fresh :class:`httpx.Client` per call. No
            shared mutable buffer, no cached client handle —
            concurrent invocations from multiple threads cannot
            corrupt each other.

        Logging:
            Emits a single ``DEBUG`` breadcrumb at successful
            completion with ``elapsed_seconds``. The breadcrumb
            deliberately does NOT include the API key, the request /
            response payloads, the source image URL, or the returned
            CDN URL — those are the values the Seed Contract's
            redaction discipline pins as "never log under any
            circumstances".
        """
        # ----- eager budget check -----
        # Same shape as the upload step's pre-flight: a caller that
        # bypasses ``edit_image`` and invokes the adapter directly with
        # an exhausted budget must see a precise failure mode rather
        # than a confusing httpx error.
        if timeout <= 0:
            raise VendorError("fal img2img: attempt_timeout exhausted before HTTP call")

        # Clip to the per-phase ceiling so a long end-to-end budget
        # cannot starve the upload (3s) and download (3s) steps that
        # bracket this one. The clipping is one-way (we never *extend*
        # a tight retry-loop deadline).
        effective_timeout = min(timeout, _FAL_IMG2IMG_TIMEOUT_CEILING_SECONDS)

        # ----- build the payload (pure, no I/O) -----
        # _build_img2img_payload raises ``ValueError`` on wrong-typed
        # overrides; we let it propagate untouched because that's
        # exactly the non-retryable signal the outer loop wants. The
        # call happens BEFORE the budget timer kicks in so a malformed
        # ``params`` mapping never wastes the operator's clock-time
        # window or a Fal credit.
        payload = _build_img2img_payload(
            image_url=image_url,
            prompt=prompt,
            params=params,
        )

        started_at = time.monotonic()

        # ----- build + send the request -----
        headers = {
            "Authorization": self._authorization_header,
            "Accept": "application/json",
            # Content-Type for the JSON body is set automatically by
            # ``httpx`` when ``json=`` is used, so we deliberately do
            # NOT set it here — letting httpx own that header avoids
            # the "two sources of truth" trap where a typo in our
            # value would silently override the SDK's correct one.
        }

        try:
            # Fresh client per call so multi-threaded use is safe and
            # so the connection is closed promptly (no idle pool to
            # drain). The fresh-per-call pattern matches the upload
            # step and is the reason the adapter is genuinely
            # stateless after ``__init__``.
            with httpx.Client(timeout=effective_timeout) as client:
                response = client.post(
                    _FAL_IMG2IMG_URL,
                    headers=headers,
                    json=payload,
                )
        except httpx.TimeoutException:
            # Same posture as the upload step: timeouts are transient,
            # the outer retry loop is the right owner of "give up or
            # try again". ``from None`` suppresses the underlying
            # httpx message which can echo the request URL — that
            # would defeat the "never log fal storage URLs" rule the
            # moment a caller ``logger.exception(...)``s the result.
            raise VendorError("fal img2img: request timed out") from None
        except httpx.HTTPError as exc:
            # ConnectError / ReadError / NetworkError /
            # RemoteProtocolError all subclass ``httpx.HTTPError`` and
            # are transient by construction (the request never
            # reached an HTTP status).
            raise VendorError(
                f"fal img2img: transport error ({type(exc).__name__})"
            ) from None

        # ----- classify the HTTP status -----
        status = response.status_code
        if status == 429 or 500 <= status < 600:
            # Transient: rate limit (429) or server fault (5xx). The
            # response body is deliberately NOT echoed — it can carry
            # ``x-fal-*`` request IDs that would be redaction targets
            # if they reached a log line.
            raise VendorError(
                f"fal img2img: transient HTTP {status} from img2img endpoint"
            )
        if 400 <= status < 500:
            # 4xx (excluding 429) is a client error — malformed
            # payload, invalid API key, prompt rejected by Fal's
            # safety filter, etc. Retrying cannot help; raise a
            # non-retryable exception so the outer loop short-
            # circuits immediately and the operator sees the failure
            # fast.
            raise ValueError(
                f"fal img2img: non-retryable HTTP {status} from img2img endpoint"
            )
        if status < 200 or status >= 300:
            # 1xx / 3xx are unexpected on a POST to this endpoint
            # (Fal does not redirect img2img requests). Treat as a
            # contract violation — non-retryable.
            raise ValueError(
                f"fal img2img: unexpected HTTP {status} from img2img endpoint"
            )

        # ----- parse the response (allowlist) -----
        # The JSON-decode step lives here (not in the pure parser)
        # because ``httpx.Response.json()`` is the boundary between the
        # transport and the parsed payload. The pure
        # :func:`_parse_img2img_response` helper handles every shape
        # check downstream of a successful decode.
        try:
            body: Any = response.json()
        except ValueError as exc:
            # ``response.json()`` raises ``ValueError`` (JSONDecodeError
            # subclass) on malformed JSON. Already the correct class
            # for "non-retryable contract mismatch"; re-raise with a
            # cleaner message and explicitly chain for debugging while
            # keeping the original value out of the exception text (it
            # could contain anything).
            raise ValueError("fal img2img: endpoint returned non-JSON body") from exc

        # Delegate every structural check to the pure parser. Sub-AC 4.3
        # locks the allowlist discipline (only ``images[0].url`` escapes
        # the layer) inside a single, independently-testable function so
        # Phase 4's FastAPI form-default reuse can call the same helper
        # without dragging in ``httpx`` or any adapter state.
        result_url = _parse_img2img_response(body)

        elapsed = time.monotonic() - started_at

        # ----- DEBUG breadcrumb (no URL, no key, no payload) -----
        # ``elapsed`` is the only operationally useful value we can
        # safely emit. We deliberately do NOT log the input image_url
        # (Fal storage URL — Seed Contract forbids), the prompt (would
        # let an operator reconstruct the season preset from logs and
        # bypass the closed enum), the returned CDN URL, or any field
        # of the response body.
        _LOGGER.debug(
            "fal img2img phase complete elapsed=%.3fs",
            elapsed,
        )

        return result_url

    # ------------------------------------------------------------------
    # Step 3 of 3: download edited image from CDN URL (AC 5)
    # ------------------------------------------------------------------
    def _download_image_bytes(self, image_url: str, timeout: float) -> bytes:
        """Download the FLUX-edited image and return raw bytes.

        Step 3 of the 3-step Fal.ai img2img flow. Encapsulates the
        ``GET <cdn_url>`` round-trip so callers (the adapter's own
        :meth:`__call__`) deal only with a single ``str → bytes``
        operation. The CDN URL is the single allowlisted value that
        crossed the layer boundary from
        :meth:`_post_img2img_request`; this method dereferences it
        verbatim and discards every response field except the body.

        # The download contract

          * ``GET`` against the opaque CDN URL Fal returned in
            ``images[0].url``. The URL is signed / pre-authorised by
            Fal's CDN — the request deliberately does NOT carry an
            ``Authorization: Key <api_key>`` header. Sending the FAL
            credential to a CDN endpoint is *worse than useless*: the
            CDN almost certainly logs request headers, and pinning the
            key into a CDN access log would defeat the same
            "never log API key" rule the upload and edit steps already
            uphold inside this process.
          * ``Accept: */*`` so the CDN can deliver whichever encoding
            Fal chose for the generation (PNG / JPEG / WebP). The
            adapter's bytes-out contract is *opaque* — downstream
            consumers handle re-encoding if they need a specific
            format. Pinning ``Accept: image/png`` here would create a
            silent failure mode the moment Fal rotates to a different
            default container.
          * No follow-redirect override: we accept the httpx default
            (follow redirects = False). A CDN that 30x-redirects on a
            ``GET`` would be unusual; if it happens we fail fast as a
            non-retryable ``ValueError`` rather than silently re-route
            to an unaudited URL. This matches the upload + edit steps,
            both of which classify 3xx as ``ValueError``.

        # Allowlist discipline

        Only ``response.content`` (the raw bytes) crosses the layer
        boundary. Headers (which can contain CDN request IDs, edge
        node hostnames, signed-URL tokens), status code, and any
        framework metadata are deliberately discarded. The adapter's
        ``bytes`` return contract enforces this discipline at the type
        level — a regression that started returning a ``Response``
        object would surface as a type-check failure long before it
        could leak metadata to a caller.

        Args:
            image_url: The CDN URL returned by
                :meth:`_post_img2img_request`. Must already be a
                non-empty string; upstream parsing rejects empties.
            timeout: Seconds remaining in the end-to-end budget at the
                moment this step starts. Clipped to
                :data:`_FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS` so the
                3s download budget cannot consume the slice that
                would otherwise be reserved as the margin for retry-
                loop bookkeeping. ``timeout <= 0`` is rejected up-
                front as :class:`VendorError` — "out of budget" is
                exactly the kind of transient signal the outer
                ``edit_image`` retry loop is designed to absorb.

        Returns:
            The raw, non-empty bytes of the edited image as delivered
            by the CDN. The bytes are returned verbatim — no decoding,
            no re-encoding, no size cap — because the adapter's
            contract is "opaque bytes in, opaque bytes out".

        Raises:
            VendorError: HTTP 429 (rate limit — the CDN can rate-
                limit even though the edit step succeeded), HTTP 5xx
                (CDN fault), network reset, DNS failure, or request
                timeout. Each is a transient condition the outer
                :func:`vendor_client.edit_image` retry loop can
                absorb. Retrying re-runs the entire 3-step flow,
                because the CDN URL has a short TTL and the upload +
                edit URLs are not idempotent across retries — but the
                wrapper owns that decision, not this method.
            ValueError: HTTP 4xx (excluding 429), an unexpected
                redirect (3xx), or an empty 200 body. All signal a
                permanent contract violation where retry is
                pointless; the outer loop short-circuits because it
                only retries :class:`VendorError`.

        Thread safety:
            Reads only immutable state (none, in fact — this method
            does not touch ``self._api_key`` or
            ``self._authorization_header``) and constructs a fresh
            :class:`httpx.Client` per call. No shared mutable buffer,
            no cached client handle — concurrent invocations from
            multiple threads cannot corrupt each other.

        Logging:
            Emits a single ``DEBUG`` breadcrumb at successful
            completion with ``elapsed_seconds`` and
            ``downloaded_bytes`` (output payload length). The
            breadcrumb deliberately does NOT include the CDN URL,
            the API key (which is never sent), or any HTTP header —
            those are the values the Seed Contract's redaction
            discipline pins as "never log under any circumstances".
        """
        # ----- eager budget check -----
        # Same shape as the upload and edit steps: a caller that
        # bypasses ``edit_image`` and invokes the adapter directly with
        # an exhausted budget must see a precise failure mode rather
        # than a confusing httpx error.
        if timeout <= 0:
            raise VendorError(
                "fal download: attempt_timeout exhausted before HTTP call"
            )

        # Clip to the per-phase ceiling so a long end-to-end budget
        # cannot starve the retry-loop bookkeeping margin reserved
        # outside the 3-step flow. The clipping is one-way (we never
        # *extend* a tight retry-loop deadline) — see Fal docstring
        # above.
        effective_timeout = min(timeout, _FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS)

        started_at = time.monotonic()

        # ----- build + send the request -----
        # Deliberately NO ``Authorization`` header — the CDN URL is
        # already signed by Fal and sending the API key to a CDN
        # endpoint risks the key ending up in the CDN's access log.
        # ``Accept: */*`` so the CDN can deliver whichever encoding
        # FLUX produced.
        headers = {
            "Accept": "*/*",
        }

        try:
            # Fresh client per call so multi-threaded use is safe and
            # so the connection is closed promptly (no idle pool to
            # drain). The fresh-per-call pattern matches the upload
            # and edit steps and is the reason the adapter is
            # genuinely stateless after ``__init__``.
            with httpx.Client(timeout=effective_timeout) as client:
                response = client.get(image_url, headers=headers)
        except httpx.TimeoutException:
            # Timeouts (connect, read, write, pool) are all transient
            # — the same retry that absorbs a 503 should absorb
            # these. ``from None`` suppresses the underlying httpx
            # message which can echo the request URL: that would
            # defeat the "never log fal storage URLs" rule the moment
            # a caller ``logger.exception(...)``s the result.
            raise VendorError("fal download: request timed out") from None
        except httpx.HTTPError as exc:
            # ConnectError / ReadError / NetworkError /
            # RemoteProtocolError all subclass ``httpx.HTTPError`` and
            # are transient by construction (the request never
            # reached an HTTP status). ``from None`` for the same
            # redaction reason as above.
            raise VendorError(
                f"fal download: transport error ({type(exc).__name__})"
            ) from None

        # ----- classify the HTTP status -----
        status = response.status_code
        if status == 429 or 500 <= status < 600:
            # Transient: rate limit (429) or CDN fault (5xx). The
            # response body is deliberately NOT echoed — a CDN error
            # page can contain edge-node identifiers and request
            # tokens that would be redaction targets if they reached
            # a log line.
            raise VendorError(f"fal download: transient HTTP {status} from CDN")
        if 400 <= status < 500:
            # 4xx (excluding 429) is a client error — expired signed
            # URL, malformed request, etc. Retrying *this* GET
            # cannot help (the URL is already in our hand); the
            # outer retry loop will start over from step 1, which
            # generates a fresh CDN URL. Raise a non-retryable
            # ``ValueError`` so the *download* doesn't get retried
            # in isolation.
            raise ValueError(f"fal download: non-retryable HTTP {status} from CDN")
        if status < 200 or status >= 300:
            # 1xx / 3xx are unexpected on a CDN ``GET`` — Fal's CDN
            # serves the body directly without redirecting. Treat as
            # a contract violation — non-retryable.
            raise ValueError(f"fal download: unexpected HTTP {status} from CDN")

        # ----- materialise the body -----
        # ``response.content`` is the canonical sync accessor for the
        # full body bytes — httpx buffers it internally on
        # ``Response.read()`` (called implicitly here). No streaming
        # decoder is needed: the 3s phase ceiling already bounds how
        # large a body we can accept, and FLUX outputs at 1024×1024
        # fit comfortably under a megabyte.
        edited_bytes = response.content

        # An empty body cannot be a valid image — reject it as a
        # contract violation rather than letting the caller try (and
        # fail) to decode a zero-byte payload downstream.
        if not edited_bytes:
            raise ValueError("fal download: CDN returned empty body for edited image")

        downloaded_bytes = len(edited_bytes)
        elapsed = time.monotonic() - started_at

        # ----- DEBUG breadcrumb (no URL, no key, no body) -----
        # ``elapsed`` and ``downloaded_bytes`` are operationally
        # useful values that carry no leak risk: byte count is the
        # size of the payload we just received (the caller will
        # observe the same length immediately on return), elapsed
        # is observed latency. The CDN URL is deliberately absent
        # from the log payload — same discipline as the upload and
        # edit steps.
        _LOGGER.debug(
            "fal download phase complete elapsed=%.3fs downloaded_bytes=%d",
            elapsed,
            downloaded_bytes,
        )

        return edited_bytes

    # ------------------------------------------------------------------
    # Step 3 of 3 (Sub-AC 2.3): semantic alias `_download_result`
    # ------------------------------------------------------------------
    def _download_result(self, result_url: str, timeout: float) -> bytes:
        """Download the FLUX-edited image at ``result_url`` and return bytes.

        Sub-AC 2.3 of the Fal.ai adapter. This is a thin semantic alias
        for :meth:`_download_image_bytes` — both methods implement the
        same step 3 of the 3-step Fal.ai img2img flow (GET an opaque
        CDN URL, return raw image bytes) and are guaranteed to behave
        identically.

        # Why a second name?

        The 3-step Fal.ai flow has two natural vocabularies:

          * **Wire vocabulary** — "image bytes" is what you ``GET``
            from a CDN. :meth:`_download_image_bytes` was added in
            sibling AC 5 under this name because it pairs symmetrically
            with the upload step's ``_upload_selfie_to_storage``
            (selfie bytes → URL) and the edit step's
            ``_post_img2img_request`` (URL → URL).
          * **Domain vocabulary** — "result" is what the *caller* of
            the adapter is after: the final edited artefact, regardless
            of which encoding Fal happened to deliver. Sub-AC 2.3
            ships this name because the FastAPI form planned for
            Phase 4 will read better in code as
            ``adapter._download_result(url, budget)`` than the more
            mechanical ``_download_image_bytes(url, budget)``.

        Rather than rename the existing AC 5 method (which would
        break the 31 tests in ``test_fal_ai_download_step.py`` and
        sibling reviewers' mental model), this alias exposes the
        domain-friendly name as a one-line delegate. The contract,
        timeout discipline, error classification, redaction rules,
        thread-safety guarantees, and logging discipline are all
        inherited verbatim by virtue of the delegation — there is
        exactly one HTTP code path in this adapter, so a regression
        cannot accidentally diverge the two entry points.

        Args:
            result_url: The CDN URL returned by
                :meth:`_post_img2img_request` (i.e. the value the pure
                :func:`_parse_img2img_response` parser allowlisted out
                of ``images[0].url``). Must already be a non-empty
                string; upstream parsing rejects empties.
            timeout: Seconds remaining in the end-to-end budget at the
                moment this step starts. Clipped to
                :data:`_FAL_DOWNLOAD_TIMEOUT_CEILING_SECONDS` by the
                underlying implementation; ``timeout <= 0`` raises
                :class:`VendorError` before any HTTP attempt.

        Returns:
            Raw, non-empty edited-image ``bytes`` exactly as delivered
            by the CDN — no decoding, no re-encoding, no size cap.

        Raises:
            VendorError: On any transient failure (HTTP 429, 5xx,
                network reset, timeout, exhausted budget). Eligible
                for absorption by the outer ``edit_image`` retry loop.
            ValueError: On any permanent contract violation (HTTP 4xx
                excluding 429, unexpected 3xx, empty 200 body).
                Short-circuits the retry loop.

        See Also:
            :meth:`_download_image_bytes` — the underlying
            implementation. Both methods are fully interchangeable.
        """
        # Single-line delegation. Keeping it a literal one-liner
        # ensures there is no second code path that could silently
        # diverge from the AC 5 implementation if Fal's contract is
        # ever tuned.
        return self._download_image_bytes(result_url, timeout)

    def __call__(self, request: VendorRequest, attempt_timeout: float) -> bytes:
        """Execute the 3-step Fal.ai img2img flow synchronously.

        Args:
            request: Pre-validated :class:`VendorRequest`. The
                adapter relies on :meth:`VendorRequest.__post_init__`
                for input validation and does NOT re-validate.
            attempt_timeout: Remaining seconds in the end-to-end
                budget at the moment this attempt starts. Forwarded
                through to the underlying HTTP client so a slow Fal
                response cannot block past the deadline.

        Returns:
            Raw edited image bytes. The bytes-only return type is the
            allowlist boundary — no Fal JSON, no CDN URL, no
            metadata reaches the caller through this method.

        Raises:
            VendorError: HTTP 429 or 5xx, network reset, request
                timeout, or any transient failure. Eligible for retry
                by the outer ``edit_image`` loop.
            ValueError: HTTP 4xx (excluding 429), schema mismatch, or
                any non-retryable client error. Short-circuits the
                retry loop because retrying a malformed request is
                pointless.

        The implementation is supplied by the sibling AC tasks of
        the same orchestration which fill in the 3-step HTTP flow,
        preset → prompt resolution, model-param defaults, and PII
        allowlist parsing. This method's *signature* — and the
        ``bytes`` return contract — is locked in by this AC.
        """
        # The body is filled by sibling AC tasks. The ``raise`` keeps
        # the signature honest while preventing accidental "always
        # succeeds with empty bytes" production-path usage.
        raise NotImplementedError(
            "FalAiVendorCaller.__call__ body is supplied by sibling AC "
            "tasks (3-step HTTP flow, preset mapping, params, env). "
            "This AC (1/N) locks the Protocol-compliant signature."
        )
