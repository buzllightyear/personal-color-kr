from pathlib import Path

from scripts.drift_check.config_seams import (
    evaluate,
    extract_toml_pin,
    extract_yaml_pin,
)


def test_yaml_pin_extracts_requirement_spec():
    text = "          python -m pip install 'pytest<9.1' pytest-asyncio mypy ruff\n"
    assert extract_yaml_pin(text, "pytest") == "<9.1"


def test_yaml_pin_ignores_prose_mention():
    # space between package and operator → not a requirement spec
    text = "# pytest is pinned <9.1: pytest 9.1.0 changed caplog so a record\n"
    assert extract_yaml_pin(text, "pytest") is None


def test_yaml_pin_respects_left_token_boundary():
    # "pytest" as a substring of another token must not match
    text = "install 'notpytest<9.1' and 'my-pytest<9.1'\n"
    assert extract_yaml_pin(text, "pytest") is None


def test_toml_pin_extracts_from_dep_group():
    text = '[dependency-groups]\ndev = ["httpx>=0.28.1", "pytest>=9.1.1", "pytest-asyncio>=1.4.0"]\n'
    assert extract_toml_pin(text, "pytest", "dev") == ">=9.1.1"


def test_toml_pin_does_not_match_sibling_package():
    text = '[dependency-groups]\ndev = ["pytest-asyncio>=1.4.0"]\n'
    assert extract_toml_pin(text, "pytest", "dev") is None


def _lay(tmp_path: Path, ci_spec: str, toml_spec: str) -> None:
    wf = tmp_path / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "ci.yml").write_text(
        f"        run: pip install 'pytest{ci_spec}'\n", encoding="utf-8"
    )
    api = tmp_path / "apps" / "api"
    api.mkdir(parents=True)
    (api / "pyproject.toml").write_text(
        f'[dependency-groups]\ndev = ["pytest{toml_spec}"]\n', encoding="utf-8"
    )


def test_evaluate_flags_contradictory_pins(tmp_path: Path):
    _lay(tmp_path, "<9.1", ">=9.1.1")
    findings = evaluate(tmp_path)
    assert len(findings) == 1
    f = findings[0]
    assert f.state == "CONFIG_SEAM_MISMATCH"
    assert (f.value_a, f.value_b) == ("<9.1", ">=9.1.1")
    assert f.seam_name == "pytest-version-pin"


def test_evaluate_passes_compatible_pins(tmp_path: Path):
    _lay(tmp_path, ">=9.1", ">=9.1.1")
    assert evaluate(tmp_path)[0].state == "CONFIG_CONSISTENT"


def test_evaluate_missing_files_is_manual_review(tmp_path: Path):
    # nothing laid down → both sources unextractable
    f = evaluate(tmp_path)[0]
    assert f.state == "NEEDS_MANUAL_REVIEW"
    assert f.value_a is None and f.value_b is None


def test_evaluate_unsupported_operator_is_manual_review(tmp_path: Path):
    # toml `~=9.1` is extracted (operator-led) but parse_specifier rejects it
    _lay(tmp_path, ">=9.1", "~=9.1")
    f = evaluate(tmp_path)[0]
    assert f.state == "NEEDS_MANUAL_REVIEW"
    assert f.value_b == "~=9.1"
