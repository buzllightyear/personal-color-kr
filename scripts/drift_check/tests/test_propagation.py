from pathlib import Path

from scripts.drift_check.models import Marker, Target
from scripts.drift_check.propagation import evaluate, has_backreference


def test_has_backreference_substring_case_insensitive():
    assert has_backreference("see docs/strategy.md for the trajectory", "STRATEGY")
    assert not has_backreference("unrelated note", "STRATEGY")


def _marker(target: Target) -> Marker:
    return Marker(
        location="STRATEGY.md:5",
        keyword="SUPERSEDED",
        date="2026-06-28",
        raw_text="...",
        targets=(target,),
    )


def test_target_with_backref_is_propagated(tmp_path: Path):
    (tmp_path / "CLAUDE.md").write_text(
        "Direction: see STRATEGY.md §7.", encoding="utf-8"
    )
    t = Target(
        raw="CLAUDE.md",
        source_syntax="filename",
        canonical_path=None,
        section_id=None,
    )
    findings = evaluate(_marker(t), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["PROPAGATED"]


def test_target_without_backref_is_missing(tmp_path: Path):
    (tmp_path / "CLAUDE.md").write_text("nothing relevant here.", encoding="utf-8")
    t = Target(
        raw="CLAUDE.md",
        source_syntax="filename",
        canonical_path=None,
        section_id=None,
    )
    findings = evaluate(_marker(t), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["PROPAGATION_MISSING"]


def test_unresolvable_target_needs_manual_review(tmp_path: Path):
    t = Target(
        raw="[[ghost]]",
        source_syntax="wikilink",
        canonical_path=None,
        section_id=None,
    )
    findings = evaluate(_marker(t), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["NEEDS_MANUAL_REVIEW"]
