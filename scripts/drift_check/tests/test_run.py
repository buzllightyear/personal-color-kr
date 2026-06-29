from pathlib import Path
from scripts.drift_check.run import run_check, main


def _seed_repo(root: Path, claude_body: str) -> None:
    (root / "docs").mkdir(parents=True, exist_ok=True)
    (root / "docs" / "STRATEGY.md").write_text(
        "> **⚠ SUPERSEDED (2026-06-28):** CLAUDE.md needs update.\n", encoding="utf-8"
    )
    (root / "CLAUDE.md").write_text(claude_body, encoding="utf-8")


def test_run_check_flags_missing_propagation(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="no reference here")
    md, findings = run_check(repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["PROPAGATION_MISSING"]
    assert "PROPAGATION_MISSING" in md


def test_main_writes_report_and_exits_zero(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="see STRATEGY.md §7")
    out = tmp_path / "docs" / "drift-report.md"
    code = main(["--repo-root", str(tmp_path), "--out", str(out)])
    assert code == 0
    assert out.is_file()
    assert "PROPAGATED" in out.read_text(encoding="utf-8")
