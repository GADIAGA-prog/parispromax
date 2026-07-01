"""PARISPROMAX — Learning-to-Rank turf prediction pipeline.

Public surface:

    from turf_pipeline import (
        compute_advanced_features,   # BLOC 1 — 5 piliers
        train_ranker, TurfRanker,    # BLOC 2 — lambdarank / QueryRMSE + TS-CV
        handle_scratchings,          # BLOC 3 — non-partants live
        predict_race, to_android_payload,
        run_prediction_cycle, start_scheduler,  # BLOC 4 — 10-min automation
    )
"""

from .config import COLUMNS, FEATURE_COLUMNS, RANK
from .features import compute_advanced_features
from .ranker import TurfRanker, train_ranker, build_target, group_sizes, GroupTimeSeriesSplit
from .scratchings import handle_scratchings, renormalize_predictions
from .inference import predict_race, to_android_payload
from .scheduler import run_prediction_cycle, start_scheduler
from .data_source import load_live_races, load_training_frame, to_canonical

__all__ = [
    "COLUMNS", "FEATURE_COLUMNS", "RANK",
    "compute_advanced_features",
    "TurfRanker", "train_ranker", "build_target", "group_sizes",
    "GroupTimeSeriesSplit",
    "handle_scratchings", "renormalize_predictions",
    "predict_race", "to_android_payload",
    "run_prediction_cycle", "start_scheduler",
    "load_live_races", "load_training_frame", "to_canonical",
]

__version__ = "1.0.0"
