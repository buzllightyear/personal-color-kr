"""Build the human-scoring artifacts from `out/runs.json`.

Outputs:
  - results.csv         one row per cell (model × recipe × variant × knob ×
                        selfie × garment × seed); `arcface` filled, human
                        columns blank. UPSERT semantics: rows are keyed by the
                        canonical cell key — existing human scores are always
                        preserved, and cells added by widening the config
                        (stage 2, garment recipes) are appended blank. The key
                        is for dedupe/join only; aggregation stays (model, knob)
                        in summarize.py.
  - contact_sheet.html  per (recipe × variant × selfie × garment): input selfie
                        | garment input (garment cells) | recipe reference |
                        each model×knob output, labeled with origin / ArcFace /
                        cost, grouped to compare at a glance.

Human rubric (enter 1–5 in results.csv, looking at contact_sheet.html):
  fidelity   — does the output deliver the recipe's promised look (vs reference)?
  ai_tell    — does it look like a real photo? (5 = indistinguishable, 1 = obviously AI)
  aesthetic  — does it make the person look good?
  korean_fit — are Korean/Asian features preserved (not "westernized")?
  artifact   — free of melt/extra-fingers/teeth glitches? (5 = clean, 1 = broken)
  garment_fidelity — (garment cells only, else leave blank) does MY garment
                     render faithfully in the new scene/format — category,
                     color, pattern, and fit preserved? (5 = clearly my
                     garment, 1 = different garment). This is the BOUNDED
                     fidelity axis of STRATEGY §9-D/§10 — "believably my
                     clothes", NOT pixel-level SKU matching.

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

HUMAN_COLS = [
    "fidelity",
    "ai_tell",
    "aesthetic",
    "korean_fit",
    "artifact",
    "garment_fidelity",
    "notes",
]

# Canonical cell identity — dedupe/join/upsert ONLY (aggregation key stays
# (model, knob); see summarize.py).
CELL_KEY_COLS = ("model", "recipe", "variant", "knob", "selfie", "garment", "seed")

_CSV_COLS = [
    "model",
    "origin",
    "recipe",
    "variant",
    "knob",
    "selfie",
    "garment",
    "seed",
    "arcface",
    "latency_s",
    "usd_est",
    "error",
    *HUMAN_COLS,
]


def cell_key(row: dict) -> tuple[str, ...]:
    return tuple(str(row.get(c, "") or "") for c in CELL_KEY_COLS)


def _upsert_csv(runs: list[dict], path: Path) -> tuple[int, int]:
    """Merge runs into results.csv by cell key, never clobbering human scores.

    Returns (kept, added).
    """
    existing: dict[tuple[str, ...], dict] = {}
    if path.exists():
        with path.open() as fh:
            for row in csv.DictReader(fh):
                existing[cell_key(row)] = row

    merged: dict[tuple[str, ...], dict] = {}
    added = 0
    for run in runs:
        key = cell_key(run)
        prior = existing.get(key)
        row = {c: run.get(c, "") for c in _CSV_COLS if c not in HUMAN_COLS}
        if prior is None:
            row.update({c: "" for c in HUMAN_COLS})
            added += 1
        else:
            row.update({c: prior.get(c, "") for c in HUMAN_COLS})
            if not row.get("arcface"):
                row["arcface"] = prior.get("arcface", "")
        merged[key] = row
    # Preserve scored rows whose cells vanished from the config (never lose work).
    for key, prior in existing.items():
        merged.setdefault(key, prior)

    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=_CSV_COLS, extrasaction="ignore")
        w.writeheader()
        for key in sorted(merged):
            w.writerow(merged[key])
    return len(merged) - added, added


def _img(src: str, label: str) -> str:
    # Relative path so the html opens straight from out/.
    return (
        f'<figure><img src="{html.escape(src)}" loading="lazy">'
        f"<figcaption>{html.escape(label)}</figcaption></figure>"
    )


def _write_html(rows: list[dict], path: Path) -> None:
    by_cell: dict[tuple[str, str, str, str], list[dict]] = {}
    for r in rows:
        key = (r["recipe"], r.get("variant", ""), r["selfie"], r.get("garment", ""))
        by_cell.setdefault(key, []).append(r)
    ref_by_recipe = {rec.key: rec.reference for rec in RECIPES}

    parts = [
        "<!doctype html><meta charset=utf-8><title>fal eval contact sheet</title>",
        "<style>body{font:13px system-ui;margin:16px}h2{margin:24px 0 8px}"
        "section{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}"
        "figure{margin:0;width:200px}img{width:200px;height:200px;object-fit:cover;"
        "border:1px solid #ccc;border-radius:6px;background:#f4f4f4}"
        "figcaption{font-size:11px;color:#444;margin-top:2px}"
        ".anchor img{border-color:#000}.garment img{border-color:#06c}"
        ".base figcaption{color:#b00}</style>",
    ]
    for (recipe, variant, selfie, garment), cells in sorted(by_cell.items()):
        title = f"{html.escape(recipe)} · {html.escape(variant)} · {html.escape(selfie)}"
        if garment:
            title += f" · + {html.escape(garment)}"
        parts.append(f"<h2>{title}</h2><section>")
        first = cells[0]
        parts.append(
            f'<div class=anchor>{_img(first["selfie_path"], "INPUT 셀카")}</div>'
        )
        if garment and first.get("garment_path"):
            parts.append(
                f'<div class=garment>'
                f'{_img(first["garment_path"], "INPUT 옷 (fidelity target)")}</div>'
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
    kept, added = _upsert_csv(rows, res)
    print(f"→ {res}  ({kept} existing rows kept, {added} new blank rows added)")
    _write_html(rows, out / "contact_sheet.html")
    print(f"→ {out / 'contact_sheet.html'}  (open in a browser to score)")


if __name__ == "__main__":
    main()
