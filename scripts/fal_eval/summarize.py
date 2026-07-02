"""Per-(model, knob) decision table — run AFTER filling human scores in results.csv.

Naturalness-first ranking (the whole point of the variant matrix):

  Each model is run at multiple prompt variants (texture/neutral/realistic/stylized).
  We rank by the naturalness FLOOR — the WORST variant's `ai_tell` — not the best
  single result, because production recipes vary and we can't hand-tune each. The
  unit is a (model, knob) pair, since the deliverable is a model AND the
  edit-strength/guidance setting that keeps it natural.

  Pipeline:
    1. Gate on FLOORS (any model failing one is out, no matter how pretty):
         identity     arcface mean ≥ IDENTITY_FLOOR AND min ≥ IDENTITY_MIN_FLOOR
         artifact     mean ≥ FLOOR_5PT
         korean_fit   mean ≥ FLOOR_5PT
         naturalness  WORST-variant ai_tell ≥ NATURALNESS_FLOOR   ← top priority
    2. Rank survivors by naturalness floor, then by (fidelity+aesthetic), then cost.

  `spread` = max-min ai_tell across variants. High spread = prompt-FRAGILE
  naturalness (the model only looks real with the right prompt) — a risk flag even
  if the floor passes.

Usage:
    python summarize.py
"""

from __future__ import annotations

import csv
import json
import statistics as st
from pathlib import Path

from config import OUT_DIR

# Placeholder thresholds — CALIBRATE against labeled outputs (a bar is dead until
# you've seen what 0.5 vs 0.7 / a "3" vs "4" looks like next to real photos).
IDENTITY_FLOOR = 0.55
IDENTITY_MIN_FLOOR = 0.45
FLOOR_5PT = 3.5
NATURALNESS_FLOOR = 3.5  # worst-variant ai_tell must clear this

VARIANTS = ("texture", "neutral", "realistic", "crafted", "stylized")
HUMAN = ("fidelity", "ai_tell", "aesthetic", "korean_fit", "artifact")


def _fnums(rows: list[dict], col: str) -> list[float]:
    out = []
    for r in rows:
        try:
            out.append(float(r.get(col, "")))
        except (TypeError, ValueError):
            continue
    return out


def _mean(xs: list[float]) -> float | None:
    return round(st.mean(xs), 2) if xs else None


def main() -> None:
    out = Path(OUT_DIR)
    runs = {
        (
            r["model"],
            r["recipe"],
            r.get("variant", ""),
            r.get("knob", ""),
            r["selfie"],
        ): r
        for r in json.loads((out / "runs.json").read_text())
    }
    res_path = out / "results.csv"
    if not res_path.exists():
        raise SystemExit(
            "results.csv not found — run build_report.py and fill the human columns first"
        )

    with res_path.open() as fh:
        scored = list(csv.DictReader(fh))
    for r in scored:
        run = runs.get(
            (
                r["model"],
                r["recipe"],
                r.get("variant", ""),
                r.get("knob", ""),
                r["selfie"],
            ),
            {},
        )
        r["usd_est"] = run.get("usd_est", 0.0)
        r["latency_s"] = run.get("latency_s")

    # Aggregate per (model, knob) — the deployable unit.
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in scored:
        groups.setdefault((r["model"], r.get("knob", "")), []).append(r)

    summary = []
    for (model, knob), rows in groups.items():
        af = _fnums(rows, "arcface")

        def _floor_spread(col: str) -> tuple[dict[str, float | None], float | None]:
            pv = {
                v: _mean(_fnums([r for r in rows if r.get("variant") == v], col))
                for v in VARIANTS
            }
            vals = [m for m in pv.values() if m is not None]
            return pv, (min(vals) if vals else None)

        # Naturalness FLOOR = worst variant's ai_tell. Computed for BOTH the human
        # score and the LLM pre-score, kept side-by-side. Effective floor = human
        # when hand-scored, else the LLM pre-score — so stage-1 can screen on the
        # LLM pass ALONE before any hand-scoring (that's the point of B2).
        per_variant, nat_floor_h = _floor_spread("ai_tell")
        _llm_pv, nat_floor_llm = _floor_spread("llm_ai_tell")
        nat_floor = nat_floor_h if nat_floor_h is not None else nat_floor_llm
        nat_src = (
            "human"
            if nat_floor_h is not None
            else ("llm" if nat_floor_llm is not None else "—")
        )
        # |human − llm| on the floor; large = LLM and you disagree → re-eyeball.
        nat_agree = (
            round(nat_floor_h - nat_floor_llm, 2)
            if nat_floor_h is not None and nat_floor_llm is not None
            else None
        )
        nat_vals = [m for m in per_variant.values() if m is not None] or [
            m for m in _llm_pv.values() if m is not None
        ]
        nat_spread = round(max(nat_vals) - min(nat_vals), 2) if nat_vals else None

        rec = {
            "model": model,
            "knob": knob,
            "origin": rows[0].get("origin", ""),
            "n": len(rows),
            "id_mean": round(st.mean(af), 3) if af else None,
            "id_min": round(min(af), 3) if af else None,
            "nat_floor": nat_floor,
            "nat_src": nat_src,
            "nat_floor_llm": nat_floor_llm,
            "nat_agree": nat_agree,
            "nat_spread": nat_spread,
            "cost": float(rows[0]["usd_est"] or 0),
            **{f"nat_{v}": per_variant[v] for v in VARIANTS},
        }
        for col in HUMAN:
            rec[col] = _mean(_fnums(rows, col))
        # Effective artifact / korean_fit gate = human when scored, else the LLM
        # pre-score, so a stage-1 LLM-only pass can gate these floors too (B2).
        eff_art = (
            rec["artifact"]
            if rec["artifact"] is not None
            else _mean(_fnums(rows, "llm_artifact"))
        )
        eff_kr = (
            rec["korean_fit"]
            if rec["korean_fit"] is not None
            else _mean(_fnums(rows, "llm_korean_fit"))
        )

        id_ok = (
            rec["id_mean"] is not None
            and rec["id_mean"] >= IDENTITY_FLOOR
            and (rec["id_min"] or 0) >= IDENTITY_MIN_FLOOR
        )
        art_ok = eff_art is not None and eff_art >= FLOOR_5PT
        kr_ok = eff_kr is not None and eff_kr >= FLOOR_5PT
        nat_ok = nat_floor is not None and nat_floor >= NATURALNESS_FLOOR
        rec["floors_pass"] = bool(id_ok and art_ok and kr_ok and nat_ok)
        diffs = [rec[c] for c in ("fidelity", "aesthetic") if rec.get(c) is not None]
        rec["diff_score"] = round(st.mean(diffs), 2) if diffs else None
        summary.append(rec)

    # Rank: floor-passers first, then naturalness floor, then differentiators, then cost.
    summary.sort(
        key=lambda r: (
            not r["floors_pass"],
            -(r["nat_floor"] or 0),
            -(r["diff_score"] or 0),
            r["cost"],
        )
    )

    cols = [
        "model",
        "knob",
        "origin",
        "n",
        "floors_pass",
        "nat_floor",
        "nat_src",
        "nat_floor_llm",
        "nat_agree",
        "nat_spread",
        "nat_texture",
        "nat_neutral",
        "nat_realistic",
        "nat_crafted",
        "nat_stylized",
        "id_mean",
        "id_min",
        "fidelity",
        "aesthetic",
        "korean_fit",
        "artifact",
        "cost",
    ]
    with (out / "summary.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(summary)

    print(
        f"{'model':12} {'knob':16} {'gate':>5} {'natF':>5} {'src':>5} {'natL':>5} "
        f"{'agr':>5} {'sprd':>5} {'tex':>4} {'neu':>4} {'real':>4} {'cra':>4} "
        f"{'sty':>4} {'idM':>5} {'idm':>5} {'fid':>4} {'aes':>4} {'kr':>4} "
        f"{'art':>4} {'$':>6}"
    )
    for r in summary:
        flag = "PASS" if r["floors_pass"] else "fail"

        def s(x: object) -> str:
            return str(x) if x is not None else "—"

        print(
            f"{r['model']:12} {r['knob']:16} {flag:>5} {s(r['nat_floor']):>5} "
            f"{s(r['nat_src']):>5} {s(r['nat_floor_llm']):>5} {s(r['nat_agree']):>5} "
            f"{s(r['nat_spread']):>5} {s(r['nat_texture']):>4} {s(r['nat_neutral']):>4} "
            f"{s(r['nat_realistic']):>4} {s(r['nat_crafted']):>4} {s(r['nat_stylized']):>4} "
            f"{s(r['id_mean']):>5} {s(r['id_min']):>5} {s(r['fidelity']):>4} "
            f"{s(r['aesthetic']):>4} {s(r['korean_fit']):>4} {s(r['artifact']):>4} "
            f"{r['cost']:>6}"
        )

    # LLM↔human disagreement: cells where the two naturalness floors diverge ≥1.0
    # are the ones worth re-eyeballing (the whole reason llm_* is kept separate).
    disagree = [
        r
        for r in summary
        if (r["nat_agree"] is not None and abs(r["nat_agree"]) >= 1.0)
    ]
    if disagree:
        print(
            "\n⚠ LLM↔human naturalness disagree (|Δ|≥1.0) — re-eyeball: "
            + ", ".join(
                f"{r['model']}/{r['knob']}(Δ{r['nat_agree']})" for r in disagree
            )
        )
    print(f"\n→ {out / 'summary.csv'}")
    winners = [r for r in summary if r["floors_pass"]]
    if winners:
        w = winners[0]
        print(
            f"DECISION: best naturalness floor among floor-passers → "
            f"{w['model']} (knob={w['knob']}, nat_floor={w['nat_floor']}, "
            f"spread={w['nat_spread']}, ${w['cost']})"
        )
        fragile = [r for r in winners if (r["nat_spread"] or 0) >= 1.0]
        if fragile:
            print(
                "⚠ prompt-FRAGILE (nat_spread ≥ 1.0): "
                + ", ".join(f"{r['model']}/{r['knob']}" for r in fragile)
                + " — natural only with the right prompt; lock prompts in the recipe."
            )
    else:
        print(
            "DECISION: no (model, knob) cleared the floors — relax thresholds or widen the field."
        )


if __name__ == "__main__":
    main()
