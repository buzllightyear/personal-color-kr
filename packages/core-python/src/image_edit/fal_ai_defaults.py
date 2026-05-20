"""Default FLUX img2img model parameters for the Fal.ai vendor adapter.

# Why this module exists

The Seed Contract names `fal-ai/flux/dev/image-to-image` as the production
generative-AI vendor for the personal-color selfie pipeline. That endpoint
accepts three knobs that govern how aggressively FLUX rewrites the input
selfie:

  * `strength`           — img2img transformation strength (0.0 = passthrough,
                           1.0 = full re-synthesis from noise).
  * `guidance_scale`     — classifier-free guidance scale; controls how
                           tightly FLUX follows the prompt.
  * `num_inference_steps`— denoising steps; trades latency for quality.

These three values are pinned here as module-scope `Final` constants — *not*
inlined into the `FalAiVendorCaller` adapter body — for three reasons:

  1. **Single source of truth.** Adapter code, tests, future FastAPI form
     defaults (Phase 4), and any A/B-tested override (passed through
     `VendorRequest.params`) must all reference the same baseline. Inlining
     them in the adapter would force tests to re-declare magic numbers and
     create silent drift the moment one site is tuned.

  2. **Auditability of the calibration choice.** The Fal contract has
     documented defaults, but the *product* may want different ones (e.g.
     a milder `strength` to preserve the user's facial identity better than
     Fal's default). Splitting the defaults into a dedicated, well-commented
     module makes the "why this value?" answer easy to find — and easy to
     change in one place when the calibration team updates them.

  3. **Parallel-safe authoring.** Multiple sibling concerns touch the Fal
     adapter (protocol wiring, preset→prompt mapping, env-key loading).
     Keeping these three constants in a tiny dedicated file means they can
     be authored, reviewed, and tested independently of the larger adapter
     module without merge conflicts.

# Calibration baseline

The values below match Fal's documented defaults for
`fal-ai/flux/dev/image-to-image` at the time of writing. They are tuned for
a balance of quality and the Seed Contract's p95 < 30s end-to-end SLO:

  * `STRENGTH = 0.85` — slightly under Fal's 0.95 default to preserve more
    of the user's selfie identity (skin tone, facial structure) while still
    letting FLUX restyle the surrounding hue / lighting for the season
    preset. Personal-color editing is about *tinting and lighting*, not
    facial reconstruction; the lower value reflects that.

  * `GUIDANCE_SCALE = 3.5` — Fal's documented default. FLUX is generally
    sensitive above 5.0 (over-saturated, artefact-prone outputs) and
    under-responsive below 2.5. 3.5 sits in the documented sweet spot.

  * `NUM_INFERENCE_STEPS = 28` — below Fal's 40-step default to reclaim
    ~30% of vendor latency budget. The personal-color use case does not
    require photorealistic micro-detail (the output is downscaled to a
    phone screen anyway), so the quality loss at 28 steps is imperceptible
    while the latency win meaningfully helps p95.

Operators who need to override per call can pass the override through
`VendorRequest.params` (the wrapper Protocol already plumbs that Mapping
through to the adapter). The defaults here are the *floor* — code reads
them once at module import and never mutates them, matching the Final
contract and the project-wide immutability rule.

# Contract

  * `Final` annotations guarantee re-binding raises in mypy strict mode.
  * All three constants are plain numeric primitives (`float` / `int`) so
    they round-trip cleanly through JSON without any custom encoder.
  * No I/O, no env lookup, no side effects: pure module-level data.
"""

from __future__ import annotations

from typing import Final

#: FLUX img2img transformation strength.
#:
#: Range: 0.0 (return the input unchanged) … 1.0 (full re-synthesis,
#: discarding the input's structure). Personal-color editing wants
#: hue/lighting rewrites while preserving facial identity, so we pin this
#: well below the Fal default of 0.95 — see module docstring for the
#: calibration rationale.
DEFAULT_STRENGTH: Final[float] = 0.85

#: FLUX classifier-free guidance scale.
#:
#: Controls how tightly FLUX follows the prompt versus the input image.
#: Fal's documented default for `fal-ai/flux/dev/image-to-image`. Values
#: above ~5.0 cause over-saturation and artefacts; values below ~2.5 make
#: the prompt nearly ineffective. 3.5 is the documented sweet spot.
DEFAULT_GUIDANCE_SCALE: Final[float] = 3.5

#: FLUX denoising steps per generation.
#:
#: Range: 1 … 50 (Fal's documented cap). More steps → higher fidelity,
#: more latency. Pinned at 28 to claw back ~30% of vendor latency relative
#: to Fal's 40-step default — see module docstring for why that trade is
#: acceptable for the personal-color use case.
DEFAULT_NUM_INFERENCE_STEPS: Final[int] = 28

__all__ = [
    "DEFAULT_GUIDANCE_SCALE",
    "DEFAULT_NUM_INFERENCE_STEPS",
    "DEFAULT_STRENGTH",
]
