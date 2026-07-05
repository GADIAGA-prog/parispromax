#!/usr/bin/env python
"""MODULE 2 — Entraînement du modèle Learning-to-Rank (CatBoost / YetiRank).

Classe les chevaux d'une MÊME course par probabilité de finir dans le Top 3.
Points clés (exigences de la spec) :
  * Chargement depuis PostgreSQL (data_export).
  * Groupement OBLIGATOIRE par `course_id` (paramètre group_id de CatBoost) :
    le ranking se fait à l'intérieur de chaque course, jamais entre courses.
  * Imputation des manquants (médiane par course) via ltr_features.
  * Perte listwise YetiRank ; label de pertinence 3/2/1/0 (1er/2e/3e/reste).
  * Validation temporelle par groupes ; sauvegarde de `model/model.cbm`.

Usage :
    python train_ltr.py                       # depuis DATABASE_URL (Postgres)
    python train_ltr.py --json export.json    # jeu de test hors-ligne
    python train_ltr.py --out model/model.cbm
"""

from __future__ import annotations

import argparse
import os

import numpy as np

from data_export import load_training_frame, load_from_json
from ltr_features import build_features, relevance_from_finish, FEATURES


def _grouped_time_split(course_ids, n_folds=4):
    """Split par blocs de courses contigus (le passé entraîne, le futur valide)."""
    uniq = list(dict.fromkeys(course_ids))  # ordre d'apparition (déjà trié par course)
    cut = int(len(uniq) * (n_folds / (n_folds + 1)))
    train_c, valid_c = set(uniq[:cut]), set(uniq[cut:])
    return train_c, valid_c


def train(df, out_path="model/model.cbm"):
    from catboost import CatBoostRanker, Pool

    if df.empty:
        raise SystemExit("Aucune donnée d'entraînement (courses terminées manquantes).")

    n_courses = df["course_id"].nunique()
    print(f"[train] {len(df)} partants / {n_courses} courses terminées")

    feats = build_features(df)
    X = feats[FEATURES]
    y = relevance_from_finish(df["finish_pos"]).to_numpy()
    group = df["course_id"].astype("category").cat.codes.to_numpy()  # entiers contigus

    # Split temporel par groupes (courses).
    train_c, valid_c = _grouped_time_split(df["course_id"].tolist())
    tr = df["course_id"].isin(train_c).to_numpy()
    va = df["course_id"].isin(valid_c).to_numpy()

    train_pool = Pool(data=X[tr], label=y[tr], group_id=group[tr])
    valid_pool = Pool(data=X[va], label=y[va], group_id=group[va]) if va.any() else None

    model = CatBoostRanker(
        loss_function="YetiRank",          # ranking listwise (spec)
        eval_metric="NDCG:top=3",          # qualité du Top 3
        iterations=800,
        learning_rate=0.05,
        depth=6,
        l2_leaf_reg=3.0,
        random_seed=42,
        verbose=100,
        allow_writing_files=False,
    )
    model.fit(train_pool, eval_set=valid_pool, use_best_model=bool(valid_pool))

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    model.save_model(out_path)
    print(f"[train] modèle sauvegardé -> {out_path}")

    # Importance des features (diagnostic).
    try:
        imp = sorted(zip(FEATURES, model.get_feature_importance()), key=lambda x: -x[1])
        print("[train] importance:", [(f, round(v, 1)) for f, v in imp[:8]])
    except Exception:  # noqa: BLE001
        pass
    return model


def main():
    ap = argparse.ArgumentParser(description="Entraîne le modèle LTR ParisPromax.")
    ap.add_argument("--json", default=None, help="Export JSON hors-ligne (sinon Postgres).")
    ap.add_argument("--out", default="model/model.cbm")
    args = ap.parse_args()

    df = load_from_json(args.json) if args.json else load_training_frame()
    train(df, args.out)


if __name__ == "__main__":
    main()
