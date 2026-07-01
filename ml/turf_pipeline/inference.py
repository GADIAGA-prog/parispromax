"""Inference — turn ranking scores into calibrated win/podium probabilities.

The ranker outputs an ordinal *score*; punters need probabilities. We convert
per race with a Plackett–Luce model whose strengths are ``exp(score / T)``:

* **P(win)** has a closed form (softmax of the scores).
* **P(podium)** — probability of finishing in the top 3 — has no cheap closed
  form for arbitrary fields, so we estimate it with a deterministic, seeded
  Monte-Carlo Plackett–Luce sampler (fast for realistic field sizes).

The final payload is emitted per race, already renormalised to sum to 100 %.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import COLUMNS as C, RANK
from .ranker import TurfRanker
from .scratchings import renormalize_predictions


def _softmax(x: np.ndarray, temperature: float) -> np.ndarray:
    z = (x - np.max(x)) / max(temperature, 1e-6)
    e = np.exp(z)
    return e / e.sum()


def _plackett_luce_podium(strengths: np.ndarray, n_samples: int,
                          rng: np.random.Generator, top_k: int = 3) -> np.ndarray:
    """Monte-Carlo P(finish in top-k) for each competitor.

    Draws ``n_samples`` full orderings via Gumbel-max sampling (equivalent to
    sequential Plackett–Luce draws but vectorised and O(n log n)).
    """
    n = len(strengths)
    if n <= top_k:
        return np.ones(n)
    log_s = np.log(np.clip(strengths, 1e-12, None))
    # Gumbel-max trick: argsort(log_s + Gumbel noise) ~ Plackett–Luce ordering.
    gumbel = rng.gumbel(size=(n_samples, n))
    keys = log_s[None, :] + gumbel
    # Top-k finishers = the k largest keys per sample.
    topk_idx = np.argpartition(-keys, top_k - 1, axis=1)[:, :top_k]
    counts = np.zeros(n)
    np.add.at(counts, topk_idx.ravel(), 1)
    return counts / n_samples


def predict_race(ranker: TurfRanker, race_df: pd.DataFrame) -> pd.DataFrame:
    """Score one race and attach ``proba_gagnant`` / ``proba_podium`` / ``rang_predit``.

    Expects a single race's rows *with features already computed*. Returns a copy
    sorted by predicted rank, probabilities summing to 100 %.
    """
    if race_df.empty:
        return race_df.copy()

    out = race_df.copy()
    scores = ranker.predict_scores(out)
    out["_score"] = scores

    strengths = np.exp((scores - scores.max()) / max(RANK.softmax_temperature, 1e-6))
    out["proba_gagnant"] = _softmax(scores, RANK.softmax_temperature)

    rng = np.random.default_rng(RANK.mc_seed)
    out["proba_podium"] = _plackett_luce_podium(
        strengths, RANK.podium_mc_samples, rng, top_k=3)

    # Enforce the summing invariants (win -> 1, podium -> min(3, n)).
    out = renormalize_predictions(out)
    return out


def to_android_payload(race_id: str, predicted_df: pd.DataFrame,
                       generated_at: str | None = None) -> dict:
    """Format one race's predictions into the clean JSON payload for the API.

    Shape (per runner): ``race_id, cheval_id, nom, probabilite_gagnant,
    probabilite_podium, rang_predit`` — probabilities rounded to 4 decimals and
    expressed in [0, 1].
    """
    df = predicted_df.sort_values("rang_predit")
    runners = []
    for _, r in df.iterrows():
        runners.append({
            "cheval_id": str(r.get(C.horse_id, r.get(C.number, ""))),
            "numero": _int_or_none(r.get(C.number)),
            "nom": str(r.get(C.horse_name, "")),
            "probabilite_gagnant": round(float(r.get("proba_gagnant", 0.0)), 4),
            "probabilite_podium": round(float(r.get("proba_podium", 0.0)), 4),
            "rang_predit": int(r.get("rang_predit", 0)),
        })
    payload = {
        "race_id": str(race_id),
        "runners": runners,
        "n_partants": len(runners),
    }
    if generated_at:
        payload["generated_at"] = generated_at
    return payload


def _int_or_none(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
