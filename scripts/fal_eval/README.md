# fal.ai model eval harness (DRAFT — not wired into the app)

Picks the model (+ its naturalness setting) that best clears our **quality bar**
for selfie-restyle, with **naturalness (AI-티 없음) as the top priority**. Hits
`fal.run` **directly** (via the official `fal-client` SDK), bypassing the
product's orchestrator / reject filter / watermark, so each model is judged on
its **raw** output (variable isolation).

> Why these models (origin-diverse on purpose): 한국인 적합성 + AI-티 are
> *training-bound* (can't buy with $), so the matrix spans training lineages —
> Asia (Seedream, Qwen) / Google (Nano Banana) / West (FLUX) — not 5 FLUX
> variants. See `config.py`.

## Naturalness-first design (read this — it's the point)

Naturalness is **prompt-sensitive**, so one prompt per model would measure
"model × that prompt", not the model. The matrix disentangles it:

- **AI-tell has 3 sources** — (1) model-**intrinsic** texture [prompt-invariant;
  *this* is what we select a model on], (2) prompt-induced over-stylization
  [controllable], (3) post-processable grading. Only (1) is a model property.
- **Prompt variants** — every recipe runs at `neutral` / `realistic` / `stylized`
  (held identical across models) **plus** a recipe-independent `texture` probe
  that asks for ~no change, to expose each model's bare skin/texture signature.
- **Knobs, not prompts, are the biggest naturalness lever** — how far a model
  deviates from the real selfie (`strength` / `guidance_scale`). Each model
  declares a `knobs` sweep; the **prompt** is the blocked between-model factor,
  the **knob** is within-model tuning. The deployable unit is a `(model, knob)`.
- **Decision = naturalness FLOOR, not ceiling** — rank by the *worst* variant's
  `ai_tell`, because production recipes vary and we can't hand-tune each.
  `nat_spread` (max−min across variants) flags prompt-**fragile** models.

## What it measures
- **정체성 보존** → ArcFace cosine(input ↔ output) — *quantified* (`score_identity.py`).
- **AI 티 없음 / 레시피 충실도 / 미적 / 한국인 적합 / 아티팩트 / 의상 충실도** →
  human rubric (1–5), scored **blind** via `out/blind/blind_sheet.html` +
  `blind_scores.csv` (model/knob/cost hidden; `--unblind` maps scores back and
  reports test-retest self-agreement); naturalness additionally gets the
  separate spot-the-AI gold standard (`blind_ai_test.py`).
- **속도 / 비용** → latency + est. cost per cell, in `runs.json`.

## Two-stage funnel (bounds cost; resumable)
Driven by `config.FINALISTS`:
- **Stage 1 (screen)** — `FINALISTS = ()`: ALL models, a `SCREEN_SELFIE_LIMIT`
  subset of selfies, only `SCREEN_VARIANT_KEYS` (`texture`+`realistic`), each
  model's **first** knob. Cheap pass to drop clearly-AI / identity-failing models.
- **Stage 2 (deep)** — set `FINALISTS = ("seedream45", "flux2dev")`: finalists
  only, ALL selfies, ALL variants, full knob sweep. Re-running skips stage-1 cells
  (resumable), so you only pay for the new ones.

## Setup
```bash
cd scripts/fal_eval
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export FAL_KEY="<key_id>:<key_secret>"     # ⚠️ fal-client reads FAL_KEY (NOT FAL_API_KEY)
```
1. Put 5–10 **consented** KR test selfies in `selfies/` (varied tone/age/gender/
   lighting/glasses). ⚠️ no random people's faces — privacy.
2. (Blind AI-티 test) put a few more **held-out REAL** selfies — NOT used as
   inputs — in `real_holdout/`.
3. **(Pivot, STRATEGY §10)** put garment photos in `garments/` — mix **hanger/
   flat shots and worn shots** (fit is a garment×body property; worn shots carry
   it, flat shots don't — §10-A). Garment recipes (`garment_scene`,
   `garment_format`) pair each selfie with the first `GARMENT_PAIR_LIMIT`
   garments and pass the garment as the SECOND `image_urls[]` element. The
   `fluxdev_i2i` baseline is single-reference and skips garment cells. Scoring
   gains a `garment_fidelity` column (1–5, **bounded**: my garment's category/
   color/pattern/fit preserved — not pixel-level SKU matching) and summarize
   gates on `GARMENT_FLOOR` **fail-closed** (unscored garment cells or no
   garment cells = fail).
   - **Enrichment sidecars (§10-B axis)** — per garment photo, next to it:
     `<stem>.profile.json` (the 7-field §10-B profile: category/color/pattern/
     material/fit/length/details) and, for stage 2, `<stem>.txt` (free-text
     description). Garment cells run once per active enrichment key
     ({none, profile} at stage 1; + freeform at stage 2), injecting the sidecar
     into the prompt — this measures whether the production garment-
     understanding stage actually buys quality (the receipt for the
     "quality > hook immediacy" ruling). A missing sidecar fails the run
     LOUDLY at estimate time (a silently-skipped arm would bias the comparison).
   - **Garment-solo stage-0 (`garment_solo` recipe)** — garment × model cells
     with NO selfie (the garment is the single reference): can the model render
     my garment alone, faithfully? Single-reference models participate too.
4. In `config.py`, fill each recipe's **`realistic`** variant from the real
   resolved `prompt_template`, set `reference` to the recipe's `thumbnail_url`
   (fidelity target), and adjust the `neutral`/`stylized` variants if needed. The
   `texture` probe is recipe-independent — leave it. Model request schemas are
   **verified** (2026-06-25): the four editors take `prompt` + `image_urls[]`;
   the baseline `fluxdev_i2i` uses `image_url` + `strength`.

## Run order — scoring is BLIND by default (verifier-less zone ②)

The scorer (you) also knows each model's cost/origin/reputation, so a labeled
sheet contaminates the scores. `build_report.py` therefore produces a **blind**
sheet: outputs are copied to hash IDs (the file path can't leak the model),
labels show only the blind ID, order is hash-shuffled — inputs/reference stay
visible (you can't judge fidelity without them). ~`RETEST_PERCENT`% of cells
appear **twice** under different IDs (same image, $0): score them independently
— `--unblind` reports your own test-retest consistency per column.

```bash
# --- Stage 0 (optional cheap probe): garment-solo only ---
python run_matrix.py --recipes=garment_solo        # estimate (~$1.5 for 3 garments)
python run_matrix.py --recipes=garment_solo --yes  # → score via the blind flow below;
                                                   # drops models that can't even
                                                   # render the garment alone

# --- Stage 1 (FINALISTS empty in config.py) ---
python run_matrix.py        # ESTIMATE ONLY: prints new-cell count + max cost, no spend
python run_matrix.py --yes  # operator-approved paid run (INVARIANTS #8)
                            # → out/<model>/<recipe>/<variant>/<knob>/<selfie>[_<garment>][_enr-*]_<seed>.png + runs.json
python score_identity.py    # add ArcFace cosine(input↔output) to each row → runs.json
python build_report.py      # → results.csv + out/blind/{blind_sheet.html, blind_scores.csv}
# open blind_sheet.html, score 1–5 per blind ID in blind_scores.csv
# (do NOT open blind_map.csv; don't hand-edit results.csv human columns), then:
python build_report.py --unblind   # scores → results.csv + retest self-agreement
                                   # + labeled contact_sheet.html (safe now)
python summarize.py         # → per-(model,knob) table + §10-B enrichment-axis /
                            #   garment-solo views; pick finalists

# --- Stage 2 (set FINALISTS=(...) in config.py) ---
python run_matrix.py --yes  # deep sweep, finalists only (reuses stage-1 cells;
                            # blind IDs are stable — your stage-1 scores survive)
python score_identity.py && python build_report.py
# score the NEW blank blind rows, then:
python build_report.py --unblind && python summarize.py

# --- Naturalness gold standard (run on the finalists' outputs) ---
python blind_ai_test.py build   # → blind_deck.html + blind_responses.csv (+ hidden blind_key.csv)
# fill real|ai per idx in blind_responses.csv, then:
python blind_ai_test.py score   # → per-model fooled-rate + real-photo sanity baseline
```

`build_report.py --labeled` renders the labeled sheet early for debugging —
anything scored while looking at it is not blind (it warns).

## Cost
Per cell ≈ $0.02–0.08. **Stage 1** (2 selfies × 2 garments): person recipes
~40 + garment recipes × {none, profile} ~64 + garment-solo ~20 ≈ **~124 cells
≈ $5**. **Stage 2**: finalists only, all variants/knobs/selfies + freeform
enrichment. `run_matrix.py` prints the exact count × price before any spend,
and is resumable (skips existing) so reruns don't re-pay. Retest duplicates
cost **$0** (same image, scored twice).

## Bar calibration (the point)
A bar like "ArcFace ≥ 0.6" or "ai_tell ≥ 3.5 floor" is dead until anchored to
labeled real outputs. After scoring, look at the distributions next to your
"recognizably me?" / "real photo?" judgments and draw each floor where the human
score crosses "acceptable". **Naturalness especially** is set by the blind
spot-the-AI protocol — never in the abstract. Thresholds live at the top of
`summarize.py` (`IDENTITY_FLOOR`, `NATURALNESS_FLOOR`, …).
