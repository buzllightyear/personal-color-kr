"""Tests for the approved-models allowlist + reference-mode mapping.

``reference_mode_for`` decides the fal payload key shape per model family:
``"single"`` → ``image_url`` (plain image-to-image), ``"multi"`` →
``image_urls[]`` (the ``*/edit`` family's verified array contract, which is
also where a garment reference can ride as the second element).

The exhaustiveness test is the guard codex review demanded: a model id
added to APPROVED_EDIT_MODELS without a deliberate mode assignment fails
here instead of silently defaulting in production.
"""

from __future__ import annotations

import pytest

from api.generation.approved_models import (
    APPROVED_EDIT_MODELS,
    MULTI_REFERENCE_EDIT_MODELS,
    is_approved_edit_model,
    reference_mode_for,
)


@pytest.mark.unit
def test_flux_dev_i2i_is_single_reference() -> None:
    assert reference_mode_for("fal-ai/flux/dev/image-to-image") == "single"


@pytest.mark.unit
@pytest.mark.parametrize(
    "model_id",
    [
        "fal-ai/flux-2/edit",
        "fal-ai/bytedance/seedream/v4.5/edit",
        "fal-ai/qwen-image-2/edit",
        "fal-ai/nano-banana-2/edit",
    ],
)
def test_edit_family_models_are_multi_reference(model_id: str) -> None:
    assert reference_mode_for(model_id) == "multi"


@pytest.mark.unit
def test_every_approved_model_has_an_explicit_mode() -> None:
    """Exhaustiveness: each allowlisted model is either explicitly multi or
    the known single-reference baseline — no silent default for new entries."""
    singles = APPROVED_EDIT_MODELS - MULTI_REFERENCE_EDIT_MODELS
    assert MULTI_REFERENCE_EDIT_MODELS <= APPROVED_EDIT_MODELS
    assert singles == {"fal-ai/flux/dev/image-to-image"}


@pytest.mark.unit
def test_unknown_model_defaults_to_single() -> None:
    """Defense in depth: an unapproved id (already rejected upstream by
    is_approved_edit_model) maps to the conservative single mode."""
    assert not is_approved_edit_model("fal-ai/flux/dev")
    assert reference_mode_for("fal-ai/flux/dev") == "single"
