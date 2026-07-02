"""Allowlist of validated fal.ai image-EDIT models a recipe may use.

Why this guard exists
---------------------
The generation pipeline (:mod:`personal_color.generate.fal_client`) is
deliberately *model-agnostic*: it uploads the selfie, then POSTs it as the
``image_url`` field to ``fal.run/{recipe.model_id}`` and trusts whatever
model id the operator stored on the recipe.

A **text-to-image** model id (e.g. ``fal-ai/flux/dev``) has *no* ``image_url``
field in its input schema, so fal silently drops the selfie and returns a
prompt-only image of a *stranger*. The core "restyle my selfie" feature is
then broken **with no error** — an image still comes back, so smoke tests
pass while every result is wrong. (Confirmed in production 2026-06-25: all
three published recipes carried the t2i ``fal-ai/flux/dev``.)

This module is the structural fix: a recipe may only carry a model id from
:data:`APPROVED_EDIT_MODELS`, and every entry is an image-EDIT endpoint that
accepts an input image. The admin schema rejects a non-approved id at write
time (HTTP 422); the generate path rejects it again at call time (defense in
depth for any row that predates this guard or was written straight to the DB).

Scope of the allowlist
----------------------
The *contents* are the origin-diverse eval candidates (kept in sync with
``scripts/fal_eval/config.py``); once the eval picks a winner this set is
pruned to it. The *mechanism* — recipes use validated edit models only —
is permanent. NEVER add a bare text-to-image id here.
"""

from __future__ import annotations

from typing import Final, Literal

#: fal.ai model ids that accept an input image (image-to-image / edit).
#: Keep in sync with ``scripts/fal_eval/config.py`` candidates until the eval
#: narrows this to the winning model. Adding a bare text-to-image id (e.g.
#: ``fal-ai/flux/dev``) would reintroduce the "selfie silently ignored" bug.
APPROVED_EDIT_MODELS: Final[frozenset[str]] = frozenset(
    {
        "fal-ai/flux/dev/image-to-image",
        "fal-ai/flux-2/edit",
        "fal-ai/bytedance/seedream/v4.5/edit",
        "fal-ai/qwen-image-2/edit",
        "fal-ai/nano-banana-2/edit",
    }
)

#: The subset of :data:`APPROVED_EDIT_MODELS` whose request schema takes
#: ``image_urls[]`` (array) — the ``*/edit`` family, VERIFIED against each
#: model's fal API page (2026-06-25, see ``scripts/fal_eval/config.py``).
#: These are also the only models that can take a garment reference (as the
#: second array element).  A model added to APPROVED_EDIT_MODELS must be
#: deliberately assigned here or left single — the exhaustiveness unit test
#: (``tests/unit/test_approved_models.py``) fails on an unassigned entry.
MULTI_REFERENCE_EDIT_MODELS: Final[frozenset[str]] = frozenset(
    {
        "fal-ai/flux-2/edit",
        "fal-ai/bytedance/seedream/v4.5/edit",
        "fal-ai/qwen-image-2/edit",
        "fal-ai/nano-banana-2/edit",
    }
)


def is_approved_edit_model(model_id: str) -> bool:
    """Return ``True`` iff ``model_id`` is a validated image-edit model.

    Exact match against :data:`APPROVED_EDIT_MODELS`. Operators pick from a
    curated, eval-validated set rather than free-typing an arbitrary fal
    endpoint, because image quality + identity preservation are model-bound
    (see ``scripts/fal_eval`` and the quality rubric).
    """
    return model_id in APPROVED_EDIT_MODELS


def reference_mode_for(model_id: str) -> Literal["single", "multi"]:
    """Return the fal payload key shape for ``model_id``.

    ``"multi"`` → ``image_urls[]`` (the ``*/edit`` family), ``"single"`` →
    ``image_url`` (plain image-to-image; conservative default for anything
    unknown — unapproved ids are rejected upstream by
    :func:`is_approved_edit_model` anyway).
    """
    return "multi" if model_id in MULTI_REFERENCE_EDIT_MODELS else "single"


__all__ = [
    "APPROVED_EDIT_MODELS",
    "MULTI_REFERENCE_EDIT_MODELS",
    "is_approved_edit_model",
    "reference_mode_for",
]
