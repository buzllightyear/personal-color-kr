"""D1: decide whether each marker target acknowledges the supersession (pure-ish)."""
from __future__ import annotations

from pathlib import Path

from scripts.drift_check.models import Finding, Marker
from scripts.drift_check.targets import resolve


def has_backreference(target_text: str, source_doc_label: str) -> bool:
    """True iff the target doc mentions the source doc (primary propagation signal).

    Phase 1 treats any back-reference as 'propagated'. Detecting a back-reference
    that sits next to *stale* superseded prose is deferred to the J stage (spec §4
    D1 판정규칙) — Phase 1 never asserts VALID, only the candidate states.
    """
    return source_doc_label.lower() in target_text.lower()


def evaluate(
    marker: Marker,
    repo_root: Path,
    memory_dir: Path,
    source_doc_label: str = "STRATEGY",
) -> list[Finding]:
    """Return one Finding per marker target."""
    findings: list[Finding] = []
    for target in marker.targets:
        resolved = resolve(target, repo_root=repo_root, memory_dir=memory_dir)
        if resolved.canonical_path is None:
            findings.append(
                Finding(
                    marker_location=marker.location,
                    target_raw=target.raw,
                    target_path=None,
                    state="NEEDS_MANUAL_REVIEW",
                    evidence=f"target '{target.raw}' could not be resolved to a file",
                )
            )
            continue
        path = (
            repo_root / resolved.canonical_path
            if not Path(resolved.canonical_path).is_absolute()
            else Path(resolved.canonical_path)
        )
        text = path.read_text(encoding="utf-8")
        if has_backreference(text, source_doc_label):
            state, evidence = "PROPAGATED", f"'{source_doc_label}' referenced in target"
        else:
            state, evidence = (
                "PROPAGATION_MISSING",
                f"no '{source_doc_label}' reference in target",
            )
        findings.append(
            Finding(
                marker_location=marker.location,
                target_raw=target.raw,
                target_path=resolved.canonical_path,
                state=state,
                evidence=evidence,
            )
        )
    return findings
