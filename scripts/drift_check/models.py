"""Frozen value objects for the drift-check tool (Phase 1)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Target:
    """A doc named by a supersession marker as needing the change propagated."""

    raw: str  # as written, e.g. "[[app-identity-decision]]" or "CLAUDE.md"
    source_syntax: str  # "wikilink" | "filename"  (Phase 1 생성값; ADR 경로-한정 참조는 미지원 — 알려진 제약)
    canonical_path: str | None  # resolved path; None if unresolvable
    section_id: str | None  # e.g. "§7-B"; None when the marker names no section


@dataclass(frozen=True)
class Marker:
    """A supersession / parking note found in a source doc."""

    location: str  # "STRATEGY.md:<line>"
    keyword: str  # "SUPERSEDED" | "정정" | "파킹"
    date: str | None  # "YYYY-MM-DD" or None
    raw_text: str  # captured marker block
    targets: tuple[Target, ...]


@dataclass(frozen=True)
class Finding:
    """One (marker, target) propagation verdict candidate."""

    marker_location: str
    target_raw: str
    target_path: str | None
    state: str  # "PROPAGATED" | "PROPAGATION_MISSING" | "NEEDS_MANUAL_REVIEW"
    evidence: str


@dataclass(frozen=True)
class SeamSource:
    """One side of a config-seam: where a shared value is declared + how to read it."""

    file: str  # repo-relative path, e.g. ".github/workflows/ci.yml"
    kind: str  # "yaml-regex" | "toml-dep-group"
    group: str | None = None  # dep-group name (e.g. "dev"); None for yaml


@dataclass(frozen=True)
class ConfigSeam:
    """A declared invariant: two places that declare the same value must stay compatible."""

    name: str  # "pytest-version-pin"
    package: str  # "pytest"
    source_a: SeamSource
    source_b: SeamSource


@dataclass(frozen=True)
class ConfigFinding:
    """One config-seam comparison verdict (deterministic — no J stage)."""

    seam_name: str
    value_a: str | None  # extracted specifier e.g. "<9.1"; None if unextractable
    value_b: str | None
    state: str  # "CONFIG_CONSISTENT" | "CONFIG_SEAM_MISMATCH" | "NEEDS_MANUAL_REVIEW"
    evidence: str
