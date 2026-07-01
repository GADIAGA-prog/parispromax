"""BLOC 4 — Automatisation du pipeline (toutes les 10 minutes) + export Android.

:func:`run_prediction_cycle` runs one full cycle:

  fresh data -> features -> per race: intercept non-partants -> predict ->
  renormalise -> JSON payload.

:func:`start_scheduler` wires that cycle onto a 10-minute loop with the
``schedule`` library. A cycle never throws to the loop: any per-race failure is
logged and skipped so one bad race can't stall the card.
"""

from __future__ import annotations

import json
import os
import time
import traceback

import pandas as pd

from .config import COLUMNS as C
from .data_source import load_live_races, BACKEND_URL
from .features import compute_advanced_features
from .inference import predict_race, to_android_payload
from .ranker import TurfRanker
from .scratchings import handle_scratchings

DEFAULT_MODEL_PATH = os.environ.get("PPM_MODEL_PATH", "ml/artifacts/turf_ranker.joblib")
DEFAULT_OUTPUT = os.environ.get("PPM_PREDICTIONS_OUT", "ml/artifacts/predictions.json")


# ---------------------------------------------------------------------------
# Non-partants feed
# ---------------------------------------------------------------------------
def fetch_non_partants(race_id: str) -> list:
    """Return the list of NP (cheval_id or numbers) for a race, live.

    Order of resolution:
      1. ``GET {BACKEND_URL}/races/{race_id}/non-partants`` if reachable;
      2. a local ``PPM_NP_FILE`` JSON map ``{race_id: [numbers]}`` (handy for
         tests / manual overrides);
      3. empty list.
    """
    np_file = os.environ.get("PPM_NP_FILE")
    if np_file and os.path.exists(np_file):
        try:
            with open(np_file, "r", encoding="utf-8") as fh:
                return json.load(fh).get(str(race_id), [])
        except Exception:  # noqa: BLE001 - never let the feed break a cycle
            pass
    try:
        import requests
        r = requests.get(f"{BACKEND_URL}/races/{race_id}/non-partants", timeout=8)
        if r.ok:
            data = r.json()
            return data.get("non_partants", data if isinstance(data, list) else [])
    except Exception:  # noqa: BLE001
        pass
    return []


# ---------------------------------------------------------------------------
# One cycle
# ---------------------------------------------------------------------------
def run_prediction_cycle(
    ranker: TurfRanker,
    live_source: str | None = None,
    output_path: str = DEFAULT_OUTPUT,
    generated_at: str | None = None,
) -> dict:
    """Fetch fresh data, predict every race, write + return the Android payload.

    ``generated_at`` is injected by the caller (ISO string); the scheduler stamps
    it once per tick so the whole batch shares one timestamp.
    """
    live = load_live_races(live_source)
    if live.empty:
        print("[cycle] no live races available")
        return {"generated_at": generated_at, "races": []}

    # Features must be computed over the *whole* frame so history-based features
    # (elo, forms, suitability) see every prior runner, not just this race.
    feats = compute_advanced_features(live)

    races_payload = []
    for race_id, race_df in feats.groupby(C.race_id, sort=False):
        try:
            np_list = fetch_non_partants(race_id)
            race_df = handle_scratchings(race_df, np_list)
            if race_df.empty:
                continue
            predicted = predict_race(ranker, race_df)
            races_payload.append(
                to_android_payload(race_id, predicted, generated_at))
        except Exception:  # noqa: BLE001 - isolate per-race failures
            print(f"[cycle] race {race_id} failed:\n{traceback.format_exc()}")

    payload = {
        "generated_at": generated_at,
        "source": live_source or f"{BACKEND_URL}/races/full",
        "n_races": len(races_payload),
        "races": races_payload,
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"[cycle] wrote {len(races_payload)} races -> {output_path}")

    _maybe_post(payload)
    return payload


def _maybe_post(payload: dict) -> None:
    """POST the payload to the backend if ``PPM_PUSH_URL`` is configured."""
    url = os.environ.get("PPM_PUSH_URL")
    if not url:
        return
    try:
        import requests
        headers = {}
        token = os.environ.get("PPM_PUSH_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        requests.post(url, json=payload, headers=headers, timeout=15)
        print(f"[cycle] pushed predictions to {url}")
    except Exception:  # noqa: BLE001
        print(f"[cycle] push failed:\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# 10-minute loop
# ---------------------------------------------------------------------------
def start_scheduler(
    model_path: str = DEFAULT_MODEL_PATH,
    live_source: str | None = None,
    output_path: str = DEFAULT_OUTPUT,
    every_minutes: int = 10,
    run_now: bool = True,
) -> None:
    """Blocking loop: run :func:`run_prediction_cycle` every ``every_minutes``.

    The model is reloaded from disk before each cycle so a freshly retrained
    ``turf_ranker.joblib`` is picked up without restarting the daemon.
    """
    import schedule

    def _tick():
        try:
            ranker = TurfRanker.load(model_path)
        except Exception:  # noqa: BLE001
            print(f"[sched] cannot load model at {model_path}; skipping tick")
            return
        # One shared timestamp per tick (pandas keeps Date.now-free code happy).
        generated_at = pd.Timestamp.utcnow().isoformat()
        run_prediction_cycle(ranker, live_source, output_path, generated_at)

    schedule.every(every_minutes).minutes.do(_tick)
    print(f"[sched] running every {every_minutes} min (Ctrl-C to stop)")
    if run_now:
        _tick()
    while True:
        schedule.run_pending()
        time.sleep(1)
