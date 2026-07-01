import { useEffect, useState } from 'react';
import api from '../services/api';
import { analyzeRace, applyBackendPredictions } from '../services/aiEngine';

// ---------------------------------------------------------------------------
// PARISPROMAX — usePrediction
//
// Returns an analyzed race. When `enabled` (the user has access), it fetches the
// backend's trained predictions (LightGBM/CatBoost ranker via /races/:id/
// prediction) and overlays them onto the local analysis. On ANY failure — no
// access, offline, malformed response — it silently keeps the local analysis,
// so a screen using this hook never breaks or blocks on the network.
// ---------------------------------------------------------------------------

function localAnalyze(race) {
  if (!race) return race;
  // HomeScreen/QuintePlus may already have analyzed the race locally.
  return race.horses?.[0]?.aiScore != null ? race : analyzeRace(race);
}

export function usePrediction(race, enabled) {
  const [analyzed, setAnalyzed] = useState(() => localAnalyze(race));
  // Tracks whether the displayed scores came from the backend model.
  const [fromBackend, setFromBackend] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const base = localAnalyze(race);
    setAnalyzed(base);
    setFromBackend(false);

    if (!enabled || !race?.id) return undefined;

    (async () => {
      try {
        const res = await api.prediction(race.id);
        if (!cancelled && res && Array.isArray(res.topPicks) && res.topPicks.length) {
          setAnalyzed(applyBackendPredictions(base, res.topPicks));
          setFromBackend(true);
        }
      } catch (e) {
        // keep the local analysis (offline / locked / server error)
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [race, enabled]);

  return { race: analyzed, fromBackend };
}

export default usePrediction;
