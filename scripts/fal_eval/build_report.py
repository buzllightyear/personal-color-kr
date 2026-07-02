"""Build the human-scoring artifacts from `out/runs.json` — BLIND by default.

Blind protocol (verifier-less zone ②, session 2026-07-02): the scorer is also
the operator who knows each model's cost/origin/reputation, so labeled scoring
contaminates the scores. Default run therefore produces a BLIND sheet:

  out/results.csv          one row per cell (canonical cell key; `arcface`
                           filled, human columns blank). UPSERT semantics —
                           existing human scores are always preserved; cells
                           added by widening the config are appended blank.
                           ⚠️ do NOT hand-edit human columns here — score in
                           blind_scores.csv and run --unblind.
  out/blind/blind_sheet.html   outputs grouped per (recipe × variant × selfie ×
                           garment) with the INPUTS visible (you can't judge
                           fidelity without them) but every output labeled ONLY
                           with a blind ID — model/knob/enrichment/cost/arcface
                           hidden, order hash-shuffled. Images are COPIED to
                           blind IDs so the file path can't leak the model.
  out/blind/blind_scores.csv   score 1–5 per rubric column, keyed by blind ID
                           (upsert — rebuilds keep your filled scores).
  out/blind/blind_map.csv  blind ID → cell key (+ retest flag). ⚠️ don't open
                           until scoring is done.

Test-retest (~RETEST_PERCENT% of cells, stable hash selection): the same image
appears twice under two different blind IDs — zero extra API cost; it measures
the RATER's self-consistency, reported at --unblind.

Usage:
    python build_report.py             # results.csv upsert + blind sheet
    python build_report.py --unblind   # blind scores → results.csv, retest
                                       # agreement report, labeled contact sheet
    python build_report.py --labeled   # labeled sheet EARLY (debug only —
                                       # contaminates blind scoring; warned)

Human rubric (1–5, in blind_scores.csv):
  fidelity   — does the output deliver the recipe's promised look (vs reference)?
  ai_tell    — does it look like a real photo? (5 = indistinguishable, 1 = obviously AI)
  aesthetic  — does it make the person look good?
  korean_fit — are Korean/Asian features preserved? (blank for garment-solo cells)
  artifact   — free of melt/extra-fingers/teeth glitches? (5 = clean, 1 = broken)
  garment_fidelity — (garment cells only, else blank) does MY garment render
                     faithfully — category, color, pattern, fit preserved?
                     (bounded axis, STRATEGY §9-D/§10 — NOT pixel SKU matching)
                     GARMENT-SOLO rule (operator decision 2026-07-02): if a
                     PERSON appears in a garment_solo output (the prompt says
                     "no person"), cap garment_fidelity at 2 and write "인물"
                     in notes — the model failed to ISOLATE the garment from a
                     worn input, which is the ability stage-0 exists to test.

`ai_tell` here is the quick eyeball; the GOLD-STANDARD naturalness test is the
separate BLIND protocol (blind_ai_test.py). Score the `texture` probe variant too.
"""

from __future__ import annotations

import csv
import hashlib
import html
import json
import os
import shutil
import statistics as st
import sys
from pathlib import Path

from config import OUT_DIR, RECIPES, RETEST_PERCENT

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
# (model, knob); see summarize.py). `enrichment` is the §10-B axis.
CELL_KEY_COLS = (
    "model",
    "recipe",
    "variant",
    "knob",
    "selfie",
    "garment",
    "enrichment",
    "seed",
)

_CSV_COLS = [
    "model",
    "origin",
    "recipe",
    "variant",
    "knob",
    "selfie",
    "garment",
    "enrichment",
    "seed",
    "arcface",
    "latency_s",
    "usd_est",
    "error",
    *HUMAN_COLS,
]


def cell_key(row: dict) -> tuple[str, ...]:
    # NB: `str(v or "")` would collapse int 0 (seed!) to "" while the CSV
    # round-trip yields "0" — every rebuild would then orphan all scored rows.
    return tuple("" if (v := row.get(c)) is None else str(v) for c in CELL_KEY_COLS)


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


# ---------------------------------------------------------------------------
# Blind mode
# ---------------------------------------------------------------------------


def _blind_id(key: tuple[str, ...], *, retest: bool = False) -> str:
    """Stable, non-positional blind ID — rebuilding/widening the matrix never
    renames a cell you already scored. Retest IDs use the same format so the
    scorer cannot tell a duplicate from a normal cell."""
    payload = "|".join(key) + ("|retest" if retest else "")
    return "B" + hashlib.sha256(payload.encode()).hexdigest()[:8]


def _is_retest_cell(key: tuple[str, ...]) -> bool:
    """~RETEST_PERCENT% of cells, as a stable per-cell hash property (widening
    the matrix never reshuffles which cells are duplicated)."""
    digest = hashlib.sha256(("|".join(key) + "|retest-select").encode()).hexdigest()
    return int(digest, 16) % 100 < RETEST_PERCENT


def _scoreable(rows: list[dict]) -> list[dict]:
    return [
        r
        for r in rows
        if (not r["error"] or str(r["error"]).startswith("skipped"))
        and Path(r["out_path"]).exists()
    ]


def _img(src: str, label: str) -> str:
    return (
        f'<figure><img src="{html.escape(src)}" loading="lazy">'
        f"<figcaption>{html.escape(label)}</figcaption></figure>"
    )


def _rel(path_or_url: str, html_dir: Path) -> str:
    """img src relative to the html file's own directory (paths in runs.json are
    cwd-relative); http(s) reference URLs pass through."""
    if path_or_url.startswith(("http://", "https://")):
        return path_or_url
    return os.path.relpath(path_or_url, html_dir)


_STYLE = (
    "<style>body{font:13px system-ui;margin:16px}h2{margin:24px 0 8px}"
    "section{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}"
    "figure{margin:0;width:200px}img{width:200px;height:200px;object-fit:cover;"
    "border:1px solid #ccc;border-radius:6px;background:#f4f4f4;cursor:zoom-in}"
    "figcaption{font-size:11px;color:#444;margin-top:2px}"
    ".anchor img{border-color:#000}.garment img{border-color:#06c}"
    ".base figcaption{color:#b00}"
    "#lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:none;"
    "flex-direction:column;align-items:center;justify-content:center;gap:8px;"
    "z-index:9;cursor:zoom-out}"
    "#lb img{width:auto;height:auto;max-width:96vw;max-height:92vh;"
    "object-fit:contain;border:0;border-radius:4px;background:none}"
    "#lbcap{color:#fff;font-size:14px}</style>"
)

# Click any image → full-size overlay (Esc or click to close). The caption
# (blind ID / label) is shown under the enlarged image for scoring.
_LIGHTBOX = (
    '<div id=lb><img alt=""><div id=lbcap></div></div>'
    "<script>"
    "document.addEventListener('click',function(e){"
    "var lb=document.getElementById('lb');"
    "if(e.target.closest('#lb')){lb.style.display='none';return}"
    "var f=e.target.closest('figure');if(!f)return;"
    "lb.querySelector('img').src=f.querySelector('img').src;"
    "var c=f.querySelector('figcaption');"
    "document.getElementById('lbcap').textContent=c?c.textContent:'';"
    "lb.style.display='flex'});"
    "document.addEventListener('keydown',function(e){"
    "if(e.key==='Escape')document.getElementById('lb').style.display='none'});"
    "</script>"
)


def _group_rows(rows: list[dict]) -> dict[tuple[str, str, str, str], list[dict]]:
    by_cell: dict[tuple[str, str, str, str], list[dict]] = {}
    for r in rows:
        key = (r["recipe"], r.get("variant", ""), r["selfie"], r.get("garment", ""))
        by_cell.setdefault(key, []).append(r)
    return by_cell


_REF_BY_RECIPE = {rec.key: rec.reference for rec in RECIPES}


def _group_header_parts(
    recipe: str, variant: str, selfie: str, garment: str, first: dict, html_dir: Path
) -> list[str]:
    """Shared between the blind and labeled sheets: title + input images.
    Inputs stay visible in BOTH modes — fidelity can't be judged without them;
    what blinding hides is the treatment (model/knob/enrichment), not the input."""
    title = f"{html.escape(recipe)} · {html.escape(variant)}"
    if selfie:
        title += f" · {html.escape(selfie)}"
    if garment:
        title += f" · + {html.escape(garment)}"
    parts = [f"<h2>{title}</h2><section>"]
    if first.get("selfie_path"):
        parts.append(
            f"<div class=anchor>"
            f'{_img(_rel(first["selfie_path"], html_dir), "INPUT 셀카")}</div>'
        )
    if garment and first.get("garment_path"):
        parts.append(
            f"<div class=garment>"
            f'{_img(_rel(first["garment_path"], html_dir), "INPUT 옷 (fidelity target)")}'
            f"</div>"
        )
    ref = _REF_BY_RECIPE.get(recipe)
    if ref:
        parts.append(_img(_rel(ref, html_dir), "REFERENCE (promised look)"))
    return parts


def _write_blind(rows: list[dict], out: Path) -> None:
    blind_dir = out / "blind"
    imgs_dir = blind_dir / "imgs"
    imgs_dir.mkdir(parents=True, exist_ok=True)

    # entries: (blind_id, row, is_retest) — retest cells appear twice.
    entries: list[tuple[str, dict, bool]] = []
    for r in _scoreable(rows):
        key = cell_key(r)
        entries.append((_blind_id(key), r, False))
        if _is_retest_cell(key):
            entries.append((_blind_id(key, retest=True), r, True))
    ids = [bid for bid, _, _ in entries]
    assert len(ids) == len(set(ids)), "blind-ID hash collision — widen the id length"

    for bid, r, _ in entries:
        dst = imgs_dir / f"{bid}.png"
        if not dst.exists():
            shutil.copyfile(r["out_path"], dst)

    # blind_map.csv — the key ⇄ id bridge. Not for the scorer's eyes.
    with (blind_dir / "blind_map.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["blind_id", "is_retest", *CELL_KEY_COLS])
        for bid, r, retest in sorted(entries):
            w.writerow([bid, int(retest), *cell_key(r)])

    # blind_scores.csv — upsert: keep already-filled scores across rebuilds.
    scores_path = blind_dir / "blind_scores.csv"
    existing: dict[str, dict] = {}
    if scores_path.exists():
        with scores_path.open() as fh:
            for row in csv.DictReader(fh):
                existing[row["blind_id"]] = row
    with scores_path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["blind_id", *HUMAN_COLS])
        w.writeheader()
        for bid, _, _ in sorted(entries):
            prior = existing.get(bid, {})
            w.writerow({"blind_id": bid, **{c: prior.get(c, "") for c in HUMAN_COLS}})

    # blind_sheet.html — inputs visible, outputs blind-labeled, hash-ordered.
    parts = [
        "<!doctype html><meta charset=utf-8><title>fal eval BLIND sheet</title>",
        _STYLE,
        "<p><b>BLIND scoring</b> — score 1–5 per column in <code>blind_scores.csv"
        "</code> by blind ID. Model / setting / cost are hidden on purpose; "
        "some images appear twice (that's intended — score them independently). "
        "Don't open <code>blind_map.csv</code> until you're done.</p>",
    ]
    grouped: dict[tuple[str, str, str, str], list[tuple[str, dict]]] = {}
    for bid, r, _ in entries:
        gkey = (r["recipe"], r.get("variant", ""), r["selfie"], r.get("garment", ""))
        grouped.setdefault(gkey, []).append((bid, r))
    for (recipe, variant, selfie, garment), group in sorted(grouped.items()):
        parts.extend(
            _group_header_parts(
                recipe, variant, selfie, garment, group[0][1], blind_dir
            )
        )
        for bid, _r in sorted(group):  # blind-ID (hash) order = deterministic shuffle
            parts.append(_img(f"imgs/{bid}.png", bid))
        parts.append("</section>")
    parts.append(_LIGHTBOX)
    (blind_dir / "blind_sheet.html").write_text("".join(parts))

    n_retest = sum(1 for _, _, retest in entries if retest)
    print(
        f"→ {blind_dir / 'blind_sheet.html'}  "
        f"({len(entries)} images to score, incl. {n_retest} retest duplicates)"
    )
    print(
        f"→ {scores_path}  (fill 1–5 per blind ID, then: python build_report.py --unblind)"
    )


def _unblind(out: Path) -> None:
    blind_dir = out / "blind"
    map_path = blind_dir / "blind_map.csv"
    scores_path = blind_dir / "blind_scores.csv"
    res_path = out / "results.csv"
    for p in (map_path, scores_path, res_path):
        if not p.exists():
            raise SystemExit(f"{p} not found — run `python build_report.py` first")

    with scores_path.open() as fh:
        scores = {r["blind_id"]: r for r in csv.DictReader(fh)}
    with map_path.open() as fh:
        mapping = list(csv.DictReader(fh))
    with res_path.open() as fh:
        results = {cell_key(r): r for r in csv.DictReader(fh)}

    # Primary entries → results.csv human columns (blind scores are the source
    # of truth; blank blind fields leave the existing value untouched).
    filled = 0
    retest_pairs: list[tuple[dict, dict]] = []
    for m in mapping:
        key = tuple(m[c] for c in CELL_KEY_COLS)
        score = scores.get(m["blind_id"])
        if score is None:
            continue
        if m["is_retest"] == "1":
            primary = scores.get(_blind_id(key))
            if primary is not None:
                retest_pairs.append((primary, score))
            continue
        row = results.get(key)
        if row is None:
            continue
        for c in HUMAN_COLS:
            if str(score.get(c, "")).strip():
                row[c] = score[c].strip()
                filled += 1

    with res_path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=_CSV_COLS, extrasaction="ignore")
        w.writeheader()
        for key in sorted(results):
            w.writerow(results[key])
    print(f"→ {res_path}  ({filled} score fields imported from the blind sheet)")

    # Test-retest self-agreement (rater reliability, verifier-less zone ②).
    numeric = [c for c in HUMAN_COLS if c != "notes"]
    print("\ntest-retest self-agreement (same image, scored twice blind):")
    any_pairs = False
    for col in numeric:
        diffs = []
        for a, b in retest_pairs:
            try:
                diffs.append(abs(float(a[col]) - float(b[col])))
            except (KeyError, TypeError, ValueError):
                continue
        if not diffs:
            print(f"  {col:18} — (no scored pairs)")
            continue
        any_pairs = True
        exact = sum(1 for d in diffs if d == 0) / len(diffs)
        print(
            f"  {col:18} n={len(diffs):3}  mean|Δ|={st.mean(diffs):.2f}  "
            f"exact-match={exact:.0%}"
        )
    if any_pairs:
        print(
            "  (mean|Δ| ≥ 1.0 on a column = your own scale drifted — consider "
            "re-anchoring and rescoring that column before trusting summarize.py)"
        )


def _write_labeled(rows: list[dict], path: Path) -> None:
    html_dir = path.parent
    parts = [
        "<!doctype html><meta charset=utf-8><title>fal eval contact sheet</title>",
        _STYLE,
    ]
    for (recipe, variant, selfie, garment), group in sorted(_group_rows(rows).items()):
        parts.extend(
            _group_header_parts(recipe, variant, selfie, garment, group[0], html_dir)
        )
        for c in sorted(group, key=lambda r: (r["usd_est"], r.get("knob", ""))):
            af = c.get("arcface")
            af_s = f"id {af}" if af is not None else "id —"
            cls = " base" if "baseline" in c["origin"] else ""
            knob = c.get("knob", "")
            knob_s = "" if knob in ("", "default") else f" · {knob}"
            enr = c.get("enrichment", "none")
            enr_s = "" if enr in ("", "none") else f" · enr:{enr}"
            label = f'{c["model"]}{knob_s}{enr_s} · {c["origin"]} · {af_s} · ${c["usd_est"]}'
            if c["error"] and not str(c["error"]).startswith("skipped"):
                label += f' · ✗{str(c["error"])[:30]}'
            parts.append(
                f'<div class="cell{cls}">'
                f'{_img(_rel(c["out_path"], html_dir), label)}</div>'
            )
        parts.append("</section>")
    parts.append(_LIGHTBOX)
    path.write_text("".join(parts))


def main() -> None:
    out = Path(OUT_DIR)
    rows = json.loads((out / "runs.json").read_text())
    res = out / "results.csv"
    kept, added = _upsert_csv(rows, res)
    print(f"→ {res}  ({kept} existing rows kept, {added} new blank rows added)")

    if "--unblind" in sys.argv:
        _unblind(out)
        _write_labeled(rows, out / "contact_sheet.html")
        print(f"→ {out / 'contact_sheet.html'}  (labeled — safe now, scoring is done)")
        return

    if "--labeled" in sys.argv:
        print(
            "⚠ LABELED sheet before scoring — model names/costs visible; "
            "anything you score while looking at this is NOT blind."
        )
        _write_labeled(rows, out / "contact_sheet.html")
        print(f"→ {out / 'contact_sheet.html'}")
        return

    _write_blind(rows, out)


if __name__ == "__main__":
    main()
