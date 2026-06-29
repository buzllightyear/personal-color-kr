from pathlib import Path
from scripts.drift_check.run import run_check, main


def _seed_repo(root: Path, claude_body: str) -> None:
    (root / "docs").mkdir(parents=True, exist_ok=True)
    (root / "docs" / "STRATEGY.md").write_text(
        "> **⚠ SUPERSEDED (2026-06-28):** CLAUDE.md needs update.\n", encoding="utf-8"
    )
    (root / "CLAUDE.md").write_text(claude_body, encoding="utf-8")


def _seed_config_seam(root: Path, ci_spec: str, toml_spec: str) -> None:
    wf = root / ".github" / "workflows"
    wf.mkdir(parents=True, exist_ok=True)
    (wf / "ci.yml").write_text(
        f"        run: pip install 'pytest{ci_spec}'\n", encoding="utf-8"
    )
    api = root / "apps" / "api"
    api.mkdir(parents=True, exist_ok=True)
    (api / "pyproject.toml").write_text(
        f'[dependency-groups]\ndev = ["pytest{toml_spec}"]\n', encoding="utf-8"
    )


def test_run_check_flags_missing_propagation(tmp_path: Path):
    # NO config seam seeded (no ci.yml / pyproject.toml) → D4 must surface a clean
    # NEEDS_MANUAL_REVIEW row without crashing or perturbing the D1 result.
    _seed_repo(tmp_path, claude_body="no reference here")
    md, findings, config_findings = run_check(
        repo_root=tmp_path, memory_dir=tmp_path / "mem"
    )
    assert [f.state for f in findings] == ["PROPAGATION_MISSING"]  # D1 unchanged
    assert "PROPAGATION_MISSING" in md
    assert [c.state for c in config_findings] == [
        "NEEDS_MANUAL_REVIEW"
    ]  # D4 missing-config
    assert "D4 config-seam" in md
    assert "NEEDS_MANUAL_REVIEW" in md


def test_run_check_surfaces_config_seam_mismatch(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="no reference here")
    _seed_config_seam(tmp_path, ci_spec="<9.1", toml_spec=">=9.1.1")
    md, findings, config_findings = run_check(
        repo_root=tmp_path, memory_dir=tmp_path / "mem"
    )
    assert [c.state for c in config_findings] == ["CONFIG_SEAM_MISMATCH"]
    assert "D4 config-seam" in md
    assert "CONFIG_SEAM_MISMATCH" in md


def test_main_writes_report_and_exits_zero(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="see STRATEGY.md §7")
    out = tmp_path / "docs" / "drift-report.md"
    code = main(["--repo-root", str(tmp_path), "--out", str(out)])
    assert code == 0
    assert out.is_file()
    assert "PROPAGATED" in out.read_text(encoding="utf-8")
