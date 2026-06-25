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
- **AI 티 없음 / 레시피 충실도 / 미적 / 한국인 적합 / 아티팩트** → human rubric
  (1–5) in `results.csv`, eyeballed via `contact_sheet.html`; naturalness gets a
  separate **blind** gold-standard test (`blind_ai_test.py`).
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
3. In `config.py`, fill each recipe's **`realistic`** variant from the real
   resolved `prompt_template`, set `reference` to the recipe's `thumbnail_url`
   (fidelity target), and adjust the `neutral`/`stylized` variants if needed. The
   `texture` probe is recipe-independent — leave it. Model request schemas are
   **verified** (2026-06-25): the four editors take `prompt` + `image_urls[]`;
   the baseline `fluxdev_i2i` uses `image_url` + `strength`.

## Run order
```bash
# --- Stage 1 (FINALISTS empty in config.py) ---
python run_matrix.py        # screen → out/<model>/<recipe>/<variant>/<knob>/<selfie>.png + runs.json
python score_identity.py    # add ArcFace cosine(input↔output) to each row → runs.json
python build_report.py      # → results.csv (human cols blank) + contact_sheet.html
# open contact_sheet.html, score 1–5 per dimension (incl. the texture probe), then:
python summarize.py         # → per-(model,knob) table; pick finalists by naturalness floor + identity

# --- Stage 2 (set FINALISTS=(...) in config.py) ---
python run_matrix.py        # deep sweep, finalists only (reuses stage-1 cells)
python score_identity.py && python build_report.py
python summarize.py         # naturalness-floor decision among finalists

# --- Naturalness gold standard (run on the finalists' outputs) ---
python blind_ai_test.py build   # → blind_deck.html + blind_responses.csv (+ hidden blind_key.csv)
# fill real|ai per idx in blind_responses.csv, then:
python blind_ai_test.py score   # → per-model fooled-rate + real-photo sanity baseline
```

## Cost
Per cell ≈ $0.02–0.08. **Stage 1**: 5 models × 4 selfies × (texture + 3×realistic)
× 1 knob = ~80 cells ≈ **$3**. **Stage 2**: 2 finalists × ~7 selfies × 4 variants ×
2 knobs (+ texture) ≈ ~120–170 cells ≈ **$5–8**. `run_matrix.py` is resumable
(skips existing) so reruns don't re-pay.

## Bar calibration (the point)
A bar like "ArcFace ≥ 0.6" or "ai_tell ≥ 3.5 floor" is dead until anchored to
labeled real outputs. After scoring, look at the distributions next to your
"recognizably me?" / "real photo?" judgments and draw each floor where the human
score crosses "acceptable". **Naturalness especially** is set by the blind
spot-the-AI protocol — never in the abstract. Thresholds live at the top of
`summarize.py` (`IDENTITY_FLOOR`, `NATURALNESS_FLOOR`, …).
