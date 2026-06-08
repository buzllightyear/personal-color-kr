"""Loader for reject-filter threshold config from YAML (AC5).

Operators update threshold values by editing
``config/reject_filter_defaults.yaml`` — no code changes required.
Per-recipe overrides are specified in the same file under
``per_recipe_overrides``.

Design
------
:func:`load_reject_config` reads the YAML file and returns a
:class:`~api.generation.reject_filter.RejectConfig` that merges global
defaults with any per-recipe overrides for the given recipe_id.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from api.generation.reject_filter import (
    DEFAULT_THRESHOLDS,
    RejectConfig,
    RejectThresholds,
)


def load_reject_config(
    recipe_id: str | None = None,
    config_path: Path | None = None,
) -> RejectConfig:
    """Load reject-filter config from YAML, merging per-recipe overrides.

    Parameters
    ----------
    recipe_id:
        Optional recipe identifier. If provided, per-recipe overrides
        from ``per_recipe_overrides[recipe_id]`` in the YAML are merged
        on top of global defaults.
    config_path:
        Path to the config YAML. Defaults to
        ``apps/api/config/reject_filter_defaults.yaml`` relative to this
        module's package root. Tests can supply an explicit path.

    Returns
    -------
    RejectConfig
        Effective config: global defaults + any per-recipe overrides.
        Falls back to code-level DEFAULT_THRESHOLDS if the config file
        cannot be read (fail-open for operator convenience).
    """
    if config_path is None:
        # Resolve relative to this file: src/api/generation → ../../config/
        config_path = (
            Path(__file__).parent.parent.parent.parent  # apps/api/
            / "config"
            / "reject_filter_defaults.yaml"
        )

    try:
        raw = config_path.read_text(encoding="utf-8")
        data: dict[str, Any] = yaml.safe_load(raw) or {}
    except FileNotFoundError:
        # Config file missing — fall back to code-level defaults (fail-open).
        data = {}

    global_raw: dict[str, Any] = data.get("global_defaults", {})
    global_thresholds = RejectThresholds(
        identity_threshold=float(
            global_raw.get("identity_threshold", DEFAULT_THRESHOLDS.identity_threshold)
        ),
        artifact_threshold=float(
            global_raw.get("artifact_threshold", DEFAULT_THRESHOLDS.artifact_threshold)
        ),
        uncanny_threshold=float(
            global_raw.get("uncanny_threshold", DEFAULT_THRESHOLDS.uncanny_threshold)
        ),
    )

    recipe_overrides: dict[str, Any] | None = None
    if recipe_id is not None:
        per_recipe: dict[str, Any] = data.get("per_recipe_overrides", {}) or {}
        recipe_overrides = per_recipe.get(recipe_id)

    return RejectConfig.from_override(global_thresholds, recipe_overrides)


__all__ = ["load_reject_config"]
