"""Frozen value objects for the drift-check tool (Phase 1)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Target:
    """A doc named by a supersession marker as needing the change propagated."""

    raw: str                      # as written, e.g. "[[app-identity-decision]]" or "CLAUDE.md"
    source_syntax: str            # "wikilink" | "filename"  (Phase 1 생성값; ADR 경로-한정 참조는 미지원 — 알려진 제약)
    canonical_path: str | None    # resolved path (repo-relative or absolute); None if unresolvable
    section_id: str | None        # e.g. "§7-B"; None when the marker names no section


@dataclass(frozen=True)
class Marker:
    """A supersession / parking note found in a source doc."""

    location: str                 # "STRATEGY.md:<line>"
    keyword: str                  # "SUPERSEDED" | "정정" | "파킹"
    date: str | None              # "YYYY-MM-DD" or None
    raw_text: str                 # captured marker block
    targets: tuple[Target, ...]


@dataclass(frozen=True)
class Finding:
    """One (marker, target) propagation verdict candidate."""

    marker_location: str
    target_raw: str
    target_path: str | None
    state: str                    # "PROPAGATED" | "PROPAGATION_MISSING" | "NEEDS_MANUAL_REVIEW"
    evidence: str
