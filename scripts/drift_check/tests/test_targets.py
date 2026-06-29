from pathlib import Path
from scripts.drift_check.models import Target
from scripts.drift_check.targets import resolve, default_memory_dir


def _t(raw: str, syntax: str) -> Target:
    return Target(raw=raw, source_syntax=syntax, canonical_path=None, section_id=None)


def test_resolves_existing_filename_to_repo_relative(tmp_path: Path):
    (tmp_path / "CLAUDE.md").write_text("x", encoding="utf-8")
    out = resolve(_t("CLAUDE.md", "filename"), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert out.canonical_path == "CLAUDE.md"


def test_resolves_existing_wikilink_to_memory_file(tmp_path: Path):
    mem = tmp_path / "mem"
    mem.mkdir()
    (mem / "app-identity-decision.md").write_text("x", encoding="utf-8")
    out = resolve(_t("[[app-identity-decision]]", "wikilink"), repo_root=tmp_path, memory_dir=mem)
    assert out.canonical_path == str(mem / "app-identity-decision.md")


def test_unresolvable_target_yields_none(tmp_path: Path):
    out = resolve(_t("[[ghost-note]]", "wikilink"), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert out.canonical_path is None


def test_default_memory_dir_derives_from_repo_path():
    d = default_memory_dir(Path("/Users/opty/Code/personal-color-kr"))
    assert d.name == "memory"
    assert "-Users-opty-Code-personal-color-kr" in str(d)
