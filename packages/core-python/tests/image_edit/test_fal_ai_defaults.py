"""Unit tests for the FLUX img2img default model parameters.

These tests pin three properties the FalAiVendorCaller adapter depends on:

  1. The constants exist at module scope (no function-scope shadowing).
  2. Their numeric values fall inside the documented ranges Fal accepts.
  3. They are typed `Final` so mypy strict mode catches accidental rebinds.

Coverage:
  - test_strength_is_module_scope_and_in_range
  - test_guidance_scale_is_module_scope_and_in_range
  - test_num_inference_steps_is_module_scope_and_in_range
  - test_all_three_constants_are_final_annotated
  - test_constants_are_exported_via_dunder_all
  - test_constants_are_importable_from_module
"""

from __future__ import annotations

import typing
from typing import Final, get_type_hints

import pytest

from image_edit import fal_ai_defaults
from image_edit.fal_ai_defaults import (
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_NUM_INFERENCE_STEPS,
    DEFAULT_STRENGTH,
)

# ---------------------------------------------------------------------------
# Value range tests
# ---------------------------------------------------------------------------


def test_strength_is_module_scope_and_in_range() -> None:
    # FLUX img2img strength accepts 0.0–1.0. 0.0 is a passthrough (no edit)
    # and 1.0 discards the input entirely; neither is useful for
    # personal-color editing, so we exclude both endpoints.
    assert isinstance(DEFAULT_STRENGTH, float)
    assert 0.0 < DEFAULT_STRENGTH < 1.0


def test_guidance_scale_is_module_scope_and_in_range() -> None:
    # Fal's documented range for guidance_scale is 0–20. The usable band
    # for FLUX is ~2.5 – ~5.0; anything outside that produces either an
    # under-prompted or over-saturated result. We assert the wider 0–20
    # contract here so the test does not over-fit to today's calibration
    # choice (which may legitimately change without breaking the contract).
    assert isinstance(DEFAULT_GUIDANCE_SCALE, float)
    assert 0.0 <= DEFAULT_GUIDANCE_SCALE <= 20.0


def test_num_inference_steps_is_module_scope_and_in_range() -> None:
    # Fal caps num_inference_steps at 50 and rejects values below 1.
    # `bool` is a subclass of `int` in Python — exclude it explicitly so
    # an accidental `True` literal does not pass this type check.
    assert isinstance(DEFAULT_NUM_INFERENCE_STEPS, int)
    assert not isinstance(DEFAULT_NUM_INFERENCE_STEPS, bool)
    assert 1 <= DEFAULT_NUM_INFERENCE_STEPS <= 50


# ---------------------------------------------------------------------------
# Final-annotation tests
# ---------------------------------------------------------------------------


def test_all_three_constants_are_final_annotated() -> None:
    """Pin the `Final` type annotation on every default.

    Without `Final`, a downstream module could re-bind these and silently
    drift the calibration baseline. `typing.get_type_hints(..., include_extras=
    True)` resolves the forward-ref `Final[float]` annotations to the
    actual `typing.Final` special form, which we then assert on.
    """
    hints = get_type_hints(fal_ai_defaults, include_extras=True)
    for name in (
        "DEFAULT_STRENGTH",
        "DEFAULT_GUIDANCE_SCALE",
        "DEFAULT_NUM_INFERENCE_STEPS",
    ):
        assert name in hints, f"{name} must carry a type annotation"
        origin = typing.get_origin(hints[name])
        # `Final[float]` → origin is `typing.Final`. Plain `float` → origin
        # is `None`. Use that to distinguish.
        assert origin is Final, (
            f"{name} must be annotated `Final[...]` to prevent rebinds; "
            f"got {hints[name]!r}"
        )


# ---------------------------------------------------------------------------
# Export-surface tests
# ---------------------------------------------------------------------------


def test_constants_are_exported_via_dunder_all() -> None:
    # `__all__` is the documented public surface. Anything not listed is
    # implicitly private even if not name-mangled, so callers downstream
    # of `from image_edit.fal_ai_defaults import *` get only the intended
    # three names.
    assert set(fal_ai_defaults.__all__) == {
        "DEFAULT_STRENGTH",
        "DEFAULT_GUIDANCE_SCALE",
        "DEFAULT_NUM_INFERENCE_STEPS",
    }


def test_constants_are_importable_from_module() -> None:
    # Belt-and-braces: confirm direct attribute access works in addition
    # to the `from … import …` form already exercised at the top of this
    # file. Catches the failure mode where a sibling refactor accidentally
    # deletes a constant but leaves `__all__` intact.
    assert hasattr(fal_ai_defaults, "DEFAULT_STRENGTH")
    assert hasattr(fal_ai_defaults, "DEFAULT_GUIDANCE_SCALE")
    assert hasattr(fal_ai_defaults, "DEFAULT_NUM_INFERENCE_STEPS")


# ---------------------------------------------------------------------------
# Immutability smoke
# ---------------------------------------------------------------------------


def test_constants_round_trip_through_json_cleanly() -> None:
    """Round-trip the three values through JSON.

    The Fal HTTP call payload is JSON-serialised, so any non-JSON-friendly
    type (e.g. `Decimal`, `numpy.float64`) would fail at request time —
    catch that here instead.
    """
    import json

    payload = {
        "strength": DEFAULT_STRENGTH,
        "guidance_scale": DEFAULT_GUIDANCE_SCALE,
        "num_inference_steps": DEFAULT_NUM_INFERENCE_STEPS,
    }
    encoded = json.dumps(payload)
    decoded = json.loads(encoded)
    assert decoded == pytest.approx(payload)
