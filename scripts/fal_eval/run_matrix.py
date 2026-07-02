"""Generate the eval matrix: selfies × recipes × prompt-variants × models × knobs.

Hits fal.run directly via the official `fal-client` SDK (upload + queue/poll).
Resumable: skips a cell whose output already exists, so reruns (and widening the
config for stage 2) don't re-pay. Writes `out/runs.json` for the scoring + report
steps.

Garment cells (pivot, STRATEGY §10): recipes with `needs_garment=True` pair each
selfie with up to GARMENT_PAIR_LIMIT photos from `garments/` and pass the garment
as the second `image_urls[]` element. Models with `supports_garment=False` are
skipped for those cells.

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
    active_garments,
    active_knobs,
    active_models,
    active_selfies,
    active_variant_keys,
    is_stage2,
    knob_label,
)


@dataclass(frozen=True)
class Cell:
    """One planned generation — enumeration is separate from execution so the
    cost estimate (approval gate) is exact and free."""

    model: Model
    recipe: Recipe
    variant: PromptVariant
    knob: dict
    selfie: Path
    garment: Path | None
    seed_i: int

    @property
    def out_path(self) -> Path:
        stem = self.selfie.stem
        if self.garment is not None:
            stem = f"{stem}_{self.garment.stem}"
        return (
            Path(OUT_DIR)
            / self.model.key
            / self.recipe.key
            / self.variant.key
            / knob_label(self.knob)
            / f"{stem}_{self.seed_i}.png"
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

    cells: list[Cell] = []
    for selfie in selfies:
        for recipe in RECIPES:
            for variant in recipe.variants:
                if variant.key not in variant_keys:
                    continue
                garment_axis: list[Path | None] = (
                    list(garments) if recipe.needs_garment else [None]
                )
                for garment in garment_axis:
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
            "selfie": cell.selfie.name,
            "selfie_path": str(cell.selfie),
            "garment": cell.garment.name if cell.garment else "",
            "garment_path": str(cell.garment) if cell.garment else "",
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
        args = {
            **cell.model.build_args(
                _uploaded(cell.selfie),
                cell.variant.text,
                _uploaded(cell.garment) if cell.garment else None,
            ),
            **cell.model.extra,
            **cell.knob,
        }
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
        print(
            f"{status}  {cell.model.key:12} {cell.recipe.key:14} "
            f"{cell.variant.key:9} {row['knob']:16} "
            f"{cell.selfie.name}{garment_s}  ({row['latency_s']}s)"
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
