"""BLOC 3 — Gestion dynamique des non-partants (NP).

When one or more runners are declared non-partant just before the off, the race
context changes and stale predictions become wrong. :func:`handle_scratchings`
rebuilds the affected features and renormalises both the market and the model
probabilities so the surviving field always sums to exactly 100 %.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import COLUMNS as C
from .features import _market_implied_prob, _race_density


def handle_scratchings(
    race_df: pd.DataFrame,
    non_partants_list: list,
) -> pd.DataFrame:
    """Drop non-runners and recompute the NP-sensitive quantities for one race.

    Parameters
    ----------
    race_df:
        Rows for a *single* race, already carrying features and (optionally) the
        raw model probabilities ``proba_gagnant`` / ``proba_podium``.
    non_partants_list:
        ``cheval_id`` (or saddle-cloth numbers) declared non-partant.

    Returns
    -------
    A filtered copy where:
      1. NP rows are removed;
      2. ``race_density`` (Pilier 4) is recomputed on the real remaining field;
      3. ``market_implied_prob`` is renormalised over survivors (softmax-inverse
         of the odds, overround stripped) to sum to 1;
      4. ``proba_gagnant`` / ``proba_podium`` (if present) are renormalised so the
         win column sums to exactly 100 % across the runners still on track.
    """
    if race_df.empty:
        return race_df.copy()

    np_set = {str(x) for x in (non_partants_list or [])}

    # Match against horse id AND saddle-cloth number (callers may use either).
    hid = race_df.get(C.horse_id, pd.Series(index=race_df.index, dtype=object)).astype(str)
    num = race_df.get(C.number, pd.Series(index=race_df.index, dtype=object)).astype(str)
    keep = ~(hid.isin(np_set) | num.isin(np_set))

    # --- 1. drop NP rows -------------------------------------------------
    survivors = race_df.loc[keep].copy()
    if survivors.empty:
        return survivors

    # --- 2. recompute race_density on the real remaining field -----------
    survivors["race_density"] = _race_density(survivors).to_numpy()

    # --- 3. renormalise the market implied probability -------------------
    survivors["market_implied_prob"] = _market_implied_prob(survivors).to_numpy()

    # --- 4. renormalise final predictions to sum to 100 % ----------------
    survivors = renormalize_predictions(survivors)
    return survivors


def renormalize_predictions(race_df: pd.DataFrame) -> pd.DataFrame:
    """Rescale probability columns so each sums correctly over the field.

    ``proba_gagnant`` must sum to 1 (exactly one winner). ``proba_podium`` is
    the expected number of podium finishers = 3, so it is rescaled to sum to
    ``min(3, n_runners)``. Also refreshes ``rang_predit`` from the win column.
    Safe to call whether or not the columns exist yet.
    """
    out = race_df.copy()
    n = len(out)

    if "proba_gagnant" in out.columns:
        s = pd.to_numeric(out["proba_gagnant"], errors="coerce").clip(lower=0)
        total = s.sum()
        out["proba_gagnant"] = (s / total) if total > 0 else (1.0 / n)

    if "proba_podium" in out.columns:
        target = float(min(3, n))
        s = pd.to_numeric(out["proba_podium"], errors="coerce").clip(0, 1)
        total = s.sum()
        scaled = (s / total * target) if total > 0 else pd.Series(target / n, index=out.index)
        out["proba_podium"] = scaled.clip(0, 1)

    if "proba_gagnant" in out.columns:
        out = out.sort_values("proba_gagnant", ascending=False)
        out["rang_predit"] = np.arange(1, len(out) + 1)

    return out
