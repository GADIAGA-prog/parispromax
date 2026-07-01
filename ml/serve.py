#!/usr/bin/env python
"""Entry point — run the 10-minute prediction daemon (BLOC 4).

Usage::

    python ml/serve.py                                   # every 10 min, from backend
    python ml/serve.py --source src/services/live_races.json --once
    python ml/serve.py --model ml/artifacts/turf_ranker.joblib --every 10

Environment variables (all optional):
    PPM_BACKEND_URL   base URL of the Node backend (default http://localhost:4000)
    PPM_MODEL_PATH    default model path
    PPM_PREDICTIONS_OUT  where the JSON payload is written
    PPM_PUSH_URL      if set, POST the payload there each cycle
    PPM_PUSH_TOKEN    bearer token for the push
    PPM_NP_FILE       local JSON of non-partants {race_id: [numbers]}
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd  # noqa: E402

from turf_pipeline.ranker import TurfRanker  # noqa: E402
from turf_pipeline.scheduler import (  # noqa: E402
    run_prediction_cycle, start_scheduler,
    DEFAULT_MODEL_PATH, DEFAULT_OUTPUT,
)


def main() -> None:
    ap = argparse.ArgumentParser(description="PARISPROMAX prediction daemon.")
    ap.add_argument("--model", default=DEFAULT_MODEL_PATH)
    ap.add_argument("--source", default=None,
                    help="live_races.json path; default = backend /races/full.")
    ap.add_argument("--out", default=DEFAULT_OUTPUT)
    ap.add_argument("--every", type=int, default=10, help="Minutes between cycles.")
    ap.add_argument("--once", action="store_true", help="Run a single cycle and exit.")
    args = ap.parse_args()

    if args.once:
        ranker = TurfRanker.load(args.model)
        run_prediction_cycle(
            ranker, args.source, args.out,
            generated_at=pd.Timestamp.utcnow().isoformat())
        return

    start_scheduler(
        model_path=args.model, live_source=args.source,
        output_path=args.out, every_minutes=args.every)


if __name__ == "__main__":
    main()
