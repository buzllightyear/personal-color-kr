"""Build the human-scoring artifacts from `out/runs.json`.

Outputs:
  - results.csv         one row per cell (model × recipe × variant × knob × selfie);
                        `arcface` filled, human columns blank.
  - contact_sheet.html  per (recipe × variant × selfie): input selfie | recipe
                        reference | each model×knob output, labeled with
                        origin / ArcFace / cost, grouped to compare at a glance.

Human rubric (enter 1–5 in results.csv, looking at contact_sheet.html):
  fidelity   — does the output deliver the recipe's promised look (vs reference)?
  ai_tell    — does it look like a real photo? (5 = indistinguishable, 1 = obviously AI)
  aesthetic  — does it make the person look good?
  korean_fit — are Korean/Asian features preserved (not "westernized")?
  artifact   — free of melt/extra-fingers/teeth glitches? (5 = clean, 1 = broken)

`ai_tell` here is the quick eyeball; the GOLD-STANDARD naturalness test is the
separate BLIND protocol (blind_ai_test.py). Score the `texture` probe variant too
— it exposes each model's intrinsic skin/texture signature with almost no styling.

Usage:
    python build_report.py
"""

from __future__ import annotations

import csv
import html
import json
from pathlib import Path

from config import OUT_DIR, RECIPES

HUMAN_COLS = ["fidelity", "ai_tell", "aesthetic", "korean_fit", "artifact", "notes"]

# LLM-vision pre-scores (filled by a vision pass, kept SEPARATE from the human
# columns so LLM↔human disagreement is itself a calibration signal — the cells
# where they diverge most are the ones worth re-eyeballing). Only the dimensions a
# vision model can judge from a single image; fidelity/aesthetic stay human-only.
LLM_COLS = ["llm_ai_tell", "llm_korean_fit", "llm_artifact", "llm_notes"]

_CSV_COLS = [
    "model",
    "origin",
    "recipe",
    "variant",
    "knob",
    "selfie",
    "arcface",
    "latency_s",
    "usd_est",
    "error",
    *LLM_COLS,
    *HUMAN_COLS,
]


def _write_csv(rows: list[dict], path: Path) -> None:
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=_CSV_COLS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({**r, **{c: "" for c in (*LLM_COLS, *HUMAN_COLS)}})


def _img(src: str, label: str) -> str:
    # Relative path so the html opens straight from out/.
    return (
        f'<figure><img src="{html.escape(src)}" loading="lazy">'
        f"<figcaption>{html.escape(label)}</figcaption></figure>"
    )


def _write_html(rows: list[dict], path: Path) -> None:
    by_cell: dict[tuple[str, str, str], list[dict]] = {}
    for r in rows:
        key = (r["recipe"], r.get("variant", ""), r["selfie"])
        by_cell.setdefault(key, []).append(r)
    ref_by_recipe = {rec.key: rec.reference for rec in RECIPES}

    parts = [
        "<!doctype html><meta charset=utf-8><title>fal eval contact sheet</title>",
        "<style>body{font:13px system-ui;margin:16px}h2{margin:24px 0 8px}"
        "section{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}"
        "figure{margin:0;width:200px}img{width:200px;height:200px;object-fit:cover;"
        "border:1px solid #ccc;border-radius:6px;background:#f4f4f4}"
        "figcaption{font-size:11px;color:#444;margin-top:2px}"
        ".anchor img{border-color:#000}.base figcaption{color:#b00}</style>",
    ]
    for (recipe, variant, selfie), cells in sorted(by_cell.items()):
        parts.append(
            f"<h2>{html.escape(recipe)} · {html.escape(variant)} · "
            f"{html.escape(selfie)}</h2><section>"
        )
        first = cells[0]
        parts.append(
            f'<div class=anchor>{_img(first["selfie_path"], "INPUT 셀카")}</div>'
        )
        ref = ref_by_recipe.get(recipe)
        if ref:
            parts.append(_img(ref, "REFERENCE (promised look)"))
        for c in sorted(cells, key=lambda r: (r["usd_est"], r.get("knob", ""))):
            af = c.get("arcface")
            af_s = f"id {af}" if af is not None else "id —"
            cls = " base" if "baseline" in c["origin"] else ""
            knob = c.get("knob", "")
            knob_s = "" if knob in ("", "default") else f" · {knob}"
            label = f'{c["model"]}{knob_s} · {c["origin"]} · {af_s} · ${c["usd_est"]}'
            if c["error"] and not c["error"].startswith("skipped"):
                label += f' · ✗{c["error"][:30]}'
            parts.append(f'<div class="cell{cls}">{_img(c["out_path"], label)}</div>')
        parts.append("</section>")
    path.write_text("".join(parts))


def main() -> None:
    out = Path(OUT_DIR)
    rows = json.loads((out / "runs.json").read_text())
    res = out / "results.csv"
    if res.exists():
        # Never clobber human scores already entered. Delete the file to regenerate.
        print(
            f"• {res} exists — keeping your scores (delete it to regenerate the blank sheet)"
        )
    else:
        _write_csv(rows, res)
        print(f"→ {res}  (fill human 1–5 columns)")
    _write_html(rows, out / "contact_sheet.html")
    print(f"→ {out / 'contact_sheet.html'}  (open in a browser to score)")


if __name__ == "__main__":
    main()
