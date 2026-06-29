from scripts.drift_check.models import ConfigFinding, Finding
from scripts.drift_check.report import config_summary_line, render, summary_line


def _f(state: str) -> Finding:
    return Finding(
        marker_location="STRATEGY.md:5",
        target_raw="CLAUDE.md",
        target_path="CLAUDE.md",
        state=state,
        evidence="ev",
    )


def test_summary_line_counts_states():
    out = summary_line(
        [_f("PROPAGATED"), _f("PROPAGATION_MISSING"), _f("PROPAGATION_MISSING")]
    )
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


def _cf(state: str) -> ConfigFinding:
    return ConfigFinding(
        seam_name="pytest-version-pin",
        value_a="<9.1",
        value_b=">=9.1.1",
        state=state,
        evidence="ev",
    )


def test_config_summary_line_counts_states():
    out = config_summary_line([_cf("CONFIG_SEAM_MISMATCH"), _cf("CONFIG_CONSISTENT")])
    assert out == "1 CONFIG_CONSISTENT, 1 CONFIG_SEAM_MISMATCH, 0 NEEDS_MANUAL_REVIEW"


def test_render_includes_d4_section_when_config_findings():
    md = render([], config_findings=[_cf("CONFIG_SEAM_MISMATCH")])
    assert "D4 config-seam" in md
    assert "CONFIG_SEAM_MISMATCH" in md
    assert "pytest-version-pin" in md
    assert "코드 변경" not in md  # surfaced·no code-edit proposal


def test_render_backward_compatible_d1_only_still_starts_with_title():
    md = render([_f("PROPAGATION_MISSING")])
    assert md.startswith("# Drift Report")
    assert "PROPAGATION_MISSING" in md
