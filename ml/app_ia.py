"""MODULE 2 — Micro-service d'inférence IA (FastAPI).

Charge le modèle LTR sérialisé (model/model.cbm) et expose POST /predict :
reçoit les partants d'UNE course, calcule les scores LTR, applique un Softmax
PAR COURSE pour obtenir des probabilités pures, puis marque les "Value Bet"
(proba IA > proba implicite du marché).

Lancer :  uvicorn app_ia:app --host 0.0.0.0 --port 8100
"""

from __future__ import annotations

import os
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ltr_features import build_features, FEATURES

MODEL_PATH = os.environ.get("PPM_MODEL_PATH", "model/model.cbm")
SOFTMAX_TEMPERATURE = float(os.environ.get("PPM_SOFTMAX_TEMP", "0.5"))

app = FastAPI(title="ParisPromax IA — LTR", version="1.0.0")
_model = None


def _load_model():
    global _model
    if _model is None:
        from catboost import CatBoostRanker

        m = CatBoostRanker()
        m.load_model(MODEL_PATH)
        _model = m
    return _model


# ----------------------------- Schémas API ---------------------------------
class Runner(BaseModel):
    number: int
    name: str = ""
    cote: Optional[float] = None
    cote_open: Optional[float] = None
    gains: Optional[float] = 0
    chrono: Optional[float] = None
    deferrage: Optional[str] = None
    jockey_rating: Optional[float] = None
    trainer_rating: Optional[float] = None
    derniere_performance: Optional[float] = None
    taux_top3_recent: Optional[float] = None
    distance_m: Optional[float] = None


class PredictRequest(BaseModel):
    race_id: str = Field(..., description="Identifiant de la course (groupe LTR)")
    runners: List[Runner]


def _softmax(x: np.ndarray, temperature: float) -> np.ndarray:
    z = (x - np.max(x)) / max(temperature, 1e-6)
    e = np.exp(z)
    return e / e.sum()


@app.get("/health")
def health():
    ok = os.path.exists(MODEL_PATH)
    return {"ok": ok, "model": MODEL_PATH, "loaded": _model is not None}


@app.post("/predict")
def predict(req: PredictRequest):
    if not req.runners:
        raise HTTPException(status_code=400, detail="runners vide")

    model = _load_model()

    df = pd.DataFrame([r.dict() for r in req.runners])
    df["course_id"] = req.race_id

    # Features (mêmes que l'entraînement) + scores LTR.
    feats = build_features(df)
    scores = np.asarray(model.predict(feats[FEATURES]), dtype=float)

    # Softmax PAR COURSE -> proba de victoire ; podium = espérance top-3.
    proba_win = _softmax(scores, SOFTMAX_TEMPERATURE)
    proba_podium = np.clip(proba_win * min(3, len(df)), 0.0, 1.0)

    # Proba implicite du marché (overround retiré) pour le Value Bet.
    market = feats["market_prob"].to_numpy()

    rows = []
    for i in range(len(df)):
        edge = float(proba_win[i] - market[i])
        rows.append({
            "number": int(df["number"].iloc[i]),
            "name": str(df["name"].iloc[i]),
            "ltr_score": round(float(scores[i]), 4),
            "proba_win": round(float(proba_win[i]), 4),
            "proba_podium": round(float(proba_podium[i]), 4),
            "market_prob": round(float(market[i]), 4),
            "edge": round(edge, 4),
            # Value Bet = l'IA estime une proba SUPÉRIEURE à celle de la cote.
            "value_bet": bool(edge > 0.02 and (df["cote"].iloc[i] or 0) >= 2),
        })

    rows.sort(key=lambda r: -r["proba_win"])
    for rank, r in enumerate(rows, start=1):
        r["rang_predit"] = rank

    return {"race_id": req.race_id, "n_partants": len(rows), "predictions": rows}
