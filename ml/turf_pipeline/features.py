"""BLOC 1 — Ingénierie des caractéristiques (les 5 Piliers).

The single public entry point is :func:`compute_advanced_features`. Every
feature is engineered to be **leak-free**: for a given runner in race *R*, no
value is allowed to depend on the outcome of *R* (or of any later race). This is
enforced with three disciplined patterns applied everywhere:

* chronological sort by ``race_datetime`` before any temporal computation;
* ``groupby(...).shift(1)`` / ``expanding().mean().shift(1)`` so the current row
  is never included in its own aggregate;
* rolling **time** windows closed on the left (``closed="left"``).

All functions tolerate missing columns and NaNs — a robustness requirement for
live turf data, which is frequently incomplete right up to the off.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from .config import (
    COLUMNS as C,
    GROUND_SEVERITY,
    GROUND_SEVERITY_DEFAULT,
    START_TYPE_ENCODING,
    START_TYPE_DEFAULT,
    TROT_DISCIPLINES,
    GALOP_DISCIPLINES,
    UNSHOD_TOKENS,
    RANK,
)


# ---------------------------------------------------------------------------
# Small robust helpers
# ---------------------------------------------------------------------------
def _series(df: pd.DataFrame, col: str, default=np.nan) -> pd.Series:
    """Return ``df[col]`` or, if absent, a same-length Series of ``default``."""
    if col in df.columns:
        return df[col]
    return pd.Series(default, index=df.index, name=col)


def _to_num(s: pd.Series, default=np.nan) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").fillna(default)


def _norm_text(s: pd.Series) -> pd.Series:
    """Lower-case, strip accents and squeeze whitespace for robust matching."""
    return (
        s.fillna("")
        .astype(str)
        .str.lower()
        .str.normalize("NFKD")
        .str.encode("ascii", "ignore")
        .str.decode("ascii")
        .str.strip()
    )


def _horse_key(df: pd.DataFrame) -> pd.Series:
    """Stable per-horse key: prefer an explicit id, fall back to the name."""
    hid = _series(df, C.horse_id, default=np.nan)
    name = _series(df, C.horse_name, default="")
    return hid.where(hid.notna() & (hid.astype(str) != ""), name).astype(str)


# ---------------------------------------------------------------------------
# PILIER 1 — Profil & forme du cheval
# ---------------------------------------------------------------------------
def _elo_rating(df: pd.DataFrame) -> pd.Series:
    """Dynamic multi-runner ELO — the *pre-race* rating is used as the feature.

    Ratings are updated race-by-race in chronological order using a pairwise
    Bradley–Terry formulation: within a race every runner is compared to every
    other, expected score from the logistic curve, actual score = 1 if it
    finished ahead. Because we only ever emit the rating *before* the update,
    there is no leakage of the current race's result.
    """
    k, base, scale = RANK.elo_k, RANK.elo_base, RANK.elo_scale
    horse = _horse_key(df)
    dt = df[C.race_datetime]
    finish = _to_num(_series(df, C.finish_pos), default=np.nan)

    order = pd.DataFrame(
        {"row": df.index, "horse": horse.values, "race": df[C.race_id].values,
         "dt": dt.values, "finish": finish.values}
    ).sort_values(["dt", "race"], kind="mergesort")

    ratings: dict[str, float] = {}
    pre_rating = pd.Series(base, index=df.index, dtype=float)

    for _, grp in order.groupby("race", sort=False):
        rows = grp["row"].to_numpy()
        horses = grp["horse"].to_numpy()
        finishes = grp["finish"].to_numpy()
        cur = np.array([ratings.get(h, base) for h in horses], dtype=float)

        # Emit pre-race rating (the leak-free feature).
        for r, val in zip(rows, cur):
            pre_rating.at[r] = val

        # Update only when we actually know the finishing order.
        n = len(horses)
        if n < 2 or np.all(np.isnan(finishes)):
            for h, val in zip(horses, cur):
                ratings[h] = val
            continue

        # Rank NaN finishers behind everyone (unknown = did not place well).
        fin = np.where(np.isnan(finishes), np.nanmax(finishes) + 1, finishes)
        deltas = np.zeros(n)
        for i in range(n):
            exp_i = 1.0 / (1.0 + 10.0 ** ((cur - cur[i]) / scale))  # vs each j
            act_i = np.where(fin[i] < fin, 1.0, np.where(fin[i] > fin, 0.0, 0.5))
            act_i[i] = 0.0  # ignore self-comparison
            exp_i[i] = 0.0
            deltas[i] = k * (act_i.sum() - exp_i.sum()) / (n - 1)
        for h, val, d in zip(horses, cur, deltas):
            ratings[h] = val + d

    return pre_rating


def _days_since_last_race(df: pd.DataFrame) -> pd.Series:
    horse = _horse_key(df)
    dt = df[C.race_datetime]
    tmp = pd.DataFrame({"h": horse, "dt": dt}).sort_values("dt", kind="mergesort")
    prev = tmp.groupby("h")["dt"].shift(1)
    days = (tmp["dt"] - prev).dt.total_seconds() / 86400.0
    # NaN (débutant / rentrée) -> 999 as specified.
    return days.reindex(df.index).fillna(999.0).clip(lower=0)


def _parse_musique(m: str) -> list[int]:
    """"1aDa2a0a" -> [1, 99, 2, 99]  (letters/0 -> 99 'no placing')."""
    if not isinstance(m, str) or not m:
        return []
    out: list[int] = []
    for tok in re.findall(r"\d+|[A-Za-z]", m):
        if tok.isdigit():
            v = int(tok)
            out.append(v if 1 <= v <= 20 else 99)
        else:
            out.append(99)
    return out


def _form_index_3_races(df: pd.DataFrame) -> pd.Series:
    """Weighted mean of the last ``form_window`` finishing positions.

    Uses the real recorded ``finish_pos`` history (shifted, so leak-free) and
    falls back to the scraped *musique* for cold-start horses. Lower is better,
    so we return an inverted 0–100 score (100 = perfect recent form).
    """
    w = RANK.form_window
    horse = _horse_key(df)
    finish = _to_num(_series(df, C.finish_pos), default=np.nan)

    tmp = pd.DataFrame(
        {"h": horse, "dt": df[C.race_datetime], "fin": finish}
    ).sort_values("dt", kind="mergesort")

    def _wmean(x: pd.Series) -> float:
        vals = x.to_numpy(dtype=float)
        if np.all(np.isnan(vals)):
            return np.nan
        weights = np.linspace(1.0, 0.5, num=len(vals))
        mask = ~np.isnan(vals)
        return float(np.average(vals[mask], weights=weights[mask]))

    # shift(1) drops the current race; rolling(window=w) keeps the last w priors.
    rolled = (
        tmp.groupby("h")["fin"]
        .apply(lambda s: s.shift(1).rolling(w, min_periods=1).apply(
            lambda x: _wmean(pd.Series(x)), raw=False))
        .reset_index(level=0, drop=True)
    )
    avg_pos = rolled.reindex(df.index)

    # Cold-start fallback from musique (first few tokens).
    musique = _series(df, C.musique, default="")
    fallback = musique.map(lambda m: np.nan if not _parse_musique(m)
                           else float(np.mean([p if p < 99 else 8
                                               for p in _parse_musique(m)[:w]])))
    avg_pos = avg_pos.fillna(fallback)

    # Invert: clip positions to [1, 15] then map to 100..0.
    avg_pos = avg_pos.clip(1, 15)
    return ((15 - avg_pos) / 14 * 100).fillna(45.0)


def _is_unshod_feature(df: pd.DataFrame) -> pd.Series:
    """Binary déferrage flag — only meaningful for trot disciplines."""
    disc = _norm_text(_series(df, C.discipline, default=""))
    is_trot = disc.isin(TROT_DISCIPLINES) | disc.str.contains("trot", na=False)
    tok = _norm_text(_series(df, C.deferrage, default="")).str.replace(" ", "")
    unshod = tok.isin(UNSHOD_TOKENS) | tok.str.startswith("d")
    return (is_trot & unshod).astype(int)


# ---------------------------------------------------------------------------
# PILIER 2 — Statistiques des acteurs
# ---------------------------------------------------------------------------
def _expanding_podium_rate(df: pd.DataFrame, key: pd.Series) -> pd.Series:
    """Historic podium rate of ``key`` — expanding mean of a *shifted* target.

    ``shift(1)`` guarantees the current race is excluded (no leakage). NaN
    (never seen before) is left as NaN for the caller to prior-fill.
    """
    podium = (_to_num(_series(df, C.finish_pos), default=np.nan) <= 3).astype(float)
    podium[_to_num(_series(df, C.finish_pos)).isna()] = np.nan
    tmp = pd.DataFrame(
        {"k": key.values, "dt": df[C.race_datetime].values, "p": podium.values},
        index=df.index,
    ).sort_values("dt", kind="mergesort")
    rate = (
        tmp.groupby("k")["p"]
        .apply(lambda s: s.shift(1).expanding().mean())
        .reset_index(level=0, drop=True)
    )
    return rate.reindex(df.index)


def _couple_success_rate(df: pd.DataFrame) -> pd.Series:
    jockey = _norm_text(_series(df, C.jockey, default=""))
    trainer = _norm_text(_series(df, C.trainer, default=""))
    couple = (jockey + " | " + trainer)
    rate = _expanding_podium_rate(df, couple)
    return rate.fillna(0.30)  # neutral prior ≈ base podium rate


def _rolling_actor_form(df: pd.DataFrame, actor: pd.Series) -> pd.Series:
    """Podium rate over the trailing ``actor_form_days`` days (left-closed)."""
    days = RANK.actor_form_days
    podium = (_to_num(_series(df, C.finish_pos), default=np.nan) <= 3).astype(float)
    podium[_to_num(_series(df, C.finish_pos)).isna()] = np.nan

    tmp = pd.DataFrame(
        {"a": actor.values, "dt": pd.to_datetime(df[C.race_datetime]).values,
         "p": podium.values},
        index=df.index,
    ).sort_values("dt", kind="mergesort")

    def _roll(g: pd.DataFrame) -> pd.Series:
        s = g.set_index("dt")["p"]
        # closed="left" excludes the current instant -> no leakage.
        return s.rolling(f"{days}D", closed="left").mean()

    rolled = (
        tmp.groupby("a", group_keys=False)[["dt", "p"]]
        .apply(_roll)
    )
    rolled.index = tmp.index  # realign to original rows
    return rolled.reindex(df.index).fillna(0.30)


def _jockey_form_30d(df: pd.DataFrame) -> pd.Series:
    return _rolling_actor_form(df, _norm_text(_series(df, C.jockey, default="")))


def _trainer_form_30d(df: pd.DataFrame) -> pd.Series:
    return _rolling_actor_form(df, _norm_text(_series(df, C.trainer, default="")))


# ---------------------------------------------------------------------------
# PILIER 3 — Typologie de l'hippodrome
# ---------------------------------------------------------------------------
def _ground_severity(df: pd.DataFrame) -> pd.Series:
    terrain = _norm_text(_series(df, C.terrain, default=""))
    sev = terrain.map(GROUND_SEVERITY)
    # Try substring matches for compound labels ("terrain lourd", ...).
    unresolved = sev.isna()
    if unresolved.any():
        for key, val in sorted(GROUND_SEVERITY.items(), key=lambda kv: -len(kv[0])):
            hit = unresolved & terrain.str.contains(key, na=False)
            sev = sev.mask(hit, val)
            unresolved = sev.isna()
    sev = sev.fillna(GROUND_SEVERITY_DEFAULT)
    # Weather correlation: rain worsens the ground by one notch (capped at 5).
    weather = _norm_text(_series(df, C.weather, default=""))
    rain = weather.str.contains("pluie|averse|orage", na=False)
    return (sev + rain.astype(int)).clip(1, 5).astype(int)


def _track_suitability_index(df: pd.DataFrame) -> pd.Series:
    """Horse's historic podium rate on this (corde × ground-severity) profile."""
    horse = _horse_key(df)
    corde = _norm_text(_series(df, C.corde, default="na"))
    sev = _ground_severity(df).astype(str)
    key = horse + "|" + corde + "|" + sev
    rate = _expanding_podium_rate(df, key)
    return rate.fillna(0.30)


# ---------------------------------------------------------------------------
# PILIER 4 — Conditions de la course
# ---------------------------------------------------------------------------
def _rope_advantage(df: pd.DataFrame) -> pd.Series:
    """Galop draw-bias score, 0–1. Inside draws help most over sprints; the
    effect fades with distance and only applies on the flat/jumps."""
    disc = _norm_text(_series(df, C.discipline, default=""))
    is_galop = disc.isin(GALOP_DISCIPLINES) | disc.str.contains(
        "plat|galop|haies|steeple", na=False)

    draw = _to_num(_series(df, C.number), default=np.nan)
    dist = _to_num(_series(df, C.distance), default=np.nan)

    # Field size per race for a relative draw position in [0, 1].
    field = df.groupby(C.race_id)[C.race_id].transform("size").astype(float)
    rel_draw = (draw - 1) / (field - 1).replace(0, np.nan)
    rel_draw = rel_draw.fillna(0.5)

    # Distance weight: strong bias at ≤1400 m, negligible beyond ~2400 m.
    dist_w = (1.0 - (dist.clip(1000, 2600) - 1000) / 1600).fillna(0.3).clip(0, 1)

    # Inside (low rel_draw) is favoured -> advantage = (1 - rel_draw).
    adv = (1.0 - rel_draw) * dist_w
    return adv.where(is_galop, 0.0).fillna(0.0)


def _start_type_encoded(df: pd.DataFrame) -> pd.Series:
    st = _norm_text(_series(df, C.start_type, default=""))
    enc = st.map(START_TYPE_ENCODING)
    unresolved = enc.isna()
    if unresolved.any():
        for key, val in START_TYPE_ENCODING.items():
            hit = unresolved & st.str.contains(key, na=False)
            enc = enc.mask(hit, val)
            unresolved = enc.isna()
    return enc.fillna(START_TYPE_DEFAULT).astype(int)


def _race_density(df: pd.DataFrame) -> pd.Series:
    """Runners-per-100 m — a proxy for congestion. Recomputed live after NP."""
    field = df.groupby(C.race_id)[C.race_id].transform("size").astype(float)
    dist = _to_num(_series(df, C.distance), default=np.nan).replace(0, np.nan)
    return (field / (dist / 100.0)).fillna(field / 20.0)


# ---------------------------------------------------------------------------
# PILIER 5 — Signaux de marché (LIVE)
# ---------------------------------------------------------------------------
def _odds_trend_15m(df: pd.DataFrame) -> pd.Series:
    """Relative drift between opening odds and the T-15 min odds.

    Negative = steamer (money coming, odds shortening) — a strong signal.
    Falls back to 0 when we lack an opening or T-15 quote.
    """
    open_ = _to_num(_series(df, C.odds_open), default=np.nan)
    late = _to_num(_series(df, C.odds_15m), default=np.nan)
    cur = _to_num(_series(df, C.odds), default=np.nan)
    late = late.fillna(cur)
    open_ = open_.fillna(cur)
    trend = (late - open_) / open_.replace(0, np.nan)
    return trend.fillna(0.0).clip(-1.0, 3.0)


def _market_implied_prob(df: pd.DataFrame) -> pd.Series:
    """Overround-corrected implied probability from live odds, per race.

    p_i = (1/odds_i) / Σ(1/odds_j). Uniform prior when a race has no odds.
    """
    odds = _to_num(_series(df, C.odds), default=np.nan)
    inv = 1.0 / odds.where(odds > 1.0)
    denom = inv.groupby(df[C.race_id]).transform("sum")
    field = df.groupby(C.race_id)[C.race_id].transform("size").astype(float)
    prob = inv / denom
    return prob.fillna(1.0 / field)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def compute_advanced_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute all 5 pillars and return a copy of ``df`` with feature columns.

    The input must already carry the canonical columns of :data:`config.COLUMNS`
    (use ``data_source.to_canonical`` first). ``race_datetime`` must be a proper
    datetime dtype. The function is idempotent and never mutates its argument.
    """
    if df.empty:
        return df.copy()

    out = df.copy()
    out[C.race_datetime] = pd.to_datetime(out[C.race_datetime], errors="coerce")
    # A stable chronological order underpins every leak-free computation.
    out = out.sort_values([C.race_datetime, C.race_id], kind="mergesort")

    # Pilier 1
    out["elo_rating"] = _elo_rating(out)
    out["days_since_last_race"] = _days_since_last_race(out)
    out["form_index_3_races"] = _form_index_3_races(out)
    out["is_unshod_feature"] = _is_unshod_feature(out)
    # Pilier 2
    out["couple_success_rate"] = _couple_success_rate(out)
    out["jockey_form_30d"] = _jockey_form_30d(out)
    out["trainer_form_30d"] = _trainer_form_30d(out)
    # Pilier 3
    out["ground_severity"] = _ground_severity(out)
    out["track_suitability_index"] = _track_suitability_index(out)
    # Pilier 4
    out["rope_advantage"] = _rope_advantage(out)
    out["start_type_encoded"] = _start_type_encoded(out)
    out["race_density"] = _race_density(out)
    # Pilier 5
    out["odds_trend_15m"] = _odds_trend_15m(out)
    out["market_implied_prob"] = _market_implied_prob(out)

    return out
