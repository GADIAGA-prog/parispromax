"""Data adapters — map the Node backend's shapes onto the canonical schema.

The pipeline is deliberately decoupled from where data comes from. Two concrete
adapters are provided:

* :func:`load_live_races` — the *upcoming* card (no results yet), used at
  inference time. Reads either ``GET /races/full`` or a local
  ``live_races.json`` file.
* :func:`load_training_frame` — historical races *with* finishing order, used to
  train. Reads ``GET /races/history`` or a local export.

Everything is normalised through :func:`to_canonical`, so plugging in a real DB
export later means writing one more adapter, not touching the modelling code.
"""

from __future__ import annotations

import json
import os
import re

import pandas as pd

from .config import COLUMNS as C

BACKEND_URL = os.environ.get("PPM_BACKEND_URL", "http://localhost:4000")


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------
def _distance_m(value) -> float | None:
    """"2100m" / "2 100 m" / 2100 -> 2100.0 (metres)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = re.search(r"(\d[\d\s]*)", str(value).replace(" ", " "))
    if not m:
        return None
    return float(m.group(1).replace(" ", ""))


def _discipline(track_disc: str | None, race_name: str | None) -> str | None:
    """Best-effort discipline from the track/race labels (trot vs plat vs ...)."""
    text = f"{track_disc or ''} {race_name or ''}".lower()
    if "attel" in text:
        return "attele"
    if "mont" in text:
        return "monte"
    if "trot" in text:
        return "trot"
    if "haies" in text:
        return "haies"
    if "steeple" in text or "cross" in text:
        return "steeple"
    if "plat" in text or "galop" in text:
        return "plat"
    return track_disc


def _race_datetime(date: str | None, time: str | None) -> pd.Timestamp:
    """Combine "YYYY-MM-DD" + "HH:MM" into a Timestamp (NaT-safe)."""
    stamp = f"{date or ''} {time or ''}".strip()
    return pd.to_datetime(stamp, errors="coerce", dayfirst=False)


# ---------------------------------------------------------------------------
# Canonical mapping
# ---------------------------------------------------------------------------
def to_canonical(races: list[dict]) -> pd.DataFrame:
    """Flatten a list of race dicts into one row per runner (canonical columns).

    Expected race dict (superset of the backend's ``/races/full`` shape)::

        {
          "id": "c1663633", "track": "Vichy", "date": "2026-06-30",
          "discipline": "trot", "distance": "2100m", "condition": "souple",
          "time": "13:47", "corde": "gauche", "start_type": "autostart",
          "weather": "couvert",
          "horses": [ {number, name, jockey, trainer, form, odds, gains,
                        odds_open, odds_15m, deferrage, finish_pos, cheval_id} ]
        }
    """
    rows: list[dict] = []
    for race in races or []:
        rid = race.get("id") or race.get("externalId")
        disc = _discipline(race.get("discipline"), race.get("name"))
        dist = _distance_m(race.get("distance"))
        dt = _race_datetime(race.get("date"), race.get("time"))
        for h in race.get("horses", []) or []:
            rows.append({
                C.race_id: rid,
                C.race_datetime: dt,
                C.date: race.get("date"),
                C.horse_id: h.get("cheval_id") or h.get("id") or h.get("name"),
                C.horse_name: h.get("name"),
                C.number: h.get("number"),
                C.jockey: h.get("jockey") or h.get("driver"),
                C.trainer: h.get("trainer"),
                C.musique: h.get("form"),
                C.gains: h.get("gains"),
                C.odds: h.get("odds"),
                C.odds_open: h.get("odds_open"),
                C.odds_15m: h.get("odds_15m"),
                C.discipline: disc,
                C.distance: dist,
                C.corde: race.get("corde") or h.get("corde"),
                C.terrain: race.get("terrain") or race.get("condition"),
                C.weather: race.get("weather"),
                C.start_type: race.get("start_type") or h.get("start_type"),
                C.deferrage: h.get("deferrage"),
                C.finish_pos: h.get("finish_pos"),
            })
    df = pd.DataFrame(rows)
    if not df.empty:
        df[C.race_datetime] = pd.to_datetime(df[C.race_datetime], errors="coerce")
    return df


# ---------------------------------------------------------------------------
# Live (upcoming) card
# ---------------------------------------------------------------------------
def _flatten_racetracks(payload: dict) -> list[dict]:
    """``{racetracks:[{races:[...]}]}`` -> flat list of race dicts."""
    out: list[dict] = []
    for track in payload.get("racetracks", []) or []:
        for race in track.get("races", []) or []:
            out.append({
                **race,
                "track": track.get("name"),
                "discipline": race.get("discipline") or track.get("discipline"),
                "condition": race.get("condition") or track.get("condition"),
            })
    return out


def load_live_races(source: str | None = None) -> pd.DataFrame:
    """Return the upcoming card as a canonical DataFrame (no ``finish_pos``).

    ``source`` may be a path to a ``live_races.json`` file; if omitted, fetches
    ``GET {BACKEND_URL}/races/full``.
    """
    if source and os.path.exists(source):
        with open(source, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    else:
        import requests
        payload = requests.get(f"{BACKEND_URL}/races/full", timeout=15).json()
    return to_canonical(_flatten_racetracks(payload))


# ---------------------------------------------------------------------------
# Training frame (historical races with results)
# ---------------------------------------------------------------------------
def _attach_finish(race: dict, winners: list) -> dict:
    """Set ``finish_pos`` on each horse from an arrival order [num, num, ...]."""
    pos_by_num = {int(n): i + 1 for i, n in enumerate(winners) if _is_int(n)}
    horses = []
    for h in race.get("horses", []) or []:
        num = h.get("number")
        horses.append({**h, "finish_pos": pos_by_num.get(_safe_int(num))})
    return {**race, "horses": horses}


def load_training_frame(source: str | None = None) -> pd.DataFrame:
    """Historical, labelled races as a canonical DataFrame.

    Reads the backend's ``GET /races/history`` (which returns, per race, the raw
    horses + the ``winners`` arrival order) or a local JSON export with the same
    shape. Only races that carry a full arrival are kept.
    """
    if source and os.path.exists(source):
        with open(source, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        import requests
        data = requests.get(f"{BACKEND_URL}/races/history", timeout=30).json()

    history = data.get("history", data) if isinstance(data, dict) else data
    races: list[dict] = []
    for item in history or []:
        winners = item.get("winners") or []
        if len(winners) < 3:
            continue  # unfinished / partial arrival -> skip
        # /races/history nests the full race under `race`/`raw`; support both.
        race = item.get("race") or item
        race = {
            "id": race.get("id") or item.get("id"),
            "track": race.get("track") or item.get("track"),
            "date": race.get("date") or item.get("date"),
            "name": race.get("name") or item.get("race"),
            "discipline": race.get("discipline"),
            "distance": race.get("distance"),
            "condition": race.get("condition"),
            "time": race.get("time"),
            "corde": race.get("corde"),
            "start_type": race.get("start_type"),
            "weather": race.get("weather"),
            "horses": race.get("horses") or item.get("horses") or [],
        }
        races.append(_attach_finish(race, winners))

    return to_canonical(races)


def _is_int(v) -> bool:
    try:
        int(v)
        return True
    except (TypeError, ValueError):
        return False


def _safe_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
