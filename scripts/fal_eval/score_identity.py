"""Quantify identity preservation: ArcFace cosine(input selfie ↔ output).

Reads `out/runs.json`, computes a face-embedding cosine for every successful
cell, and writes the score back into `runs.json` as `arcface`. Same person
typically lands ~0.4–0.7+; low values = the model lost the user's face.

`None` means no face was detected in the input or output (itself a signal — an
output with no detectable face usually means heavy artifacting or a non-portrait
result).

Usage:
    python score_identity.py
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2  # type: ignore[import-untyped]
import numpy as np
from insightface.app import FaceAnalysis  # type: ignore[import-untyped]

from config import OUT_DIR


def _largest_face_embedding(app: FaceAnalysis, image_path: str) -> np.ndarray | None:
    img = cv2.imread(image_path)
    if img is None:
        return None
    faces = app.get(img)
    if not faces:
        return None
    # Pick the largest detected face (the subject), use the L2-normalized embedding.
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    return np.asarray(face.normed_embedding, dtype=np.float32)


def main() -> None:
    runs_path = Path(OUT_DIR) / "runs.json"
    rows = json.loads(runs_path.read_text())

    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(640, 640))

    # Cache input-selfie embeddings (reused across recipes × models).
    input_emb: dict[str, np.ndarray | None] = {}

    for row in rows:
        if row.get("error") and not row["error"].startswith("skipped"):
            row["arcface"] = None
            continue
        out_path = row["out_path"]
        if not Path(out_path).exists():
            row["arcface"] = None
            continue

        sp = row["selfie_path"]
        if sp not in input_emb:
            input_emb[sp] = _largest_face_embedding(app, sp)
        a = input_emb[sp]
        b = _largest_face_embedding(app, out_path)

        if a is None or b is None:
            row["arcface"] = None
        else:
            row["arcface"] = round(float(np.dot(a, b)), 4)
        print(
            f"{row['model']:12} {row['recipe']:13} {row.get('variant', ''):9} "
            f"{row['selfie']:20} arcface={row['arcface']}"
        )

    runs_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2))

    scored = [r["arcface"] for r in rows if isinstance(r.get("arcface"), float)]
    if scored:
        print(
            f"\nscored {len(scored)} cells · arcface min={min(scored):.3f} "
            f"mean={sum(scored) / len(scored):.3f} max={max(scored):.3f}"
        )


if __name__ == "__main__":
    main()
