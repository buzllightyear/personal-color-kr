"""Blind 'spot-the-AI' test — the gold-standard AI-티 measurement.

Pools held-out REAL selfies (`real_holdout/`, NOT used as generation inputs) with
the generated outputs, shuffles them, and presents each ALONE. A rater guesses
real/AI per image with no idea which model (or whether it's real) made it. A model
passes when its outputs are NOT reliably flagged as AI — i.e. a high "fooled" rate.

Two steps:
    python blind_ai_test.py build    # → blind_deck.html + blind_key.csv + blind_responses.csv
    # ... open blind_deck.html, write real/ai per idx into blind_responses.csv ...
    python blind_ai_test.py score    # → per-model fooled-rate + a real-photo sanity baseline

Keep the answer key (blind_key.csv) away from the rater until scoring.
"""

from __future__ import annotations

import csv
import html
import os
import random
import sys
from pathlib import Path

from config import OUT_DIR, REAL_HOLDOUT_DIR

_IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def _collect() -> list[dict]:
    deck: list[dict] = []
    for p in sorted(Path(REAL_HOLDOUT_DIR).glob("*")):
        if p.suffix.lower() in _IMG_EXT:
            deck.append({"label": "real", "source": "real", "path": str(p)})
    out = Path(OUT_DIR)
    # out/<model>/<recipe>/<variant>/<knob>/<selfie>.png — source = top-level model dir.
    for p in sorted(out.rglob("*.png")):
        deck.append(
            {"label": "ai", "source": p.relative_to(out).parts[0], "path": str(p)}
        )
    return deck


def build() -> None:
    deck = _collect()
    if not deck:
        raise SystemExit(
            f"nothing to test — add real photos to {REAL_HOLDOUT_DIR}/ and run the matrix first"
        )
    reals = sum(1 for d in deck if d["label"] == "real")
    random.seed(42)
    random.shuffle(deck)

    out = Path(OUT_DIR)
    with (out / "blind_key.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["idx", "label", "source", "path"])
        w.writeheader()
        for i, d in enumerate(deck):
            w.writerow({"idx": i, **d})
    with (out / "blind_responses.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["idx", "guess"])  # guess ∈ real|ai
        for i in range(len(deck)):
            w.writerow([i, ""])

    parts = [
        "<!doctype html><meta charset=utf-8><title>blind spot-the-AI</title>",
        "<style>body{font:13px system-ui;margin:16px}"
        ".g{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:180px}"
        "img{width:180px;height:240px;object-fit:cover;border:1px solid #ccc;border-radius:6px}"
        "figcaption{font-weight:700;text-align:center}</style>",
        "<p>For each image write <b>real</b> or <b>ai</b> next to its number in "
        "blind_responses.csv. Don't peek at blind_key.csv.</p><div class=g>",
    ]
    for i, d in enumerate(deck):
        rel = os.path.relpath(d["path"], out)
        parts.append(
            f'<figure><img src="{html.escape(rel)}" loading=lazy>'
            f"<figcaption>#{i}</figcaption></figure>"
        )
    parts.append("</div>")
    (out / "blind_deck.html").write_text("".join(parts))
    print(
        f"→ {out / 'blind_deck.html'}  ({len(deck)} images: {reals} real + {len(deck) - reals} AI)"
    )
    print(f"→ {out / 'blind_responses.csv'}  (fill 'guess' = real|ai)")
    print(f"• answer key hidden in {out / 'blind_key.csv'} — open only when scoring")


def _norm(g: str) -> str | None:
    g = g.strip().lower()
    if g in {"real", "r", "1"}:
        return "real"
    if g in {"ai", "a", "0"}:
        return "ai"
    return None


def score() -> None:
    out = Path(OUT_DIR)
    key = {int(r["idx"]): r for r in csv.DictReader((out / "blind_key.csv").open())}
    resp = {
        int(r["idx"]): _norm(r["guess"])
        for r in csv.DictReader((out / "blind_responses.csv").open())
    }

    per_source: dict[str, list[bool]] = {}  # source -> list of "guessed real?"
    real_correct = real_total = 0
    for idx, k in key.items():
        g = resp.get(idx)
        if g is None:
            continue
        if k["label"] == "real":
            real_total += 1
            real_correct += g == "real"
        else:  # AI output — "fooled" if rater called it real
            per_source.setdefault(k["source"], []).append(g == "real")

    print(f"{'model':14} {'n':>3} {'fooled%':>8}   (higher = looks more real)")
    rows = sorted(per_source.items(), key=lambda kv: -(sum(kv[1]) / len(kv[1])))
    for src, hits in rows:
        rate = 100 * sum(hits) / len(hits)
        print(f"{src:14} {len(hits):>3} {rate:>7.0f}%")
    if real_total:
        print(
            f"\nsanity — real photos called real: {100 * real_correct / real_total:.0f}% "
            f"({real_correct}/{real_total}); if this is near 50% the rater is just guessing."
        )


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        build()
    elif cmd == "score":
        score()
    else:
        raise SystemExit("usage: python blind_ai_test.py [build|score]")
