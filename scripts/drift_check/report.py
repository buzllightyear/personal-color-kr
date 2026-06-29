"""Render D1 + D4 findings to a surfaced markdown report (pure)."""

from __future__ import annotations

from collections.abc import Sequence

from scripts.drift_check.models import ConfigFinding, Finding

_STATES = ("PROPAGATED", "PROPAGATION_MISSING", "NEEDS_MANUAL_REVIEW")
_ACTION = {
    "PROPAGATED": "—",
    "PROPAGATION_MISSING": "타깃 문서에 STRATEGY 변경 반영(역참조 추가)했는지 확인",
    "NEEDS_MANUAL_REVIEW": "타깃 수동 확인(해석 불가)",
}

_CONFIG_STATES = ("CONFIG_CONSISTENT", "CONFIG_SEAM_MISMATCH", "NEEDS_MANUAL_REVIEW")
_CONFIG_ACTION = {
    "CONFIG_CONSISTENT": "—",
    "CONFIG_SEAM_MISMATCH": "두 선언 화해 — CI는 실행되는 현실, pyproject는 로컬 `uv sync` 해석값",
    "NEEDS_MANUAL_REVIEW": "수동 확인(명세 추출/파싱 불가)",
}


def summary_line(findings: list[Finding]) -> str:
    counts = {s: sum(1 for f in findings if f.state == s) for s in _STATES}
    return ", ".join(f"{counts[s]} {s}" for s in _STATES)


def config_summary_line(config_findings: list[ConfigFinding]) -> str:
    cf = list(config_findings)
    counts = {s: sum(1 for f in cf if f.state == s) for s in _CONFIG_STATES}
    return ", ".join(f"{counts[s]} {s}" for s in _CONFIG_STATES)


def _render_d1(findings: list[Finding], markers_scanned: int | None) -> str:
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


def _render_d4(config_findings: list[ConfigFinding]) -> str:
    lines = [
        "## D4 config-seam (surfaced)",
        "",
        "> 두 config 선언의 버전 명세 교집합을 비교. 결정론적·승자 미선정 — 사람이 화해.",
        "",
        "| seam | A | B | state | action |",
        "|---|---|---|---|---|",
    ]
    for f in config_findings:
        lines.append(
            f"| {f.seam_name} | {f.value_a} | {f.value_b} | {f.state} | {_CONFIG_ACTION[f.state]} |"
        )
    lines += ["", f"**Config summary:** {config_summary_line(config_findings)}"]
    return "\n".join(lines)


def render(
    findings: list[Finding],
    config_findings: Sequence[ConfigFinding] = (),
    markers_scanned: int | None = None,
) -> str:
    return "\n\n".join(
        [_render_d1(findings, markers_scanned), _render_d4(list(config_findings))]
    )
