"""Unit tests for the pivot's recipe trend fields (STRATEGY §7-D gaps #1/#2).

``expires_at``   — nullable timestamptz; NULL = evergreen, so every recipe
                   seeded before this migration keeps working unchanged.
``format_template`` — nullable JSONB; the deterministic compositing layer's
                   authoring slot (internal-only, like ``prompt_template`` —
                   the catalog-response omission is pinned in
                   ``test_recipes_catalog.py`` alongside the other internal
                   fields).
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from api.db.models.recipe import Recipe


@pytest.mark.unit
def test_transient_recipe_expires_at_defaults_to_none() -> None:
    """A transient instance carries no expiry — NULL = evergreen."""
    assert Recipe().expires_at is None


@pytest.mark.unit
def test_transient_recipe_format_template_defaults_to_none() -> None:
    """A transient instance carries no format template."""
    assert Recipe().format_template is None


@pytest.mark.unit
def test_recipe_accepts_expires_at_and_format_template() -> None:
    recipe = Recipe()
    recipe.expires_at = datetime(2026, 7, 9, tzinfo=timezone.utc)
    recipe.format_template = {
        "version": 1,
        "kind": "text_overlay",
        "text": "이번 주 트렌드",
        "position": "bottom",
    }
    assert recipe.expires_at is not None
    assert recipe.format_template["kind"] == "text_overlay"
