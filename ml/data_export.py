"""MODULE 2 — Export des données d'entraînement depuis PostgreSQL.

Charge les partants normalisés (table Runner) joints à la course et à l'arrivée,
puis calcule `finish_pos` depuis le JSON `Result.winners`. Retourne un DataFrame
prêt pour l'entraînement LTR (une ligne par cheval, groupé par `course_id`).

Utilise une requête SQL brute (psycopg2). Un mode JSON hors-ligne est fourni
pour les tests sans base.
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

# Requête : uniquement les courses TERMINÉES (arrivée connue) pour l'entraînement.
SQL_TRAIN = """
SELECT
  r."externalId"        AS course_id,
  r.discipline          AS discipline,
  r.distance            AS distance_raw,
  ru.number             AS number,
  ru.name               AS name,
  ru."coteFloat"        AS cote,
  ru."coteOpen"         AS cote_open,
  ru.gains              AS gains,
  ru.chrono             AS chrono,
  ru.deferrage          AS deferrage,
  ru."jockeyRating"     AS jockey_rating,
  ru."trainerRating"    AS trainer_rating,
  ru."musiqueParsed"    AS musique,
  res.winners           AS winners
FROM "Runner" ru
JOIN "Race"   r   ON r.id  = ru."raceId"
JOIN "Result" res ON res."raceId" = r.id
"""


def _distance_m(v):
    if v is None:
        return np.nan
    m = pd.Series([str(v)]).str.extract(r"(\d{3,4})")[0].iloc[0]
    return float(m) if pd.notna(m) else np.nan


def _finish_pos(number, winners):
    """Rang d'arrivée depuis l'ordre `winners` (liste de numéros), sinon NaN."""
    try:
        arr = winners if isinstance(winners, list) else json.loads(winners)
        return arr.index(int(number)) + 1
    except (ValueError, TypeError, json.JSONDecodeError):
        return np.nan


def _finalize(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    df["distance_m"] = df["distance_raw"].map(_distance_m)
    df["finish_pos"] = df.apply(lambda r: _finish_pos(r["number"], r["winners"]), axis=1)
    # musique : psycopg2 renvoie déjà un dict pour un champ jsonb ; sinon parse.
    df["musique"] = df["musique"].map(
        lambda v: v if isinstance(v, dict) else (json.loads(v) if isinstance(v, str) else None)
    )
    # Trie par course pour des groupes contigus (exigence CatBoost group_id).
    return df.sort_values("course_id", kind="mergesort").reset_index(drop=True)


def load_training_frame(database_url: str | None = None) -> pd.DataFrame:
    """Charge le jeu d'entraînement depuis PostgreSQL (DATABASE_URL)."""
    import psycopg2

    url = database_url or os.environ["DATABASE_URL"]
    with psycopg2.connect(url) as conn:
        df = pd.read_sql(SQL_TRAIN, conn)
    return _finalize(df)


def load_from_json(path: str) -> pd.DataFrame:
    """Mode hors-ligne : lit un export JSON (liste de lignes runner)."""
    with open(path, "r", encoding="utf-8") as fh:
        rows = json.load(fh)
    return _finalize(pd.DataFrame(rows))
