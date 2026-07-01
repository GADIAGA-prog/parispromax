#!/usr/bin/env python
"""Entry point — train the Learning-to-Rank model and persist it.

Usage::

    python ml/train.py                                   # from backend /races/history
    python ml/train.py --source ml/data/history.json     # from a local export
    python ml/train.py --backend catboost --no-cv
    python ml/train.py --out ml/artifacts/turf_ranker.joblib

The trained artefact (model + feature contract + CV scores) is what the
scheduler loads for inference.
"""

from __future__ import annotations

import argparse
import os
import sys

# Allow `python ml/train.py` to import the package without installation.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from turf_pipeline.data_source import load_training_frame  # noqa: E402
from turf_pipeline.features import compute_advanced_features  # noqa: E402
from turf_pipeline.ranker import train_ranker  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Train the PARISPROMAX turf ranker.")
    ap.add_argument("--source", default=None,
                    help="Path to a history JSON export; default = backend API.")
    ap.add_argument("--backend", choices=["lightgbm", "catboost"], default="lightgbm")
    ap.add_argument("--out", default="ml/artifacts/turf_ranker.joblib")
    ap.add_argument("--no-cv", action="store_true", help="Skip temporal CV.")
    args = ap.parse_args()

    print(f"[train] loading history (source={args.source or 'backend API'})")
    raw = load_training_frame(args.source)
    if raw.empty:
        print("[train] no labelled races found — aborting.")
        sys.exit(1)

    n_races = raw["race_id"].nunique()
    print(f"[train] {len(raw)} runners across {n_races} finished races")

    print("[train] computing 5-pillar features (leak-free)…")
    feats = compute_advanced_features(raw)

    print(f"[train] fitting {args.backend} ranker…")
    ranker = train_ranker(feats, backend=args.backend, do_cv=not args.no_cv)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    ranker.save(args.out)
    print(f"[train] saved model -> {args.out}")


if __name__ == "__main__":
    main()
