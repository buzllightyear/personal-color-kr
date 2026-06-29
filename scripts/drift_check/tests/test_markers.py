from scripts.drift_check.markers import parse_markers


def test_parses_superseded_marker_with_filename_and_wikilink_targets():
    doc = (
        "intro line\n"
        "> **⚠ SUPERSEDED (2026-06-28):** see **CLAUDE.md** and [[app-identity-decision]] need update.\n"
        "trailing line\n"
    )
    markers = parse_markers(doc, "STRATEGY.md")
    assert len(markers) == 1
    m = markers[0]
    assert m.keyword == "SUPERSEDED"
    assert m.date == "2026-06-28"
    assert m.location == "STRATEGY.md:2"
    raws = sorted(t.raw for t in m.targets)
    assert raws == ["CLAUDE.md", "[[app-identity-decision]]"]
    assert {t.source_syntax for t in m.targets} == {"filename", "wikilink"}


def test_excludes_strategy_self_reference_target():
    doc = "> **정정 (2026-06-29):** STRATEGY.md §2 도 보라; CLAUDE.md 갱신.\n"
    markers = parse_markers(doc, "STRATEGY.md")
    assert len(markers) == 1
    raws = [t.raw for t in markers[0].targets]
    assert "CLAUDE.md" in raws
    assert "STRATEGY.md" not in raws  # cross-file only


def test_no_marker_returns_empty():
    assert parse_markers("just a normal paragraph with no keyword\n", "STRATEGY.md") == []
