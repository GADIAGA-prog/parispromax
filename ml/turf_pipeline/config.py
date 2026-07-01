"""Canonical schema, ordinal maps and hyper-parameters for the turf pipeline.

Everything that the rest of the package needs to know about *column names* and
*magic constants* lives here, so the feature engineering, training and inference
modules never hard-code a string twice. This makes it trivial to re-point the
pipeline at a different data source: only :data:`COLUMNS` changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Canonical column names
# ---------------------------------------------------------------------------
# The raw data (scraped from geny.com and stored by the Node backend) is mapped
# onto this canonical schema by ``data_source.py`` *before* any feature is
# computed. Keeping a single source of truth here means a scraper change only
# needs an adapter tweak, never a rewrite of the modelling code.
@dataclass(frozen=True)
class Columns:
    # --- identity / grouping -------------------------------------------------
    race_id: str = "race_id"            # geny course id, e.g. "c1663633"
    race_datetime: str = "race_datetime"  # tz-naive pandas Timestamp of the off
    date: str = "date"                  # YYYY-MM-DD (kept for convenience)
    horse_id: str = "cheval_id"         # stable id; falls back to the name
    horse_name: str = "nom"
    number: str = "number"              # saddle-cloth / draw number (corde)

    # --- actors --------------------------------------------------------------
    jockey: str = "jockey"              # driver in trot
    trainer: str = "trainer"

    # --- raw form / market ---------------------------------------------------
    musique: str = "form"              # e.g. "1aDa2a1a4a"
    gains: str = "gains"               # career earnings (€)
    odds: str = "odds"                # current decimal odds (cote)
    odds_open: str = "odds_open"       # opening odds
    odds_15m: str = "odds_15m"         # odds ~15 min before the off

    # --- race conditions -----------------------------------------------------
    discipline: str = "discipline"     # trot | attele | monte | plat | haies | steeple
    distance: str = "distance_m"       # metres (numeric)
    corde: str = "corde"               # "gauche" | "droite" | None
    terrain: str = "terrain"           # ground label (bon, souple, lourd, ...)
    weather: str = "weather"           # pluie | couvert | soleil ...
    start_type: str = "start_type"     # autostart | volte | elastique | stalles
    deferrage: str = "deferrage"       # D4 | DA | DP | "" (trot only)

    # --- label ---------------------------------------------------------------
    finish_pos: str = "finish_pos"     # official arrival rank (1 = winner); NaN if unknown


COLUMNS = Columns()

# Columns produced by :func:`features.compute_advanced_features`. The trainer
# and the inference engine both read this list, guaranteeing that training and
# serving see *exactly* the same feature space (no train/serve skew).
FEATURE_COLUMNS: list[str] = [
    # Pilier 1 — profil & forme du cheval
    "elo_rating",
    "days_since_last_race",
    "form_index_3_races",
    "is_unshod_feature",
    # Pilier 2 — statistiques des acteurs
    "couple_success_rate",
    "jockey_form_30d",
    "trainer_form_30d",
    # Pilier 3 — typologie de l'hippodrome
    "track_suitability_index",
    "ground_severity",
    # Pilier 4 — conditions de la course
    "rope_advantage",
    "start_type_encoded",
    "race_density",
    # Pilier 5 — signaux de marché (live)
    "odds_trend_15m",
    "market_implied_prob",  # derived from live odds, overround-corrected
]


# ---------------------------------------------------------------------------
# Ordinal / categorical encodings
# ---------------------------------------------------------------------------
# Ground severity, from firm to bottomless. Corrélé à la météo dans
# ``features._ground_severity`` (la pluie aggrave d'un cran).
GROUND_SEVERITY: dict[str, int] = {
    "sec": 1, "dry": 1, "bon": 1, "leger": 1, "rapide": 1,
    "bon souple": 2, "good": 2,
    "souple": 3, "soft": 3,
    "tres souple": 4, "collant": 4, "heavy": 4,
    "lourd": 5, "tres lourd": 5, "profond": 5,
}
GROUND_SEVERITY_DEFAULT = 3  # unknown ground -> assume average "souple"

# Start type -> small integer. Autostart is the most predictable (rope_advantage
# matters most there), volte/élastique add randomness.
START_TYPE_ENCODING: dict[str, int] = {
    "autostart": 0, "auto": 0, "stalles": 0, "stalle": 0,
    "volte": 1, "elastique": 2, "elastic": 2,
}
START_TYPE_DEFAULT = 0

# Disciplines considered "trot" (déferrage is only meaningful there).
TROT_DISCIPLINES = {"trot", "attele", "monte", "trot attele", "trot monte"}
# Disciplines run on the flat / over jumps (rope_advantage applies to galop).
GALOP_DISCIPLINES = {"plat", "galop", "haies", "steeple", "steeplechase", "cross"}

# Déferrage tokens that mean the horse ran (partly) unshod.
UNSHOD_TOKENS = {"d4", "da", "dp", "dpa", "dpp"}


# ---------------------------------------------------------------------------
# Modelling / scoring constants
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RankConfig:
    # Learning-to-rank relevance label. 1st -> 3, 2nd -> 2, 3rd -> 1, else 0.
    # LightGBM lambdarank needs small non-negative integer gains.
    relevance_map: tuple[int, ...] = (3, 2, 1)  # position 1,2,3
    relevance_default: int = 0

    elo_k: float = 24.0          # ELO step size
    elo_base: float = 1500.0     # ELO seed for a first-seen horse
    elo_scale: float = 400.0     # logistic scale

    form_window: int = 3         # PILIER 1 form_index_3_races
    actor_form_days: int = 30    # PILIER 2 rolling window (days)

    softmax_temperature: float = 0.6  # win-probability sharpness at inference
    podium_mc_samples: int = 20000    # Plackett-Luce Monte-Carlo for P(podium)
    mc_seed: int = 20260701           # deterministic sampling (reproducible)

    n_splits: int = 5            # TimeSeriesSplit folds


RANK = RankConfig()

# LightGBM lambdarank hyper-parameters. Kept conservative + regularised so the
# model stays robust on the modest data volumes typical of a single operator.
LGBM_PARAMS: dict = {
    "objective": "lambdarank",
    "metric": "ndcg",
    "eval_at": [1, 3],  # NDCG@1 and @3 (the placed runners)
    "boosting_type": "gbdt",
    "n_estimators": 700,
    "learning_rate": 0.03,
    "num_leaves": 31,
    "min_child_samples": 30,
    "subsample": 0.85,
    "subsample_freq": 1,
    "colsample_bytree": 0.85,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "max_position": 5,      # focus the ranking loss on the placed runners
    "random_state": 42,
    "n_jobs": -1,
    "verbose": -1,
}

# CatBoost alternative (objective QueryRMSE) — used when backend="catboost".
CATBOOST_PARAMS: dict = {
    "loss_function": "QueryRMSE",
    "eval_metric": "NDCG:top=3",
    "iterations": 800,
    "learning_rate": 0.03,
    "depth": 6,
    "l2_leaf_reg": 3.0,
    "random_seed": 42,
    "verbose": False,
    "allow_writing_files": False,
}
