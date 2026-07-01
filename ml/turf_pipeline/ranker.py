"""BLOC 2 — Apprentissage Learning-to-Rank (LightGBM lambdarank / CatBoost).

Racing prediction is fundamentally a *ranking* problem within each race, not a
regression on a horse in isolation, nor a per-horse binary classification. We
therefore optimise a listwise ranking loss (``lambdarank`` for LightGBM,
``QueryRMSE`` for CatBoost) with the race as the query group.

Two things make this correct and honest:

* **Grouping** — rows are grouped by ``race_id``; the group sizes vector tells
  the ranker which rows compete against each other.
* **Temporal validation** — a bespoke :class:`GroupTimeSeriesSplit` guarantees
  every fold trains on the past and validates on the future, keeping whole races
  intact so no race is split across the train/val boundary.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.metrics import ndcg_score

from .config import COLUMNS as C, FEATURE_COLUMNS, LGBM_PARAMS, CATBOOST_PARAMS, RANK


# ---------------------------------------------------------------------------
# Target & grouping
# ---------------------------------------------------------------------------
def build_target(df: pd.DataFrame) -> pd.Series:
    """Graded relevance label: 3 for the winner, 2/1 for 2nd/3rd, 0 otherwise.

    Penalising every non-placed runner equally (0) while rewarding the exact
    podium order is exactly what lambdarank's NDCG surrogate wants.
    """
    pos = pd.to_numeric(df[C.finish_pos], errors="coerce")
    target = pd.Series(RANK.relevance_default, index=df.index, dtype=int)
    for rank_idx, gain in enumerate(RANK.relevance_map, start=1):
        target = target.mask(pos == rank_idx, gain)
    return target


def group_sizes(df: pd.DataFrame) -> np.ndarray:
    """Contiguous per-race group sizes, in the row order of ``df``.

    LightGBM/CatBoost require the group vector to match the *physical* row order,
    so callers must sort by ``race_id`` (within the chronological order) first.
    """
    # value_counts(sort=False) preserves first-appearance order of race_id.
    return df.groupby(C.race_id, sort=False).size().to_numpy()


# ---------------------------------------------------------------------------
# Temporal, group-aware cross-validation
# ---------------------------------------------------------------------------
class GroupTimeSeriesSplit:
    """TimeSeriesSplit that never splits a race across the fold boundary.

    Races are ordered by their off time; we then apply an expanding-window time
    series split over *races* (not rows). Yields ``(train_idx, val_idx)`` arrays
    of DataFrame row positions.
    """

    def __init__(self, n_splits: int = RANK.n_splits):
        self.n_splits = n_splits

    def split(self, df: pd.DataFrame):
        race_order = (
            df[[C.race_id, C.race_datetime]]
            .drop_duplicates(C.race_id)
            .sort_values(C.race_datetime, kind="mergesort")[C.race_id]
            .to_numpy()
        )
        n_races = len(race_order)
        if n_races <= self.n_splits:
            raise ValueError(
                f"Not enough races ({n_races}) for {self.n_splits} folds.")

        fold_sizes = np.full(self.n_splits + 1, n_races // (self.n_splits + 1))
        fold_sizes[: n_races % (self.n_splits + 1)] += 1
        bounds = np.cumsum(fold_sizes)

        pos_by_race = {rid: i for i, rid in enumerate(race_order)}
        race_pos = df[C.race_id].map(pos_by_race).to_numpy()

        for k in range(1, self.n_splits + 1):
            train_races = bounds[k - 1]
            val_races = bounds[k]
            train_idx = np.where(race_pos < train_races)[0]
            val_idx = np.where((race_pos >= train_races) & (race_pos < val_races))[0]
            if len(train_idx) and len(val_idx):
                yield train_idx, val_idx


# ---------------------------------------------------------------------------
# Model wrapper
# ---------------------------------------------------------------------------
@dataclass
class TurfRanker:
    """A fitted Learning-to-Rank model plus its feature contract."""

    backend: str = "lightgbm"          # "lightgbm" | "catboost"
    model: object = None
    features: tuple[str, ...] = tuple(FEATURE_COLUMNS)
    cv_scores: tuple[float, ...] = ()

    # --- fitting ---------------------------------------------------------
    def fit(self, df: pd.DataFrame) -> "TurfRanker":
        train = self._prepare(df)
        X = train[list(self.features)]
        y = build_target(train)
        grp = group_sizes(train)
        self.model = self._make_model()
        if self.backend == "lightgbm":
            self.model.fit(X, y, group=grp)
        else:  # catboost
            from catboost import Pool
            pool = Pool(X, label=y, group_id=train[C.race_id].to_numpy())
            self.model.fit(pool)
        return self

    def cross_validate(self, df: pd.DataFrame) -> list[float]:
        """Expanding-window temporal CV; returns NDCG@3 per fold."""
        data = self._prepare(df)
        scores: list[float] = []
        for train_idx, val_idx in GroupTimeSeriesSplit().split(data):
            tr, va = data.iloc[train_idx], data.iloc[val_idx]
            m = self._fit_fold(tr)
            scores.append(self._ndcg_at_k(m, va, k=3))
        self.cv_scores = tuple(scores)
        return scores

    # --- prediction ------------------------------------------------------
    def predict_scores(self, df: pd.DataFrame) -> np.ndarray:
        """Raw ranking scores (higher = better). NaNs are median-imputed."""
        if self.model is None:
            raise RuntimeError("Model is not fitted/loaded.")
        X = df.reindex(columns=list(self.features))
        X = X.apply(pd.to_numeric, errors="coerce")
        X = X.fillna(X.median(numeric_only=True)).fillna(0.0)
        if self.backend == "lightgbm":
            return self.model.predict(X)
        from catboost import Pool
        return self.model.predict(Pool(X))

    # --- persistence -----------------------------------------------------
    def save(self, path: str) -> None:
        import joblib
        joblib.dump(
            {"backend": self.backend, "model": self.model,
             "features": self.features, "cv_scores": self.cv_scores}, path)

    @classmethod
    def load(cls, path: str) -> "TurfRanker":
        import joblib
        d = joblib.load(path)
        return cls(backend=d["backend"], model=d["model"],
                   features=tuple(d["features"]), cv_scores=tuple(d.get("cv_scores", ())))

    # --- internals -------------------------------------------------------
    def _make_model(self):
        if self.backend == "lightgbm":
            from lightgbm import LGBMRanker
            return LGBMRanker(**LGBM_PARAMS)
        if self.backend == "catboost":
            from catboost import CatBoostRanker
            return CatBoostRanker(**CATBOOST_PARAMS)
        raise ValueError(f"Unknown backend {self.backend!r}")

    def _fit_fold(self, tr: pd.DataFrame):
        X, y, grp = tr[list(self.features)], build_target(tr), group_sizes(tr)
        m = self._make_model()
        if self.backend == "lightgbm":
            m.fit(X, y, group=grp)
        else:
            from catboost import Pool
            m.fit(Pool(X, label=y, group_id=tr[C.race_id].to_numpy()))
        return m

    def _ndcg_at_k(self, model, va: pd.DataFrame, k: int = 3) -> float:
        X = va[list(self.features)]
        preds = (model.predict(X) if self.backend == "lightgbm"
                 else model.predict(__import__("catboost").Pool(X)))
        va = va.assign(_pred=preds, _rel=build_target(va).to_numpy())
        vals = []
        for _, g in va.groupby(C.race_id, sort=False):
            if len(g) < 2:
                continue
            vals.append(ndcg_score([g["_rel"].to_numpy()],
                                   [g["_pred"].to_numpy()], k=k))
        return float(np.mean(vals)) if vals else float("nan")

    def _prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        """Keep only labelled races, sorted chronologically then grouped by race
        so the group vector is contiguous. Impute residual feature NaNs."""
        data = df.copy()
        data[C.race_datetime] = pd.to_datetime(data[C.race_datetime], errors="coerce")
        labelled = data[pd.to_numeric(data[C.finish_pos], errors="coerce").notna()]
        # Chronological, then race-contiguous (mergesort = stable).
        labelled = labelled.sort_values(
            [C.race_datetime, C.race_id], kind="mergesort")
        for col in self.features:
            if col not in labelled.columns:
                labelled[col] = 0.0
        med = labelled[list(self.features)].median(numeric_only=True)
        labelled[list(self.features)] = labelled[list(self.features)].fillna(med).fillna(0.0)
        return labelled


def train_ranker(df_features: pd.DataFrame, backend: str = "lightgbm",
                 do_cv: bool = True) -> TurfRanker:
    """Convenience: cross-validate (optional) then fit on all labelled data."""
    ranker = TurfRanker(backend=backend)
    if do_cv:
        scores = ranker.cross_validate(df_features)
        valid = [s for s in scores if not np.isnan(s)]
        mean = np.mean(valid) if valid else float("nan")
        print(f"[cv] NDCG@3 folds={[round(s, 4) for s in scores]} mean={mean:.4f}")
    ranker.fit(df_features)
    return ranker
