"""Tests for the Fal.ai img2img request-builder helper (Sub-AC 4.1).

# What this file pins down

:func:`image_edit.fal_ai_vendor_caller._build_img2img_payload` is the
*pure* function that translates ``(image_url, prompt, params)`` into the
JSON dict the adapter POSTs to ``fal-ai/flux/dev/image-to-image``. This
file pins:

  * The exact JSON field names Fal documents (``image_url``, ``prompt``,
    ``strength``, ``guidance_scale``, ``num_inference_steps``).
  * The default values — sourced from :mod:`image_edit.fal_ai_defaults`,
    NOT re-declared as magic numbers in the builder.
  * The override allowlist: only the three calibrated FLUX knobs may be
    overridden via :attr:`VendorRequest.params`; every other key in
    ``params`` is silently ignored so the vendor-agnostic ``params``
    slot can carry foreign fields without poisoning the Fal payload.
  * Override type validation: wrong-typed override values raise
    :class:`ValueError` (non-retryable, matches the upload-step error
    classification — a wrong ``params`` shape will fail identically on
    retry).
  * Purity: the function does no I/O, no logging, has no module-level
    side effects, and returns a freshly-allocated dict per call so the
    adapter never accidentally shares state across requests.

# Why a dedicated test file?

Sibling AC tests (``test_fal_ai_api_key.py``, ``test_fal_ai_defaults.py``,
``test_fal_ai_preset_to_prompt.py``, ``test_fal_ai_upload_step.py``)
intentionally scope themselves to a single concern. Keeping the
request-builder tests in their own file mirrors that structure and lets
Phase 4's FastAPI form-default reuse adopt the same builder without
disturbing tests written against the broader 3-step HTTP flow.

# Why pure-function tests (no httpx, no monkeypatch)?

The builder takes ``(str, str, Mapping | None)`` and returns a dict. It
never imports network code, never reads the environment, and never
allocates a logger record. Exercising it as a pure function — without
any transport mock — is the strongest possible isolation: a regression
that accidentally introduces I/O into the builder will fail to import
or run inside this file's tight ``timeout=0.05s`` budget.
"""

from __future__ import annotations

import json
import logging
from types import MappingProxyType
from typing import Any, Final

import pytest

from image_edit.fal_ai_defaults import (
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_NUM_INFERENCE_STEPS,
    DEFAULT_STRENGTH,
)
from image_edit.fal_ai_vendor_caller import (
    _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE,
    _FAL_IMG2IMG_FIELD_IMAGE_URL,
    _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS,
    _FAL_IMG2IMG_FIELD_PROMPT,
    _FAL_IMG2IMG_FIELD_STRENGTH,
    _FAL_IMG2IMG_OVERRIDABLE_FIELDS,
    _build_img2img_payload,
)

# ---------------------------------------------------------------------------
# Fixtures / canonical inputs
# ---------------------------------------------------------------------------
#
# Distinctive enough that an accidental leak into a log or an exception
# message would be obvious in test output. We deliberately do NOT reuse
# the upload-step's ``_FAKE_UPLOAD_URL`` — these tests live in their own
# file so they cannot share that fixture, and inlining the constant
# locally keeps the failure message readable.
_FAKE_IMAGE_URL: Final[str] = "https://v3.fal.media/files/fake/builder-test-input.png"
_FAKE_PROMPT: Final[str] = (
    "spring warm-tone personal-color makeup styling: builder test prompt"
)


# ---------------------------------------------------------------------------
# Default-payload shape
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_builder_returns_dict_with_all_five_documented_fields() -> None:
    """The payload carries exactly the 5 documented Fal img2img fields."""
    payload = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)

    assert isinstance(payload, dict)
    # Exactly the documented field set — no more (extra keys could leak
    # adapter-internal state to Fal) and no fewer (missing keys would
    # surface as a 4xx at request time, costing a round-trip).
    assert set(payload.keys()) == {
        _FAL_IMG2IMG_FIELD_IMAGE_URL,
        _FAL_IMG2IMG_FIELD_PROMPT,
        _FAL_IMG2IMG_FIELD_STRENGTH,
        _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE,
        _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS,
    }


@pytest.mark.unit
def test_builder_field_names_match_fal_documented_contract() -> None:
    """The five field-name constants match Fal's documented JSON schema."""
    # Pin the literal strings so a refactor cannot silently rename a key.
    # The constants are documented in Fal's REST schema for
    # ``fal-ai/flux/dev/image-to-image``; drifting any of them would
    # invalidate the live API contract.
    assert _FAL_IMG2IMG_FIELD_IMAGE_URL == "image_url"
    assert _FAL_IMG2IMG_FIELD_PROMPT == "prompt"
    assert _FAL_IMG2IMG_FIELD_STRENGTH == "strength"
    assert _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE == "guidance_scale"
    assert _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS == "num_inference_steps"


@pytest.mark.unit
def test_builder_includes_image_url_verbatim() -> None:
    """The ``image_url`` field carries the upload-step output unchanged."""
    payload = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    assert payload[_FAL_IMG2IMG_FIELD_IMAGE_URL] == _FAKE_IMAGE_URL
    # And specifically as a ``str`` — Fal rejects non-string image_url
    # bodies and we must not silently coerce.
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_IMAGE_URL], str)


@pytest.mark.unit
def test_builder_includes_prompt_verbatim() -> None:
    """The ``prompt`` field carries the resolved preset prompt unchanged."""
    payload = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    assert payload[_FAL_IMG2IMG_FIELD_PROMPT] == _FAKE_PROMPT
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_PROMPT], str)


@pytest.mark.unit
def test_builder_defaults_come_from_fal_ai_defaults_module() -> None:
    """The three FLUX-knob defaults route through the calibration module."""
    payload = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)

    # Identity-style equality on the constants — if the calibration team
    # updates ``DEFAULT_STRENGTH`` in ``fal_ai_defaults.py``, this test
    # automatically tracks the new value. That's exactly the
    # "single source of truth" guarantee the dedicated defaults module
    # exists to provide.
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == DEFAULT_STRENGTH
    assert payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == DEFAULT_GUIDANCE_SCALE
    assert (
        payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == DEFAULT_NUM_INFERENCE_STEPS
    )


@pytest.mark.unit
def test_builder_default_field_types_are_json_primitives() -> None:
    """Defaults are plain JSON primitives — float/float/int."""
    payload = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)

    # Strength + guidance_scale are floats — both Fal-side and JSON-side.
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_STRENGTH], float)
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE], float)
    # num_inference_steps is an integer — fractional steps make no sense
    # to FLUX and Fal would 4xx them.
    steps = payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS]
    assert isinstance(steps, int) and not isinstance(steps, bool)


@pytest.mark.unit
def test_builder_payload_is_json_serialisable() -> None:
    """The returned dict round-trips through ``json.dumps`` unchanged."""
    payload = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    encoded = json.dumps(payload)
    decoded = json.loads(encoded)
    assert decoded == payload


# ---------------------------------------------------------------------------
# Override allowlist
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_builder_overridable_allowlist_is_exactly_the_three_flux_knobs() -> None:
    """Only ``strength`` / ``guidance_scale`` / ``num_inference_steps``."""
    # Pin the allowlist so adding a fourth overridable key requires an
    # explicit test update — that's the right friction for a contract
    # surface.
    assert _FAL_IMG2IMG_OVERRIDABLE_FIELDS == frozenset(
        {
            _FAL_IMG2IMG_FIELD_STRENGTH,
            _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE,
            _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS,
        }
    )
    # Crucially: ``image_url`` and ``prompt`` are NOT overridable via
    # ``params`` — they come from the upload step and the preset
    # mapping respectively. Letting ``params`` override them would let
    # a caller smuggle arbitrary prompts past the closed preset enum.
    assert _FAL_IMG2IMG_FIELD_IMAGE_URL not in _FAL_IMG2IMG_OVERRIDABLE_FIELDS
    assert _FAL_IMG2IMG_FIELD_PROMPT not in _FAL_IMG2IMG_OVERRIDABLE_FIELDS


@pytest.mark.unit
def test_builder_with_none_params_returns_defaults() -> None:
    """``params=None`` is the explicit "use defaults" signal."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT, params=None
    )
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == DEFAULT_STRENGTH
    assert payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == DEFAULT_GUIDANCE_SCALE
    assert (
        payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == DEFAULT_NUM_INFERENCE_STEPS
    )


@pytest.mark.unit
def test_builder_with_empty_params_returns_defaults() -> None:
    """An empty ``params={}`` is equivalent to ``params=None``."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT, params={}
    )
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == DEFAULT_STRENGTH
    assert payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == DEFAULT_GUIDANCE_SCALE
    assert (
        payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == DEFAULT_NUM_INFERENCE_STEPS
    )


@pytest.mark.unit
def test_builder_honours_strength_override() -> None:
    """A ``strength`` override replaces the default and is coerced to float."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL,
        prompt=_FAKE_PROMPT,
        params={_FAL_IMG2IMG_FIELD_STRENGTH: 0.42},
    )
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == pytest.approx(0.42)
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_STRENGTH], float)
    # Untouched defaults stay put.
    assert payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == DEFAULT_GUIDANCE_SCALE
    assert (
        payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == DEFAULT_NUM_INFERENCE_STEPS
    )


@pytest.mark.unit
def test_builder_honours_guidance_scale_override() -> None:
    """A ``guidance_scale`` override replaces the default."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL,
        prompt=_FAKE_PROMPT,
        params={_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE: 6.0},
    )
    assert payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == pytest.approx(6.0)
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE], float)


@pytest.mark.unit
def test_builder_honours_num_inference_steps_override() -> None:
    """A ``num_inference_steps`` override replaces the default."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL,
        prompt=_FAKE_PROMPT,
        params={_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS: 50},
    )
    assert payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == 50
    steps = payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS]
    assert isinstance(steps, int) and not isinstance(steps, bool)


@pytest.mark.unit
def test_builder_honours_all_three_overrides_simultaneously() -> None:
    """All three FLUX knobs can be overridden in a single call."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL,
        prompt=_FAKE_PROMPT,
        params={
            _FAL_IMG2IMG_FIELD_STRENGTH: 0.1,
            _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE: 7.5,
            _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS: 12,
        },
    )
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == pytest.approx(0.1)
    assert payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == pytest.approx(7.5)
    assert payload[_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS] == 12


@pytest.mark.unit
def test_builder_coerces_int_strength_override_to_float() -> None:
    """An integer ``strength`` override is normalised to float."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL,
        prompt=_FAKE_PROMPT,
        params={_FAL_IMG2IMG_FIELD_STRENGTH: 1},
    )
    # JSON-side: both ``1`` and ``1.0`` are accepted by Fal, but we want
    # the payload to be unambiguous in tests + DEBUG logs, so we always
    # encode floats as floats.
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == 1.0
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_STRENGTH], float)


@pytest.mark.unit
def test_builder_coerces_int_guidance_scale_override_to_float() -> None:
    """An integer ``guidance_scale`` override is normalised to float."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL,
        prompt=_FAKE_PROMPT,
        params={_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE: 4},
    )
    assert payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE] == 4.0
    assert isinstance(payload[_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE], float)


@pytest.mark.unit
def test_builder_ignores_unknown_params_keys() -> None:
    """Keys outside the allowlist are silently dropped, not forwarded."""
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL,
        prompt=_FAKE_PROMPT,
        params={
            # Fake "foreign" keys a sibling adapter might use. They must
            # not appear in the Fal payload — Fal would 4xx on unknown
            # fields if its server tightened its schema validation.
            "num_outputs": 4,
            "seed": 12345,
            # Even a key with a Fal-looking name but spelled wrong gets
            # dropped. Drift catcher: if someone renames the constant
            # they will see the override stop taking effect.
            "Strength": 0.1,
            "image_URL": "https://nope",
        },
    )
    # The default ``strength`` survives because ``"Strength"`` is not in
    # the (case-sensitive) allowlist.
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == DEFAULT_STRENGTH
    # The image_url is whatever the builder was given — definitely NOT
    # the smuggled ``"image_URL"`` value.
    assert payload[_FAL_IMG2IMG_FIELD_IMAGE_URL] == _FAKE_IMAGE_URL
    # And no foreign keys made it into the final dict.
    assert "num_outputs" not in payload
    assert "seed" not in payload
    assert "Strength" not in payload
    assert "image_URL" not in payload


@pytest.mark.unit
def test_builder_accepts_mappingproxy_params() -> None:
    """The ``params`` argument accepts any read-only ``Mapping``."""
    # ``VendorRequest.__post_init__`` snapshots params into a dict, but
    # an alternative implementation might pass a ``MappingProxyType``;
    # the builder must accept any Mapping, not just ``dict``.
    proxy = MappingProxyType({_FAL_IMG2IMG_FIELD_STRENGTH: 0.6})
    payload = _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT, params=proxy
    )
    assert payload[_FAL_IMG2IMG_FIELD_STRENGTH] == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# Override type validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad_value",
    [
        "0.5",  # string, not number
        None,
        [0.5],
        {"value": 0.5},
        b"0.5",
    ],
)
def test_builder_rejects_non_numeric_strength(bad_value: Any) -> None:
    """A non-numeric ``strength`` override raises ``ValueError``."""
    with pytest.raises(ValueError, match="strength"):
        _build_img2img_payload(
            image_url=_FAKE_IMAGE_URL,
            prompt=_FAKE_PROMPT,
            params={_FAL_IMG2IMG_FIELD_STRENGTH: bad_value},
        )


@pytest.mark.unit
@pytest.mark.parametrize("bad_value", [True, False])
def test_builder_rejects_bool_strength(bad_value: bool) -> None:
    """``bool`` is not a valid ``strength`` (subclass of int trap)."""
    # ``isinstance(True, int)`` is True in Python — without the
    # explicit ``bool`` rejection, ``True`` would silently become 1.0
    # and ``False`` would become 0.0 (passthrough). The builder must
    # treat both as caller bugs.
    with pytest.raises(ValueError, match="strength"):
        _build_img2img_payload(
            image_url=_FAKE_IMAGE_URL,
            prompt=_FAKE_PROMPT,
            params={_FAL_IMG2IMG_FIELD_STRENGTH: bad_value},
        )


@pytest.mark.unit
@pytest.mark.parametrize("bad_value", ["3.5", None, [3.5], True, False])
def test_builder_rejects_bad_guidance_scale(bad_value: Any) -> None:
    """A wrong-typed ``guidance_scale`` raises ``ValueError``."""
    with pytest.raises(ValueError, match="guidance_scale"):
        _build_img2img_payload(
            image_url=_FAKE_IMAGE_URL,
            prompt=_FAKE_PROMPT,
            params={_FAL_IMG2IMG_FIELD_GUIDANCE_SCALE: bad_value},
        )


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad_value",
    [
        # Floats are rejected even when integral — the contract is int.
        28.0,
        0.5,
        "28",
        None,
        [28],
        True,
        False,
    ],
)
def test_builder_rejects_bad_num_inference_steps(bad_value: Any) -> None:
    """A wrong-typed ``num_inference_steps`` raises ``ValueError``."""
    with pytest.raises(ValueError, match="num_inference_steps"):
        _build_img2img_payload(
            image_url=_FAKE_IMAGE_URL,
            prompt=_FAKE_PROMPT,
            params={_FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS: bad_value},
        )


@pytest.mark.unit
def test_builder_error_message_names_offending_key() -> None:
    """``ValueError`` messages name the failing key for operator diagnosis."""
    with pytest.raises(ValueError) as exc_info:
        _build_img2img_payload(
            image_url=_FAKE_IMAGE_URL,
            prompt=_FAKE_PROMPT,
            params={_FAL_IMG2IMG_FIELD_STRENGTH: "not-a-number"},
        )
    message = str(exc_info.value)
    assert _FAL_IMG2IMG_FIELD_STRENGTH in message
    # And the observed type name, so the operator does not have to
    # ``repr()`` the params to figure out what went wrong.
    assert "str" in message


# ---------------------------------------------------------------------------
# Purity / determinism
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_builder_returns_fresh_dict_each_call() -> None:
    """Each call yields a freshly allocated dict — no shared state."""
    first = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    second = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    assert first == second
    assert first is not second, (
        "builder must allocate a new dict per call so a caller's "
        "in-place mutation cannot leak into a sibling request"
    )


@pytest.mark.unit
def test_builder_caller_can_mutate_returned_dict_without_side_effects() -> None:
    """Mutating one returned dict must not affect a subsequent call."""
    first = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    first["adapter_internal_debug"] = "scratch"
    first[_FAL_IMG2IMG_FIELD_STRENGTH] = 0.01

    second = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    assert "adapter_internal_debug" not in second
    assert second[_FAL_IMG2IMG_FIELD_STRENGTH] == DEFAULT_STRENGTH


@pytest.mark.unit
def test_builder_does_not_mutate_params_argument() -> None:
    """Override params dict survives the call unchanged."""
    params: dict[str, object] = {
        _FAL_IMG2IMG_FIELD_STRENGTH: 0.7,
        "unknown_key": "must-be-preserved-in-caller-dict",
    }
    snapshot = dict(params)

    _build_img2img_payload(
        image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT, params=params
    )

    assert params == snapshot, (
        "builder must not mutate the caller's params Mapping — "
        "VendorRequest.params is treated as immutable input"
    )


@pytest.mark.unit
def test_builder_emits_no_log_records(caplog: pytest.LogCaptureFixture) -> None:
    """The builder is silent — logging belongs to the surrounding HTTP step."""
    # Capture at the lowest level on the adapter's logger; the builder
    # must produce zero records regardless of inputs.
    with caplog.at_level(logging.DEBUG, logger="image_edit.fal_ai_vendor_caller"):
        _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
        _build_img2img_payload(
            image_url=_FAKE_IMAGE_URL,
            prompt=_FAKE_PROMPT,
            params={_FAL_IMG2IMG_FIELD_STRENGTH: 0.5},
        )
        with pytest.raises(ValueError):
            _build_img2img_payload(
                image_url=_FAKE_IMAGE_URL,
                prompt=_FAKE_PROMPT,
                params={_FAL_IMG2IMG_FIELD_STRENGTH: "bad"},
            )
    assert caplog.records == [], (
        "builder must not log — logging is the HTTP step's responsibility "
        "and emitting from a pure function would defeat the Seed Contract's "
        "redaction discipline"
    )


@pytest.mark.unit
def test_builder_payload_is_serialised_with_documented_field_names() -> None:
    """``json.dumps`` emits the exact Fal-documented field names."""
    payload = _build_img2img_payload(image_url=_FAKE_IMAGE_URL, prompt=_FAKE_PROMPT)
    encoded = json.dumps(payload)
    # Each documented key must appear in the encoded JSON literally
    # (as a quoted string), so the over-the-wire body uses the exact
    # contract names.
    for field in (
        _FAL_IMG2IMG_FIELD_IMAGE_URL,
        _FAL_IMG2IMG_FIELD_PROMPT,
        _FAL_IMG2IMG_FIELD_STRENGTH,
        _FAL_IMG2IMG_FIELD_GUIDANCE_SCALE,
        _FAL_IMG2IMG_FIELD_NUM_INFERENCE_STEPS,
    ):
        assert (
            f'"{field}"' in encoded
        ), f"serialised payload missing documented field {field!r}: {encoded}"
