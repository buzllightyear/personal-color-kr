from scripts.drift_check.models import Finding
from scripts.drift_check.report import render, summary_line


def _f(state: str) -> Finding:
    return Finding(marker_location="STRATEGY.md:5", target_raw="CLAUDE.md",
                   target_path="CLAUDE.md", state=state, evidence="ev")


def test_summary_line_counts_states():
    out = summary_line([_f("PROPAGATED"), _f("PROPAGATION_MISSING"), _f("PROPAGATION_MISSING")])
    assert out == "1 PROPAGATED, 2 PROPAGATION_MISSING, 0 NEEDS_MANUAL_REVIEW"


def test_render_is_markdown_with_states_and_surfaced_notice():
    md = render([_f("PROPAGATION_MISSING")])
    assert md.startswith("# Drift Report")
    assert "surfaced" in md.lower()
    assert "PROPAGATION_MISSING" in md
    assert "STRATEGY.md:5" in md
    # code-wins guard: never proposes code edits
    assert "코드 변경" not in md


def test_render_empty_findings_contains_limitations_note():
    md = render([])
    assert "단일 줄 마커" in md


def test_render_with_markers_scanned_shows_provenance():
    md = render([_f("PROPAGATED")], markers_scanned=6)
    assert "스캔된 마커" in md
    assert "코드 변경" not in md
