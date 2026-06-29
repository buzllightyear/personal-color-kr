"""CLI entry: scan STRATEGY.md for unpropagated supersessions (surfaced, exit 0)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from scripts.drift_check import config_seams
from scripts.drift_check.markers import parse_markers
from scripts.drift_check.models import ConfigFinding, Finding
from scripts.drift_check.propagation import evaluate
from scripts.drift_check.report import config_summary_line, render, summary_line
from scripts.drift_check.targets import default_memory_dir

_STRATEGY_REL = Path("docs") / "STRATEGY.md"


def run_check(
    repo_root: Path, memory_dir: Path | None = None
) -> tuple[str, list[Finding], list[ConfigFinding]]:
    mem = memory_dir if memory_dir is not None else default_memory_dir(repo_root)
    doc_text = (repo_root / _STRATEGY_REL).read_text(encoding="utf-8")
    markers = parse_markers(doc_text, "STRATEGY.md")
    findings: list[Finding] = []
    for marker in markers:
        findings.extend(evaluate(marker, repo_root=repo_root, memory_dir=mem))
    config_findings = config_seams.evaluate(repo_root)
    markdown = render(findings, config_findings, markers_scanned=len(markers))
    return markdown, findings, config_findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Drift Check — D1 supersession propagation (surfaced)."
    )
    parser.add_argument("--repo-root", default=".", help="repo root (default: cwd)")
    parser.add_argument(
        "--out", default=None, help="report path (default: <repo>/docs/drift-report.md)"
    )
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve()
    out_path = Path(args.out) if args.out else repo_root / "docs" / "drift-report.md"
    try:
        markdown, findings, config_findings = run_check(repo_root=repo_root)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(markdown, encoding="utf-8")
        print(
            f"drift-check: {summary_line(findings)} | "
            f"{config_summary_line(config_findings)}  → {out_path}"
        )
    except Exception as exc:  # noqa: BLE001 — surfaced·비차단: 실패도 gate 금지
        print(
            f"drift-check: skipped (non-blocking) — {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
    return 0  # surfaced · never blocks (항상 exit 0)


if __name__ == "__main__":  # python3 -m scripts.drift_check.run 진입점
    raise SystemExit(main())
