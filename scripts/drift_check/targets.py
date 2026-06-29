"""Resolve a marker Target to a canonical file path (pure-ish: reads fs existence)."""
from __future__ import annotations

import dataclasses
from pathlib import Path

from scripts.drift_check.models import Target


def default_memory_dir(repo_root: Path) -> Path:
    """Derive the project auto-memory dir from the repo's absolute path.

    Mirrors the harness convention: ``~/.claude/projects/<abs-path-with-/-as->/memory``.
    """
    abs_path = repo_root.resolve()
    sanitized = str(abs_path).replace("/", "-")
    return Path.home() / ".claude" / "projects" / sanitized / "memory"


def resolve(target: Target, repo_root: Path, memory_dir: Path) -> Target:
    """Return a new Target with ``canonical_path`` filled (or None if unresolvable)."""
    canonical: str | None = None
    if target.source_syntax == "filename":
        candidate = repo_root / target.raw
        if candidate.is_file():
            canonical = target.raw  # repo-relative
    elif target.source_syntax == "wikilink":
        slug = target.raw.strip("[]")
        candidate = memory_dir / f"{slug}.md"
        if candidate.is_file():
            canonical = str(candidate)  # absolute; memory lives outside the repo tree
    return dataclasses.replace(target, canonical_path=canonical)
