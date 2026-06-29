from pathlib import Path
from scripts.drift_check.run import run_check

_FIX = Path(__file__).parent / "fixtures"


def test_golden_reproduces_known_propagation_states(tmp_path: Path):
    # Lay the snapshot into a repo shape: docs/STRATEGY.md + CLAUDE.md + mem/
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "STRATEGY.md").write_text(
        (_FIX / "golden_strategy.md").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (tmp_path / "CLAUDE.md").write_text(
        (_FIX / "CLAUDE.md").read_text(encoding="utf-8"), encoding="utf-8"
    )
    mem = tmp_path / "mem"
    mem.mkdir()
    (mem / "app-identity-decision.md").write_text(
        (_FIX / "mem" / "app-identity-decision.md").read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    _, findings, _ = run_check(repo_root=tmp_path, memory_dir=mem)
    # exactly 3 targets — guards against _FILENAME_RE double-matching a wikilink's .md
    assert len(findings) == 3
    by_target = {f.target_raw: f.state for f in findings}
    assert set(by_target) == {
        "CLAUDE.md",
        "[[app-identity-decision]]",
        "[[ghost-note]]",
    }
    assert by_target["CLAUDE.md"] == "PROPAGATION_MISSING"  # pre-fix: no back-ref
    assert (
        by_target["[[app-identity-decision]]"] == "PROPAGATED"
    )  # has back-ref (negative control)
    assert by_target["[[ghost-note]]"] == "NEEDS_MANUAL_REVIEW"  # unresolvable
