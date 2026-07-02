"""Generate the eval matrix: selfies × recipes × prompt-variants × models × knobs.

Hits fal.run directly via the official `fal-client` SDK (upload + queue/poll).
Resumable: skips a cell whose output already exists, so reruns (and widening the
config for stage 2) don't re-pay. Writes `out/runs.json` for the scoring + report
steps.

Garment cells (pivot, STRATEGY §10): recipes with `needs_garment=True` pair each
selfie with up to GARMENT_PAIR_LIMIT photos from `garments/` and pass the garment
as the second `image_urls[]` element. Models with `supports_garment=False` are
skipped for those cells. Two §10-B axes on top (see config.py):
  - garment-solo stage-0 (`garment_only=True` recipes): garment × model cells
    with NO selfie — the garment photo is the single reference image.
  - enrichment ({none, freeform, profile}): garment cells run once per active
    enrichment key, injecting the garment sidecar text into the prompt.
    Sidecars are validated at enumeration time (fail loud, before any spend).

Cost-approval gate (docs/INVARIANTS.md #8 — paid API): running WITHOUT `--yes`
only prints the new-cell count and the maximum cost estimate, then exits. The
operator reviews the estimate and re-runs with `--yes` to actually spend.

Stage is driven by `config.FINALISTS` (see config.py): empty → cheap screen over
all models; set → deep sweep over the finalists only.

Usage:
    python run_matrix.py                       # estimate only (no key needed)
    export FAL_KEY="<key_id>:<key_secret>"     # NOT FAL_API_KEY
    python run_matrix.py --yes                 # operator-approved paid run
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from config import (
    GARMENT_DIR,
    OUT_DIR,
    RECIPES,
    SEEDS_PER_CELL,
    SELFIE_DIR,
    Model,
    PromptVariant,
    Recipe,
    active_enrichment_keys,
    active_garments,
    active_knobs,
    active_models,
    active_selfies,
    active_variant_keys,
    enriched_prompt,
    garment_info_text,
    is_stage2,
    knob_label,
)


@dataclass(frozen=True)
class Cell:
    """One planned generation — enumeration is separate from execution so the
    cost estimate (approval gate) is exact and free.

    ``selfie=None`` = a garment-solo stage-0 cell (the garment photo is the
    single reference image). ``enrichment`` is the §10-B axis — which garment
    info, if any, is injected into the prompt ("none" for non-garment cells).
    """

    model: Model
    recipe: Recipe
    variant: PromptVariant
    knob: dict
    selfie: Path | None
    garment: Path | None
    enrichment: str
    seed_i: int

    @property
    def prompt(self) -> str:
        return enriched_prompt(self.variant.text, self.enrichment, self.garment)

    @property
    def out_path(self) -> Path:
        bits = []
        if self.selfie is not None:
            bits.append(self.selfie.stem)
        if self.garment is not None:
            bits.append(self.garment.stem)
        if self.enrichment != "none":
            bits.append(f"enr-{self.enrichment}")
        return (
            Path(OUT_DIR)
            / self.model.key
            / self.recipe.key
            / self.variant.key
            / knob_label(self.knob)
            / f"{'_'.join(bits)}_{self.seed_i}.png"
        )


def _list_images(dir_name: str) -> list[Path]:
    return sorted(
        p
        for p in Path(dir_name).glob("*")
        if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )


def _enumerate_cells() -> list[Cell]:
    all_selfies = _list_images(SELFIE_DIR)
    if not all_selfies:
        raise SystemExit(
            f"no selfies in {Path(SELFIE_DIR).resolve()} (add consented *.jpg/*.png)"
        )
    selfies = active_selfies(all_selfies)
    garments = active_garments(_list_images(GARMENT_DIR))
    models = active_models()
    variant_keys = set(active_variant_keys())

    needs_garment_active = any(
        r.needs_garment
        for r in RECIPES
        if any(v.key in variant_keys for v in r.variants)
    )
    if needs_garment_active and not garments:
        raise SystemExit(
            f"garment recipes are active but no garment photos in "
            f"{Path(GARMENT_DIR).resolve()} (add *.jpg/*.png — hanger + worn shots)"
        )

    # Enrichment sidecars are validated up front (fail loud at estimate time,
    # before any spend) — a missing sidecar would silently bias one arm.
    enrichments = active_enrichment_keys() if needs_garment_active else ("none",)
    for garment in garments:
        for enrichment in enrichments:
            garment_info_text(garment, enrichment)

    cells: list[Cell] = []
    for selfie in selfies:
        for recipe in RECIPES:
            if recipe.garment_only:
                continue  # enumerated below, once — not per selfie
            for variant in recipe.variants:
                if variant.key not in variant_keys:
                    continue
                garment_axis: list[Path | None] = (
                    list(garments) if recipe.needs_garment else [None]
                )
                enrichment_axis = enrichments if recipe.needs_garment else ("none",)
                for garment in garment_axis:
                    for enrichment in enrichment_axis:
                        for model in models:
                            if recipe.needs_garment and not model.supports_garment:
                                continue
                            for knob in active_knobs(model):
                                for seed_i in range(SEEDS_PER_CELL):
                                    cells.append(
                                        Cell(
                                            model,
                                            recipe,
                                            variant,
                                            knob,
                                            selfie,
                                            garment,
                                            enrichment,
                                            seed_i,
                                        )
                                    )
    # Garment-solo stage-0 probe: garment × model, no selfie multiplier. The
    # garment is the SINGLE reference image, so single-reference models
    # (supports_garment=False) participate too.
    for recipe in RECIPES:
        if not recipe.garment_only:
            continue
        for variant in recipe.variants:
            if variant.key not in variant_keys:
                continue
            for garment in garments:
                for enrichment in enrichments:
                    for model in models:
                        for knob in active_knobs(model):
                            for seed_i in range(SEEDS_PER_CELL):
                                cells.append(
                                    Cell(
                                        model,
                                        recipe,
                                        variant,
                                        knob,
                                        None,
                                        garment,
                                        enrichment,
                                        seed_i,
                                    )
                                )
    return cells


def _output_url(result: object) -> str:
    """Pull images[0].url from a fal response, defensively (schemas vary slightly)."""
    if isinstance(result, dict):
        images = result.get("images")
        if isinstance(images, list) and images and isinstance(images[0], dict):
            url = images[0].get("url")
            if isinstance(url, str) and url:
                return url
        # Some models nest under "image" or return a bare url.
        for key in ("image", "url"):
            val = result.get(key)
            if isinstance(val, str) and val:
                return val
            if isinstance(val, dict) and isinstance(val.get("url"), str):
                return val["url"]
    raise ValueError(
        f"could not find output image url in response: {str(result)[:200]}"
    )


def main() -> None:
    cells = _enumerate_cells()
    new_cells = [c for c in cells if not c.out_path.exists()]
    max_cost = sum(c.model.usd_per_image for c in new_cells)
    stage = "2 (deep sweep)" if is_stage2() else "1 (screen)"
    print(
        f"stage {stage}: {len(cells)} cells total, {len(new_cells)} new "
        f"→ max cost ~${max_cost:.2f}"
    )

    if "--yes" not in sys.argv:
        print(
            "\nESTIMATE ONLY — no API call made (docs/INVARIANTS.md #8).\n"
            "Review the cost above, then re-run with:  python run_matrix.py --yes"
        )
        return
    if not os.environ.get("FAL_KEY"):
        raise SystemExit("set FAL_KEY=<key_id>:<key_secret> (fal-client reads it)")

    import fal_client  # type: ignore[import-untyped]  # deferred: estimate is keyless

    upload_cache: dict[str, str] = {}

    def _uploaded(path: Path) -> str:
        if path.name not in upload_cache:
            print(f"↑ upload {path.name}")
            upload_cache[path.name] = fal_client.upload_file(str(path))
        return upload_cache[path.name]

    rows: list[dict] = []
    for cell in cells:
        out_path = cell.out_path
        row = {
            "model": cell.model.key,
            "origin": cell.model.origin,
            "endpoint": cell.model.endpoint,
            "recipe": cell.recipe.key,
            "variant": cell.variant.key,
            "knob": knob_label(cell.knob),
            "selfie": cell.selfie.name if cell.selfie else "",
            "selfie_path": str(cell.selfie) if cell.selfie else "",
            "garment": cell.garment.name if cell.garment else "",
            "garment_path": str(cell.garment) if cell.garment else "",
            "enrichment": cell.enrichment,
            "seed": cell.seed_i,
            "out_path": str(out_path),
            "usd_est": cell.model.usd_per_image,
            "latency_s": None,
            "error": "",
        }
        if out_path.exists():
            row["error"] = "skipped(exists)"
            rows.append(row)
            continue

        out_path.parent.mkdir(parents=True, exist_ok=True)
        # Garment-solo cells: the garment takes the sole reference slot.
        if cell.selfie is None:
            assert cell.garment is not None  # garment_only enumeration guarantees
            ref_args = cell.model.build_args(_uploaded(cell.garment), cell.prompt, None)
        else:
            ref_args = cell.model.build_args(
                _uploaded(cell.selfie),
                cell.prompt,
                _uploaded(cell.garment) if cell.garment else None,
            )
        args = {**ref_args, **cell.model.extra, **cell.knob}
        if SEEDS_PER_CELL > 1:
            args["seed"] = 1000 + cell.seed_i
        t0 = time.monotonic()
        try:
            result = fal_client.subscribe(
                cell.model.endpoint, arguments=args, with_logs=False
            )
            url = _output_url(result)
            urllib.request.urlretrieve(url, out_path)  # noqa: S310
        except Exception as exc:  # noqa: BLE001 — log + keep going
            row["error"] = f"{type(exc).__name__}: {exc}"
        row["latency_s"] = round(time.monotonic() - t0, 2)
        rows.append(row)
        status = "✗ " + row["error"] if row["error"] else "✓"
        garment_s = f" +{row['garment']}" if row["garment"] else ""
        enr_s = f" [{cell.enrichment}]" if cell.enrichment != "none" else ""
        print(
            f"{status}  {cell.model.key:12} {cell.recipe.key:14} "
            f"{cell.variant.key:9} {row['knob']:16} "
            f"{row['selfie'] or '(solo)'}{garment_s}{enr_s}  ({row['latency_s']}s)"
        )

    Path(OUT_DIR).mkdir(parents=True, exist_ok=True)
    runs_path = Path(OUT_DIR) / "runs.json"
    runs_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    ok = sum(1 for r in rows if not r["error"])
    spent = sum(
        r["usd_est"] for r in rows if not r["error"] or r["error"].startswith("skipped")
    )
    print(f"\n{ok}/{len(rows)} generated · ~${spent:.2f} est · → {runs_path}")


if __name__ == "__main__":
    main()
