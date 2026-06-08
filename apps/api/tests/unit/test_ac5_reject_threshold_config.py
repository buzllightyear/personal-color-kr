"""AC5: Reject threshold config separation — global defaults + per-recipe override.

Acceptance criteria verified
-----------------------------
AC5: global default config file + per-recipe override.
     파일 수정만으로 갱신 가능(코드 변경 불필요).
     override 미지정 시 global default 적용 테스트.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from api.generation.reject_filter import RejectConfig, RejectThresholds
from api.generation.reject_filter_config_loader import load_reject_config


# ---------------------------------------------------------------------------
# Helper: write a temp config YAML
# ---------------------------------------------------------------------------

def _write_config(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "reject_filter_defaults.yaml"
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# AC5: global default applies when no override
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_global_defaults_loaded_from_yaml(tmp_path: Path) -> None:
    """Config values from YAML global_defaults are used when no recipe override."""
    config_path = _write_config(
        tmp_path,
        """
        global_defaults:
          identity_threshold: 0.70
          artifact_threshold: 0.65
          uncanny_threshold: 0.55
        per_recipe_overrides: {}
        """,
    )

    config = load_reject_config(recipe_id=None, config_path=config_path)

    assert config.identity_threshold == 0.70
    assert config.artifact_threshold == 0.65
    assert config.uncanny_threshold == 0.55


@pytest.mark.unit
def test_global_default_applied_when_recipe_not_in_overrides(tmp_path: Path) -> None:
    """When recipe_id has no override entry, global defaults apply."""
    config_path = _write_config(
        tmp_path,
        """
        global_defaults:
          identity_threshold: 0.60
          artifact_threshold: 0.60
          uncanny_threshold: 0.50
        per_recipe_overrides:
          recipe_other: {identity_threshold: 0.90}
        """,
    )

    config = load_reject_config(recipe_id="recipe_aurora_1", config_path=config_path)

    # recipe_aurora_1 not in overrides → global defaults
    assert config.identity_threshold == 0.60
    assert config.artifact_threshold == 0.60
    assert config.uncanny_threshold == 0.50


# ---------------------------------------------------------------------------
# AC5: per-recipe override applied
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_per_recipe_override_applied(tmp_path: Path) -> None:
    """Per-recipe overrides replace global defaults for specified keys."""
    config_path = _write_config(
        tmp_path,
        """
        global_defaults:
          identity_threshold: 0.60
          artifact_threshold: 0.60
          uncanny_threshold: 0.50
        per_recipe_overrides:
          recipe_aurora_1:
            identity_threshold: 0.75
            artifact_threshold: 0.70
        """,
    )

    config = load_reject_config(recipe_id="recipe_aurora_1", config_path=config_path)

    # Overridden values
    assert config.identity_threshold == 0.75
    assert config.artifact_threshold == 0.70
    # Not overridden → global default
    assert config.uncanny_threshold == 0.50


@pytest.mark.unit
def test_partial_override_falls_back_to_global_for_missing_keys(tmp_path: Path) -> None:
    """Partial per-recipe override only changes specified keys."""
    config_path = _write_config(
        tmp_path,
        """
        global_defaults:
          identity_threshold: 0.60
          artifact_threshold: 0.60
          uncanny_threshold: 0.50
        per_recipe_overrides:
          recipe_aurora_1:
            uncanny_threshold: 0.80
        """,
    )

    config = load_reject_config(recipe_id="recipe_aurora_1", config_path=config_path)

    assert config.identity_threshold == 0.60  # global
    assert config.artifact_threshold == 0.60  # global
    assert config.uncanny_threshold == 0.80   # override


# ---------------------------------------------------------------------------
# AC5: direct RejectConfig.from_override API (no file I/O needed)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_from_override_with_none_uses_all_global_defaults() -> None:
    """RejectConfig.from_override(defaults, None) returns all global values."""
    defaults = RejectThresholds(
        identity_threshold=0.6,
        artifact_threshold=0.6,
        uncanny_threshold=0.5,
    )
    config = RejectConfig.from_override(defaults, None)
    assert config.identity_threshold == 0.6
    assert config.artifact_threshold == 0.6
    assert config.uncanny_threshold == 0.5


@pytest.mark.unit
def test_from_override_with_dict_overrides_all_three() -> None:
    """RejectConfig.from_override with a full override dict."""
    defaults = RejectThresholds(0.6, 0.6, 0.5)
    overrides = {"identity_threshold": 0.8, "artifact_threshold": 0.7, "uncanny_threshold": 0.6}
    config = RejectConfig.from_override(defaults, overrides)
    assert config.identity_threshold == 0.8
    assert config.artifact_threshold == 0.7
    assert config.uncanny_threshold == 0.6


@pytest.mark.unit
def test_missing_config_file_falls_back_to_code_defaults(tmp_path: Path) -> None:
    """When config file is missing, load_reject_config returns code-level defaults."""
    nonexistent = tmp_path / "does_not_exist.yaml"
    config = load_reject_config(recipe_id=None, config_path=nonexistent)
    # Code-level defaults
    from api.generation.reject_filter import DEFAULT_THRESHOLDS
    assert config.identity_threshold == DEFAULT_THRESHOLDS.identity_threshold
    assert config.artifact_threshold == DEFAULT_THRESHOLDS.artifact_threshold
    assert config.uncanny_threshold == DEFAULT_THRESHOLDS.uncanny_threshold
