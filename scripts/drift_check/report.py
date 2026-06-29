"""Render D1 findings to a surfaced markdown report (pure)."""
from __future__ import annotations

from scripts.drift_check.models import Finding

_STATES = ("PROPAGATED", "PROPAGATION_MISSING", "NEEDS_MANUAL_REVIEW")
_ACTION = {
    "PROPAGATED": "—",
    "PROPAGATION_MISSING": "타깃 문서에 STRATEGY 변경 반영(역참조 추가)했는지 확인",
    "NEEDS_MANUAL_REVIEW": "타깃 수동 확인(해석 불가)",
}


def summary_line(findings: list[Finding]) -> str:
    counts = {s: sum(1 for f in findings if f.state == s) for s in _STATES}
    return ", ".join(f"{counts[s]} {s}" for s in _STATES)


def render(findings: list[Finding], markers_scanned: int | None = None) -> str:
    lines = [
        "# Drift Report — D1 supersession-전파 (surfaced)",
        "",
        "> surfaced·비차단. *Code wins for current state* — 아래 human action은 문서 확인/전파만 제안하며 코드를 바꾸지 않는다.",
        "",
        "| marker | target | state | evidence | human action |",
        "|---|---|---|---|---|",
    ]
    for f in findings:
        lines.append(
            f"| {f.marker_location} | {f.target_raw} | {f.state} | {f.evidence} | {_ACTION[f.state]} |"
        )
    lines += ["", f"**Summary:** {summary_line(findings)}"]
    lines += [
        "",
        "_Phase 1 한계: 단일 줄 마커만 파싱(멀티라인 파킹 노트 미포착) · back-reference = 문서 전체 substring(거친 신호; J 단계에서 정밀화) · git 무관._",
    ]
    if markers_scanned is not None:
        lines.append(
            f"_스캔된 마커 줄: {markers_scanned} · 타깃 해석된 finding: {len(findings)}_"
        )
    return "\n".join(lines)
