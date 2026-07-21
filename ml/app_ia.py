"""MODULE 2 — Micro-service d'inférence IA (FastAPI).

Charge le modèle LTR sérialisé (model/model.cbm) et expose POST /predict :
reçoit les partants d'UNE course, calcule les scores LTR, applique un Softmax
PAR COURSE, calibre en mélangeant avec la probabilité implicite du marché
(quand des cotes existent), calcule la probabilité de PODIUM par la formule de
Harville, puis marque les "Value Bet" (proba IA > proba implicite du marché).

Sécurité : /predict exige `Authorization: Bearer <PPM_IA_TOKEN>` quand le
jeton est défini ; sur Render, le service refuse de démarrer sans ce jeton.

Lancer :  uvicorn app_ia:app --host 0.0.0.0 --port 8100
"""

from __future__ import annotations

import hmac
import os
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from ltr_features import build_features, FEATURES

MODEL_PATH = os.environ.get("PPM_MODEL_PATH", "model/model.cbm")
SOFTMAX_TEMPERATURE = float(os.environ.get("PPM_SOFTMAX_TEMP", "0.5"))
# Jeton Bearer optionnel en local, obligatoire sur Render.
IA_TOKEN = os.environ.get("PPM_IA_TOKEN", "")
if os.environ.get("RENDER") and not IA_TOKEN:
    raise RuntimeError("PPM_IA_TOKEN est obligatoire sur Render")
# Calibration pragmatique : proba finale = w*modèle + (1-w)*marché (si cotes).
# Le marché est très informatif en hippique ; le mélange réduit fortement les
# probabilités sur/sous-confiantes du softmax non calibré.
MODEL_WEIGHT = float(os.environ.get("PPM_MODEL_WEIGHT", "0.65"))
# Seuils Value Bet configurables.
VALUE_EDGE = float(os.environ.get("PPM_VALUE_EDGE", "0.03"))
VALUE_MIN_COTE = float(os.environ.get("PPM_VALUE_MIN_COTE", "2.0"))
VALUE_MIN_PROBA = float(os.environ.get("PPM_VALUE_MIN_PROBA", "0.05"))
MAX_RUNNERS = int(os.environ.get("PPM_MAX_RUNNERS", "40"))

app = FastAPI(title="ParisPromax IA — LTR", version="1.1.0")
_model = None


def _load_model():
    global _model
    if _model is None:
        from catboost import CatBoostRanker

        m = CatBoostRanker()
        m.load_model(MODEL_PATH)
        _model = m
    return _model


def _check_token(authorization: Optional[str]) -> None:
    """Exige le Bearer PPM_IA_TOKEN quand il est configuré (sinon local ouvert)."""
    if not IA_TOKEN:
        return
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization[7:]
    if not hmac.compare_digest(supplied, IA_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


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


def _harville_podium(p: np.ndarray) -> np.ndarray:
    """P(top 3) exacte par le modèle de Harville, à partir des P(victoire).

    p2(i) = somme_j p_j * p_i/(1-p_j) ; p3(i) = somme_{j,k} ... — O(n^3),
    négligeable pour n <= 40 partants.
    """
    n = len(p)
    if n <= 3:
        return np.ones(n)
    p = np.clip(p, 1e-9, 1.0)
    p = p / p.sum()
    podium = p.copy()  # P(1er)
    for i in range(n):
        p2 = 0.0
        p3 = 0.0
        for j in range(n):
            if j == i:
                continue
            d1 = max(1.0 - p[j], 1e-9)
            p2 += p[j] * p[i] / d1
            for k in range(n):
                if k == i or k == j:
                    continue
                d2 = max(1.0 - p[j] - p[k], 1e-9)
                p3 += p[j] * (p[k] / d1) * (p[i] / d2)
        podium[i] += p2 + p3
    return np.clip(podium, 0.0, 1.0)


@app.get("/health")
def health():
    ok = os.path.exists(MODEL_PATH)
    return {"ok": ok, "model": MODEL_PATH, "loaded": _model is not None}


@app.post("/predict")
def predict(req: PredictRequest, authorization: Optional[str] = Header(default=None)):
    _check_token(authorization)
    if not req.runners:
        raise HTTPException(status_code=400, detail="runners vide")
    if len(req.runners) > MAX_RUNNERS:
        raise HTTPException(status_code=400, detail=f"trop de partants (max {MAX_RUNNERS})")
    # Modèle pas encore entraîné -> 503 : le backend retombe proprement sur le JS.
    if not os.path.exists(MODEL_PATH):
        raise HTTPException(status_code=503, detail="modèle non entraîné")

    model = _load_model()

    df = pd.DataFrame([r.dict() for r in req.runners])
    df["course_id"] = req.race_id

    # Features (mêmes que l'entraînement) + scores LTR.
    feats = build_features(df)
    scores = np.asarray(model.predict(feats[FEATURES]), dtype=float)

    # Softmax PAR COURSE -> proba modèle brute.
    model_prob = _softmax(scores, SOFTMAX_TEMPERATURE)

    # Proba implicite du marché (overround retiré).
    market = feats["market_prob"].to_numpy()
    has_market = bool(np.isfinite(market).all()) and (df["cote"].notna().sum() >= max(2, len(df) // 2))

    # Calibration : mélange modèle/marché quand les cotes sont publiées.
    if has_market:
        proba_win = MODEL_WEIGHT * model_prob + (1.0 - MODEL_WEIGHT) * market
        proba_win = proba_win / proba_win.sum()
    else:
        proba_win = model_prob

    # Podium : formule de Harville (remplace l'ancien clip(p*3) non probabiliste).
    proba_podium = _harville_podium(proba_win)

    rows = []
    for i in range(len(df)):
        edge = float(model_prob[i] - market[i]) if has_market else 0.0
        cote = float(df["cote"].iloc[i] or 0)
        rows.append({
            "number": int(df["number"].iloc[i]),
            "name": str(df["name"].iloc[i]),
            "ltr_score": round(float(scores[i]), 4),
            "proba_win": round(float(proba_win[i]), 4),
            "proba_podium": round(float(proba_podium[i]), 4),
            "market_prob": round(float(market[i]), 4),
            "edge": round(edge, 4),
            # Value Bet = le MODÈLE (avant mélange) estime une proba nettement
            # supérieure à celle de la cote, avec un minimum de vraisemblance.
            "value_bet": bool(
                has_market
                and edge > VALUE_EDGE
                and cote >= VALUE_MIN_COTE
                and model_prob[i] >= VALUE_MIN_PROBA
            ),
        })

    rows.sort(key=lambda r: -r["proba_win"])
    for rank, r in enumerate(rows, start=1):
        r["rang_predit"] = rank

    return {"race_id": req.race_id, "n_partants": len(rows), "predictions": rows}
