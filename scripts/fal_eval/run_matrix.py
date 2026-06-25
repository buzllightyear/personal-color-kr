"""Generate the eval matrix: selfies × recipes × prompt-variants × models × knobs.

Hits fal.run directly via the official `fal-client` SDK (upload + queue/poll).
Resumable: skips a cell whose output already exists, so reruns (and widening the
config for stage 2) don't re-pay. Writes `out/runs.json` for the scoring + report
steps.

Stage is driven by `config.FINALISTS` (see config.py): empty → cheap screen over
all models; set → deep sweep over the finalists only.

Usage:
    export FAL_KEY="<key_id>:<key_secret>"     # NOT FAL_API_KEY
    python run_matrix.py
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path

import fal_client  # type: ignore[import-untyped]

from config import (
    OUT_DIR,
    RECIPES,
    SEEDS_PER_CELL,
    SELFIE_DIR,
    active_knobs,
    active_models,
    active_selfies,
    active_variant_keys,
    is_stage2,
    knob_label,
)


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
    if not os.environ.get("FAL_KEY"):
        raise SystemExit("set FAL_KEY=<key_id>:<key_secret> (fal-client reads it)")

    selfie_dir = Path(SELFIE_DIR)
    all_selfies = sorted(
        p for p in selfie_dir.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    if not all_selfies:
        raise SystemExit(
            f"no selfies in {selfie_dir.resolve()} (add consented *.jpg/*.png)"
        )

    selfies = active_selfies(all_selfies)
    models = active_models()
    variant_keys = set(active_variant_keys())
    stage = "2 (deep sweep)" if is_stage2() else "1 (screen)"
    print(
        f"stage {stage}: {len(models)} models × {len(selfies)} selfies "
        f"× variants {sorted(variant_keys)}"
    )

    rows: list[dict] = []
    upload_cache: dict[str, str] = {}

    for selfie in selfies:
        # Upload once per selfie, reuse the URL across every cell.
        if selfie.name not in upload_cache:
            print(f"↑ upload {selfie.name}")
            upload_cache[selfie.name] = fal_client.upload_file(str(selfie))
        selfie_url = upload_cache[selfie.name]

        for recipe in RECIPES:
            for variant in recipe.variants:
                if variant.key not in variant_keys:
                    continue
                for model in models:
                    for knob in active_knobs(model):
                        klabel = knob_label(knob)
                        for seed_i in range(SEEDS_PER_CELL):
                            out_dir = (
                                Path(OUT_DIR)
                                / model.key
                                / recipe.key
                                / variant.key
                                / klabel
                            )
                            out_dir.mkdir(parents=True, exist_ok=True)
                            out_path = out_dir / f"{selfie.stem}_{seed_i}.png"
                            row = {
                                "model": model.key,
                                "origin": model.origin,
                                "endpoint": model.endpoint,
                                "recipe": recipe.key,
                                "variant": variant.key,
                                "knob": klabel,
                                "selfie": selfie.name,
                                "selfie_path": str(selfie),
                                "out_path": str(out_path),
                                "usd_est": model.usd_per_image,
                                "latency_s": None,
                                "error": "",
                            }
                            if out_path.exists():
                                row["error"] = "skipped(exists)"
                                rows.append(row)
                                continue

                            args = {
                                **model.build_args(selfie_url, variant.text),
                                **model.extra,
                                **knob,
                            }
                            if SEEDS_PER_CELL > 1:
                                args["seed"] = 1000 + seed_i
                            t0 = time.monotonic()
                            try:
                                result = fal_client.subscribe(
                                    model.endpoint, arguments=args, with_logs=False
                                )
                                url = _output_url(result)
                                urllib.request.urlretrieve(url, out_path)  # noqa: S310
                            except Exception as exc:  # noqa: BLE001 — log + keep going
                                row["error"] = f"{type(exc).__name__}: {exc}"
                            row["latency_s"] = round(time.monotonic() - t0, 2)
                            rows.append(row)
                            status = "✗ " + row["error"] if row["error"] else "✓"
                            print(
                                f"{status}  {model.key:12} {recipe.key:13} "
                                f"{variant.key:9} {klabel:16} {selfie.name}  "
                                f"({row['latency_s']}s)"
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
