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

from collections.abc import Callable
from dataclasses import dataclass, field

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
        None,  # fidelity target = the garment input itself, shown on the sheet
        (
            PromptVariant(
                "neutral",
                "the person from the first image wearing the garment from the "
                "second image, natural soft daylight, plain background, candid "
                "photo, identity unchanged, garment color and pattern preserved, "
                "realistic fit and drape",
            ),
            PromptVariant(
                "realistic",
                "the person from the first image wearing the garment from the "
                "second image, walking on a quiet Seoul street in the late "
                "afternoon, natural light, candid street-style photo, identity "
                "unchanged, garment faithfully rendered",
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
        None,
        (
            PromptVariant(
                "neutral",
                "the person from the first image wearing the garment from the "
                "second image, casual daylight snapshot, 35mm film grain, small "
                "orange film datestamp in the corner, identity unchanged, garment "
                "faithfully rendered",
            ),
            PromptVariant(
                "realistic",
                "the person from the first image wearing the garment from the "
                "second image, instagram-ready outfit post, analog film look with "
                "date stamp, natural pose, identity unchanged, garment color and "
                "fit preserved",
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
]

# ---------------------------------------------------------------------------
# Two-stage funnel (resumable: widening config re-runs only the new cells)
# ---------------------------------------------------------------------------
# Stage 1 (screen): FINALISTS empty → ALL models, a SCREEN subset of selfies,
#   only SCREEN_VARIANT_KEYS, and each model's FIRST (default) knob only. Cheap
#   pass to drop models that are clearly AI-y or fail the identity floor.
# Stage 2 (deep):   FINALISTS set   → finalists only, ALL selfies, ALL variants,
#   full per-model knob sweep. The naturalness FLOOR + stability decision.
FINALISTS: tuple[str, ...] = ()  # e.g. ("seedream45", "flux2dev") after stage 1
SCREEN_SELFIE_LIMIT = 4
SCREEN_VARIANT_KEYS: tuple[str, ...] = ("texture", "realistic")


def is_stage2() -> bool:
    return bool(FINALISTS)


def active_models() -> list[Model]:
    return [m for m in MODELS if not FINALISTS or m.key in FINALISTS]


def active_variant_keys() -> tuple[str, ...]:
    return ALL_VARIANT_KEYS if is_stage2() else SCREEN_VARIANT_KEYS


def active_knobs(model: Model) -> tuple[dict, ...]:
    return model.knobs if is_stage2() else model.knobs[:1]


def active_selfies(selfies: list) -> list:
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
GARMENT_PAIR_LIMIT = 2


def active_garments(garments: list) -> list:
    return garments[:GARMENT_PAIR_LIMIT]
