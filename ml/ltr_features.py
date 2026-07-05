"""MODULE 2 — Feature engineering partagé (entraînement ET inférence).

Un SEUL endroit définit les features pour garantir zéro écart train/serving.
Toutes les features sont calculées PAR COURSE (le groupe de ranking) et gèrent
l'imputation des valeurs manquantes par la MÉDIANE de la course (repli global).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Ordre canonique des colonnes de features consommées par le modèle.
FEATURES = [
    "cote",
    "market_prob",          # proba implicite du marché (overround retiré, par course)
    "derniere_performance",
    "taux_top3_recent",
    "log_gains",
    "jockey_rating",
    "trainer_rating",
    "chrono",
    "is_unshod",
    "field_size",
    "race_density",
    "odds_trend",
]


def _num(s, default=np.nan):
    return pd.to_numeric(s, errors="coerce")


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    """Colonne numérique alignée sur l'index ; NaN si la colonne est absente."""
    if name in df.columns:
        return pd.to_numeric(df[name], errors="coerce")
    return pd.Series(np.nan, index=df.index)


def _extract_musique(df: pd.DataFrame) -> pd.DataFrame:
    """Déplie la colonne `musique` (dict JSON) en colonnes plates si présente."""
    out = df.copy()
    if "derniere_performance" not in out.columns:
        out["derniere_performance"] = np.nan
    if "taux_top3_recent" not in out.columns:
        out["taux_top3_recent"] = np.nan
    if "musique" in out.columns:
        def get(d, k):
            return d.get(k) if isinstance(d, dict) else None
        out["derniere_performance"] = out["derniere_performance"].fillna(
            out["musique"].map(lambda d: get(d, "derniere_performance"))
        )
        out["taux_top3_recent"] = out["taux_top3_recent"].fillna(
            out["musique"].map(lambda d: get(d, "taux_top3_recent"))
        )
    return out


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Retourne un DataFrame indexé comme `df` avec la colonne `course_id` + FEATURES.

    Colonnes d'entrée attendues (toutes tolérées manquantes) :
      course_id, cote, cote_open, gains, chrono, deferrage, jockey_rating,
      trainer_rating, distance_m, musique (dict) | derniere_performance, taux_top3_recent
    """
    out = _extract_musique(df)
    cid = out["course_id"]

    # Proba implicite du marché, overround retiré, par course.
    cote = _col(out, "cote")
    inv = 1.0 / cote.where(cote > 1.0)
    denom = inv.groupby(cid).transform("sum")
    out["field_size"] = cid.groupby(cid).transform("size").astype(float)
    out["market_prob"] = (inv / denom).fillna(1.0 / out["field_size"])
    # Renormalise par course -> vraie distribution (somme = 1) même avec des cotes manquantes.
    out["market_prob"] = out["market_prob"] / out["market_prob"].groupby(cid).transform("sum")

    out["log_gains"] = np.log10(np.clip(_col(out, "gains").fillna(0), 0, None) + 1)

    dist = _col(out, "distance_m").replace(0, np.nan)
    out["race_density"] = (out["field_size"] / (dist / 100.0)).fillna(out["field_size"] / 20.0)

    cote_open = _col(out, "cote_open")
    out["odds_trend"] = ((cote - cote_open) / cote_open.replace(0, np.nan)).fillna(0.0).clip(-1.0, 3.0)

    out["is_unshod"] = (
        out.get("deferrage").notna().astype(int) if "deferrage" in out.columns else 0
    )

    # Imputation par la MÉDIANE de la course (repli médiane globale puis défaut).
    IMPUTE = {
        "cote": 10.0,
        "chrono": 0.0,
        "derniere_performance": 8.0,
        "taux_top3_recent": 0.30,
        "jockey_rating": 50.0,
        "trainer_rating": 50.0,
    }
    for col, default in IMPUTE.items():
        s = _col(out, col)
        s = s.fillna(s.groupby(cid).transform("median"))
        s = s.fillna(s.median()).fillna(default)
        out[col] = s

    keep = ["course_id"] + FEATURES
    for c in keep:
        if c not in out.columns:
            out[c] = 0.0
    return out[keep]


def relevance_from_finish(finish_pos: pd.Series) -> pd.Series:
    """Label de pertinence pour YetiRank : 3 (1er), 2 (2e), 1 (3e), 0 sinon."""
    pos = pd.to_numeric(finish_pos, errors="coerce")
    rel = pd.Series(0, index=finish_pos.index, dtype=int)
    rel = rel.mask(pos == 1, 3).mask(pos == 2, 2).mask(pos == 3, 1)
    return rel
