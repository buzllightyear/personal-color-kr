"""Eval-harness config — models (origin-diverse), recipes×prompt-variants, knobs, stages.

Naturalness-first design (why the matrix is shaped this way)
-----------------------------------------------------------
The top priority is *naturalness* (AI-티 없음). Naturalness is highly
prompt-sensitive, so a single prompt per model would measure "model × that
prompt", not the model. We disentangle it:

* AI-tell has 3 sources — (1) model-INTRINSIC texture [prompt-invariant; this is
  what we actually select a model on], (2) prompt-induced over-stylization
  [controllable], (3) post-processable grading. Only (1) is a model property.
* So every recipe is run at THREE prompt variants held identical across models —
  `neutral` (minimal styling, lets intrinsic texture show), `realistic` (the
  production look), `stylized` (pushed, to stress-test where AI-tell appears) —
  plus a recipe-independent `texture` probe that asks for almost no change, to
  expose each model's bare skin/texture signature.
* The biggest naturalness lever is NOT the prompt but how far the model deviates
  from the real selfie (edit-strength / guidance). That is a per-model knob, so
  each model declares a `knobs` sweep; the PROMPT is the blocked between-model
  factor, the KNOB is within-model tuning to give each model its best shot.
* Decision rule (see summarize.py): rank by the naturalness FLOOR (worst variant),
  not the best single result — production recipes vary and we can't hand-tune each.

Cost is bounded by a two-stage funnel (see FINALISTS below); it is resumable, so
widening the config re-runs only the new cells.

Request schemas VERIFIED against each model's fal API page (2026-06-25): all four
editors take `prompt` + `image_urls[]`. Output normalized to ~1MP portrait via
each model's own size knob (`extra`) so cost (per-MP) and framing are comparable.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

# ~1MP, 3:4 portrait (matches a phone selfie; keeps per-MP cost ~1×).
PORTRAIT = {"width": 896, "height": 1152}

# ---------------------------------------------------------------------------
# Candidate models
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Model:
    key: str  # short label → output dir
    endpoint: str  # fal model path (POST https://fal.run/{endpoint})
    origin: str  # training lineage — the non-buyable axis we're spanning
    usd_per_image: float  # rough cost for ~1MP output (VERIFY on the model page)
    # (selfie_url, prompt, garment_url=None) -> request args
    build_args: Callable[..., dict]
    extra: dict = field(default_factory=dict)  # size + fixed per-model knobs
    # Naturalness-knob sweep: each dict is merged LAST (overrides `extra`). One
    # cell per knob. `({},)` = no knob (single default cell). Only models with a
    # verified deviation knob sweep; the rest stay single.
    knobs: tuple[dict, ...] = ({},)
    # Multi-reference capable (selfie + garment as image_urls[]). The single-ref
    # baseline cannot take a garment; garment cells skip it.
    supports_garment: bool = True


def _ref_urls(selfie_url: str, prompt: str, garment_url: str | None = None) -> dict:
    """All four editors (Seedream/Qwen/Nano Banana/FLUX.2): prompt + image_urls[].

    The garment, when present, is the SECOND element — prompts refer to
    "the first image" (person) and "the second image" (garment).
    """
    urls = [selfie_url] + ([garment_url] if garment_url else [])
    return {"prompt": prompt, "image_urls": urls}


def _flux_i2i(selfie_url: str, prompt: str, garment_url: str | None = None) -> dict:
    """Negative baseline — plain FLUX.1 dev i2i (no identity mechanism)."""
    if garment_url is not None:
        raise ValueError("fluxdev_i2i is single-reference; garment cells must skip it")
    return {"prompt": prompt, "image_url": selfie_url}


MODELS: list[Model] = [
    Model(
        "seedream45",
        "fal-ai/bytedance/seedream/v4.5/edit",
        "Asia/ByteDance",
        0.04,
        _ref_urls,
        extra={"image_size": PORTRAIT, "num_images": 1},
    ),
    Model(
        "qwen2",
        "fal-ai/qwen-image-2/edit",
        "Asia/Alibaba",
        0.035,
        _ref_urls,
        extra={"image_size": "portrait_4_3", "num_images": 1},
    ),
    Model(
        "nanobanana2",
        "fal-ai/nano-banana-2/edit",
        "Google",
        0.08,
        _ref_urls,
        extra={"resolution": "1K", "aspect_ratio": "3:4", "num_images": 1},
    ),
    # Efficiency variant of Nano Banana 2 (operator request 2026-07-02) — sub-2s
    # latency, ~half the 2/edit price. Endpoint + `prompt`/`image_urls[]` schema
    # verified on the fal model page 2026-07-02; output is fixed 1K, so
    # aspect_ratio is the only size knob (price: VERIFY on the model page).
    Model(
        "nanobanana2lite",
        "google/nano-banana-2-lite/edit",
        "Google(lite)",
        0.039,
        _ref_urls,
        extra={"aspect_ratio": "3:4"},
    ),
    Model(
        "flux2dev",
        "fal-ai/flux-2/edit",
        "West/BFL",
        0.024,
        _ref_urls,
        extra={"image_size": PORTRAIT, "num_inference_steps": 28, "num_images": 1},
        # Naturalness lever: lower guidance = less "AI-perfect / forced" look.
        knobs=({"guidance_scale": 1.8}, {"guidance_scale": 3.0}),
    ),
    # Negative baseline — the product's prior default approach. Expect identity drift.
    Model(
        "fluxdev_i2i",
        "fal-ai/flux/dev/image-to-image",
        "West/BFL(baseline)",
        0.025,
        _flux_i2i,
        extra={"image_size": PORTRAIT},
        # Naturalness lever (biggest for i2i): lower strength preserves the real
        # selfie's photographic texture. Light vs heavier edit.
        knobs=({"strength": 0.45}, {"strength": 0.7}),
        supports_garment=False,
    ),
]

# ---------------------------------------------------------------------------
# Recipes × prompt variants
# ---------------------------------------------------------------------------

# Variant keys, ordered cheap-signal-first. The `texture` probe is recipe-
# independent (lives on the synthetic `texture_probe` recipe only).
ALL_VARIANT_KEYS: tuple[str, ...] = ("texture", "neutral", "realistic", "stylized")


@dataclass(frozen=True)
class PromptVariant:
    key: str  # one of ALL_VARIANT_KEYS
    text: str  # ⚠️ PLACEHOLDER copy — fill `realistic` from the seeded prompt_template


@dataclass(frozen=True)
class Recipe:
    key: str
    reference: (
        str | None
    )  # thumbnail_url (= promised look / fidelity target); None for probe
    variants: tuple[PromptVariant, ...]
    # Pivot (STRATEGY §10): the daily loop is "my real garment × this week's
    # trend+format". Garment recipes pair each selfie with a garment photo and
    # pass it as the second image_urls[] element; models with
    # supports_garment=False are skipped for these cells.
    needs_garment: bool = False
    # Stage-0 probe (STRATEGY §10-B pre-stage): garment-ONLY cells — no selfie,
    # the garment photo is the single reference image. "Before dressing a person,
    # the garment alone must render faithfully." Single-reference models can run
    # these too (the garment takes the sole image slot).
    garment_only: bool = False


# `texture` probe: ask for ~no change, to expose each model's intrinsic skin/texture.
_TEXTURE_PROBE = Recipe(
    "texture_probe",
    None,
    (
        PromptVariant(
            "texture",
            "the same person, identity unchanged, natural soft daylight, plain "
            "neutral background, candid unretouched photo, realistic skin pores "
            "and fine texture, no makeup change",
        ),
    ),
)

RECIPES: list[Recipe] = [
    _TEXTURE_PROBE,
    Recipe(
        "glow_makeup",
        "https://REPLACE_WITH/thumbnail_glow.jpg",
        (
            PromptVariant(
                "neutral",
                "투명 글로우 메이크업 느낌만 살짝, natural skin texture, soft daylight, "
                "minimal retouch, realistic Korean face",  # PLACEHOLDER
            ),
            PromptVariant(
                "realistic",
                "투명 글로우 메이크업, dewy luminous skin, natural Korean beauty, "
                "soft studio glow, photographic",  # PLACEHOLDER ← fill from seed prompt_template
            ),
            PromptVariant(
                "stylized",
                "투명 글로우 메이크업, editorial beauty campaign, glossy high-fashion "
                "glamour, vivid saturated, heavy glow retouch, magazine cover",  # PLACEHOLDER
            ),
        ),
    ),
    Recipe(
        "film_mood",
        "https://REPLACE_WITH/thumbnail_film.jpg",
        (
            PromptVariant(
                "neutral",
                "필름 카메라 느낌만 약간, natural 35mm look, muted, candid, realistic "
                "skin texture, minimal edit",  # PLACEHOLDER
            ),
            PromptVariant(
                "realistic",
                "필름 카메라 무드, analog 35mm film grain, muted tones, nostalgic, "
                "candid portrait",  # PLACEHOLDER ← fill from seed prompt_template
            ),
            PromptVariant(
                "stylized",
                "필름 카메라 무드, heavy cinematic teal-orange grade, dramatic film "
                "stock, stylized vignette, moody editorial",  # PLACEHOLDER
            ),
        ),
    ),
    Recipe(
        "summer_look",
        "https://REPLACE_WITH/thumbnail_summer.jpg",
        (
            PromptVariant(
                "neutral",
                "청량 여름 느낌만 살짝, bright natural daylight, fresh, realistic skin, "
                "minimal retouch",  # PLACEHOLDER
            ),
            PromptVariant(
                "realistic",
                "청량 여름 룩, fresh summer vibe, bright natural light, clean clear "
                "skin",  # PLACEHOLDER ← fill from seed prompt_template
            ),
            PromptVariant(
                "stylized",
                "청량 여름 룩, vibrant tropical editorial, glossy sun-kissed glamour, "
                "hyper-saturated, beauty campaign",  # PLACEHOLDER
            ),
        ),
    ),
    # ---- Pivot garment recipes (§10 ii-a: operator curates the TREATMENT —
    # scene/lighting/format; the user's garment is the raw material). Prompts
    # refer to image order: first = person, second = garment. Identical across
    # models (blocked factor), like the three variants above.
    Recipe(
        "garment_scene",
        # Operator-curated trend mood ref (2026-07-03): off-guard walking candid.
        "trend_refs/deec217fa5cd19f405d211584cc1fafd.jpg",
        (
            PromptVariant(
                "neutral",
                "the person from the first image wearing the garment from the "
                "second image, natural soft daylight, plain background, candid "
                "photo, identity unchanged, garment color and pattern preserved, "
                "realistic fit and drape",
            ),
            # Operator-approved 2026-07-03 (distilled from trend_refs).
            PromptVariant(
                "realistic",
                "the person from the first image wearing the garment from the "
                "second image, off-guard candid snap taken by a friend on a "
                "phone while walking mid-stride on a city street, natural "
                "light, un-staged amateur snapshot realism, slightly imperfect "
                "framing, identity unchanged, garment faithfully rendered",
            ),
            PromptVariant(
                "stylized",
                "the person from the first image wearing the garment from the "
                "second image, editorial fashion shoot, dramatic studio lighting, "
                "high-fashion styling, identity unchanged, garment color and "
                "pattern preserved",
            ),
        ),
        needs_garment=True,
    ),
    Recipe(
        "garment_format",
        # Operator-curated trend mood ref (2026-07-03): 0.5x ultra-wide selfie.
        # (UI/text/sticker overlays in the refs are format_template compositing
        # territory — generation carries only composition/light/snapshot grain.)
        "trend_refs/557fac2d1c432dda5829ee84ccfa0354.jpg",
        (
            PromptVariant(
                "neutral",
                "the person from the first image wearing the garment from the "
                "second image, casual daylight snapshot, 35mm film grain, small "
                "orange film datestamp in the corner, identity unchanged, garment "
                "faithfully rendered",
            ),
            # Operator-approved 2026-07-03 (distilled from trend_refs).
            PromptVariant(
                "realistic",
                "the person from the first image wearing the garment from the "
                "second image, 0.5x ultra-wide front-camera selfie from a "
                "playful low angle, mild wide-angle distortion, indoor natural "
                "light, casual off-guard expression, phone snapshot look, "
                "identity unchanged, garment color and fit preserved",
            ),
            PromptVariant(
                "stylized",
                "the person from the first image wearing the garment from the "
                "second image, magazine editorial layout mood, polaroid frame "
                "aesthetic, styled composition, identity unchanged, garment "
                "faithfully rendered",
            ),
        ),
        needs_garment=True,
    ),
    # Stage-0 probe (§10-B): can the model render MY garment alone, faithfully,
    # as a clean normalized shot? If not, dressing a person with it is moot.
    # Single variant (bounds cost); runs at both stages ("realistic" is in the
    # screen variant set).
    Recipe(
        "garment_solo",
        None,
        (
            PromptVariant(
                "realistic",
                "clean catalog product photo of the garment from the image, "
                "laid flat on a plain light-grey background, soft even studio "
                "light, no person, accurate color, pattern, material and shape, "
                "photorealistic",
            ),
        ),
        needs_garment=True,
        garment_only=True,
    ),
]

# ---------------------------------------------------------------------------
# Enrichment axis (STRATEGY §10-B eval implication)
# ---------------------------------------------------------------------------
# The production harness will run a garment-understanding stage before
# generation and inject its output (the "garment profile") into the prompt.
# This axis measures whether that injection actually buys quality — the receipt
# for the operator's "quality > hook immediacy" ruling — and WHICH injection
# form buys the most. Applies to garment cells only:
#
#   none      — the prompt as-is (today's baseline)
#   freeform  — append a free-text garment description
#               (sidecar: garments/<stem>.txt, operator/VLM-authored)
#   profile   — append a structured garment profile rendered from the §10-B
#               7-field contract (sidecar: garments/<stem>.profile.json)
#
# Sidecars are REQUIRED for active enrichment keys — enumeration fails loud if
# one is missing (a silently-skipped condition would bias the comparison).
# Stage 1 screens the extremes (none vs profile: does understanding help at
# all?); stage 2 adds freeform (which form?).

ENRICHMENT_KEYS: tuple[str, ...] = ("none", "freeform", "profile")
SCREEN_ENRICHMENT_KEYS: tuple[str, ...] = ("none", "profile")

# The §10-B garment-profile contract: 7 fields (카테고리·색·패턴·소재감·핏·기장·디테일).
GARMENT_PROFILE_FIELDS: tuple[str, ...] = (
    "category",
    "color",
    "pattern",
    "material",
    "fit",
    "length",
    "details",
)


def garment_info_text(garment: Path, enrichment: str) -> str | None:
    """Sidecar text to inject for (garment, enrichment); None for 'none'.

    Fails loud (SystemExit) on a missing/empty/invalid sidecar so a forgotten
    file can never silently degrade one arm of the comparison.
    """
    if enrichment == "none":
        return None
    if enrichment == "freeform":
        sidecar = garment.with_name(garment.stem + ".txt")
        if not sidecar.exists():
            raise SystemExit(
                f"enrichment '{enrichment}' is active but {sidecar} is missing — "
                f"write a free-text description of {garment.name} there"
            )
        text = sidecar.read_text().strip()
        if not text:
            raise SystemExit(f"{sidecar} is empty — write the garment description")
        return text
    if enrichment == "profile":
        sidecar = garment.with_name(garment.stem + ".profile.json")
        if not sidecar.exists():
            raise SystemExit(
                f"enrichment '{enrichment}' is active but {sidecar} is missing — "
                f"fill the §10-B profile: "
                f'{{{", ".join(f_ + ": …" for f_ in GARMENT_PROFILE_FIELDS)}}}'
            )
        profile = json.loads(sidecar.read_text())
        missing = [
            f_ for f_ in GARMENT_PROFILE_FIELDS if not str(profile.get(f_, "")).strip()
        ]
        extra = [k for k in profile if k not in GARMENT_PROFILE_FIELDS]
        if missing or extra:
            raise SystemExit(
                f"{sidecar} must have exactly the 7 §10-B fields — "
                f"missing/empty: {missing or '—'}, unknown: {extra or '—'}"
            )
        return "; ".join(
            f"{f_}: {str(profile[f_]).strip()}" for f_ in GARMENT_PROFILE_FIELDS
        )
    raise SystemExit(f"unknown enrichment key: {enrichment!r}")


def enriched_prompt(variant_text: str, enrichment: str, garment: Path | None) -> str:
    """The prompt actually sent for a cell — variant text + optional injection."""
    info = garment_info_text(garment, enrichment) if garment is not None else None
    if info is None:
        return variant_text
    return f"{variant_text}. The garment is: {info}"


# ---------------------------------------------------------------------------
# Two-stage funnel (resumable: widening config re-runs only the new cells)
# ---------------------------------------------------------------------------
# Stage 1 (screen): FINALISTS empty → ALL models, a SCREEN subset of selfies,
#   only SCREEN_VARIANT_KEYS, and each model's FIRST (default) knob only. Cheap
#   pass to drop models that are clearly AI-y or fail the identity floor.
# Stage 2 (deep):   FINALISTS set   → finalists only, ALL selfies, ALL variants,
#   full per-model knob sweep. The naturalness FLOOR + stability decision.
# Operator decisions: 2026-07-03 1차 — lite+seedream45 (stage-0 근거). 2차 —
# 착장 프로브에서 seedream45 완전 탈락(착장 픽 10% + 얼굴 보존 불능 판정) →
# dressing model = lite 단독. lite: 착장픽 14/17, 시도당 58%, 약점 = 얼굴
# 드리프트 + 핏 각색 (→ PROMPT_RX 고삐 프로브가 수리 가능성 검사).
FINALISTS: tuple[str, ...] = ("nanobanana2lite",)
SCREEN_SELFIE_LIMIT = 4
SCREEN_VARIANT_KEYS: tuple[str, ...] = ("texture", "realistic")


def is_stage2() -> bool:
    return bool(FINALISTS)


# ---- Probe overrides: operator-scoped small rounds (e.g. the 착장 프로브)
# that need a narrower matrix than the stage defaults. Empty/None = follow the
# stage. Combine with `run_matrix.py --recipes=...` to scope recipes.
PROBE_VARIANT_KEYS: tuple[str, ...] = ("realistic",)  # 착장 프로브 2026-07-03
PROBE_SELFIE_LIMIT: int | None = 2  # 여1·남1 (halved scope, operator 2026-07-03)
# Enrichment axis OFF — disconfirmed across two rounds (STRATEGY §10-B note).
PROBE_ENRICHMENT_KEYS: tuple[str, ...] = ("none",)

# ---- Prompt-Rx axis (고삐 프로브, operator-approved 2026-07-03): can prompt
# phrases repair lite's two defects — face drift (42% of attempts) and fit
# adaptation (원핏 고정 = operator MVP default)? Applies to garment cells only;
# "" = baseline (same prompt as the previous round → cells are reused, $0).
# If a phrase works it becomes the production prompt_template's base scaffold.
_RX_FACE = (
    ", the face is an exact, unmodified likeness of the person in the first "
    "image — identical facial features, face shape and skin tone, no "
    "beautification, no face repainting"
)
_RX_FIT = (
    ", preserve the garment's original fit and silhouette exactly as shown in "
    "the second image — do not slim, crop, or tailor it to the wearer's body"
)
PROMPT_RX: dict[str, str] = {
    "": "",
    "face": _RX_FACE,
    "fit": _RX_FIT,
    "face_fit": _RX_FACE + _RX_FIT,
}
ACTIVE_RX_KEYS: tuple[str, ...] = ("", "face", "fit", "face_fit")


def active_models() -> list[Model]:
    return [m for m in MODELS if not FINALISTS or m.key in FINALISTS]


def active_variant_keys() -> tuple[str, ...]:
    if PROBE_VARIANT_KEYS:
        return PROBE_VARIANT_KEYS
    return ALL_VARIANT_KEYS if is_stage2() else SCREEN_VARIANT_KEYS


def active_knobs(model: Model) -> tuple[dict, ...]:
    return model.knobs if is_stage2() else model.knobs[:1]


def active_enrichment_keys() -> tuple[str, ...]:
    if PROBE_ENRICHMENT_KEYS:
        return PROBE_ENRICHMENT_KEYS
    return ENRICHMENT_KEYS if is_stage2() else SCREEN_ENRICHMENT_KEYS


def active_selfies(selfies: list) -> list:
    if PROBE_SELFIE_LIMIT is not None:
        return selfies[:PROBE_SELFIE_LIMIT]
    return selfies if is_stage2() else selfies[:SCREEN_SELFIE_LIMIT]


def knob_label(knob: dict) -> str:
    """Filesystem-safe label for a knob dict ('default' for no knob)."""
    if not knob:
        return "default"
    return "_".join(f"{k}{v}" for k, v in sorted(knob.items()))


# ---------------------------------------------------------------------------
# Run settings
# ---------------------------------------------------------------------------

SELFIE_DIR = "selfies"  # consented KR test selfies (*.jpg / *.png)
REAL_HOLDOUT_DIR = "real_holdout"  # REAL selfies NOT used as inputs — for blind AI-티
GARMENT_DIR = "garments"  # garment photos (hanger + worn shots; §10-A fit note)
OUT_DIR = "out"
SEEDS_PER_CELL = 1  # >1 also measures consistency (varies seed; multiplies cost)
# Garment cells pair each selfie with the first N garments (NOT the full
# cross-product) to bound cost. Raise deliberately for stage 2 if needed.
GARMENT_PAIR_LIMIT = 3
# Test-retest (verifier-less zone ②, rater reliability): ~this % of scoreable
# cells appear TWICE in the blind sheet under different blind IDs (same image,
# zero extra API cost). Selection is a stable hash property of the cell key, so
# rebuilding/widening never reshuffles which cells are duplicated. The unblind
# step reports per-column self-agreement (mean |Δ|).
RETEST_PERCENT = 10


def active_garments(garments: list) -> list:
    return garments[:GARMENT_PAIR_LIMIT]
