// ---------------------------------------------------------------------------
// PARISPROMAX — AI prediction engine (app). Mirrors backend src/services/aiEngine.
//
// Richer, race-level scoring blending multiple real signals:
//   - form        : recency-weighted recent placings (musique)
//   - consistency : how often the horse finishes in the top 3 (regularity)
//   - recentWin   : bonus if it won/placed last time out
//   - class       : career earnings (gains), log-scaled & normalized in the race
//   - connections : jockey/trainer rating (from real historical results)
//   - market      : odds, when published (collective intelligence — heavy)
// Weights adapt to whether odds are available.
// ---------------------------------------------------------------------------

export const BADGES = {
  TOP: { key: 'TOP', label: '🔥 TOP PRONO', color: '#10b981' },
  VALUE: { key: 'VALUE', label: '⭐ VALUE BET', color: '#fbbf24' },
  CHRONO: { key: 'CHRONO', label: '⏱️ RECORD CHRONO', color: '#38bdf8' },
};

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function oddsStrength(odds) {
  if (!odds || odds <= 1) return null;
  return clamp((1 / odds) * 110, 0, 100);
}

// Parse a "musique" (e.g. "1a2a(24)Da3a") into recent placings (most recent
// first). "0" = finished unplaced (10th+), coded 10; incidents coded 99; year
// markers "(24)" are ignored.
function parseMusique(m) {
  const s = String(m || '').replace(/\(\s*\d{2}\s*\)/g, ' ');
  const tokens = s.match(/\d|[A-Za-z]/g) || [];
  const placings = [];
  for (const t of tokens) {
    if (placings.length >= 6) break;
    if (/^\d$/.test(t)) placings.push(t === '0' ? 10 : parseInt(t, 10));
    else if (/^[DTAR]$/i.test(t)) placings.push(99); // Disq./Tombé/Arrêté/Rétro
  }
  return placings;
}

function placeValue(p) {
  if (p === 1) return 100;
  if (p === 2) return 85;
  if (p === 3) return 72;
  if (p === 4) return 58;
  if (p === 5) return 48;
  if (p >= 6 && p <= 9) return 32;
  if (p === 10) return 20; // "0" : arrivé au-delà de la 9e place
  return 12; // incident
}

// Returns { form, consistency, recentWin } from a musique, or null placings.
function formMetrics(h) {
  const placings = parseMusique(h.form);
  if (!placings.length) {
    // Fall back to any precomputed formScore from the scraper.
    const f = num(h.formScore, 45);
    return { form: clamp(f, 0, 100), consistency: 45, recentWin: 0 };
  }
  const weights = [1, 0.85, 0.7, 0.55, 0.42, 0.3];
  let s = 0;
  let sw = 0;
  placings.forEach((p, i) => {
    const w = weights[i] || 0.2;
    s += placeValue(p) * w;
    sw += w;
  });
  const form = Math.round(s / sw);

  const runs = placings.length;
  const top3 = placings.filter((p) => p >= 1 && p <= 3).length;
  const bad = placings.filter((p) => p >= 99).length;
  const consistency = clamp((top3 / runs) * 100 - (bad / runs) * 30, 0, 100);

  const recentWin = placings[0] === 1 ? 6 : placings[0] === 2 || placings[0] === 3 ? 2 : 0;
  return { form, consistency, recentWin };
}

function buildContext(horses) {
  const logGains = horses.map((h) => Math.log10(Math.max(1, num(h.gains, 0)) + 1));
  return {
    maxLG: Math.max(...logGains, 0),
    minLG: Math.min(...logGains, 0),
    anyOdds: horses.some((h) => num(h.odds, 0) > 1),
  };
}

function scoreHorse(h, ctx) {
  const { form, consistency, recentWin } = formMetrics(h);
  const lg = Math.log10(Math.max(1, num(h.gains, 0)) + 1);
  const range = ctx.maxLG - ctx.minLG || 1;
  const classScore = ctx.maxLG > 0 ? clamp(((lg - ctx.minLG) / range) * 100, 0, 100) : 50;
  const connections = clamp(num(h.jockeyRating, 60), 0, 100);
  const market = oddsStrength(h.odds);

  let base;
  if (ctx.anyOdds && market != null) {
    base =
      form * 0.3 + market * 0.28 + consistency * 0.14 + classScore * 0.16 + connections * 0.12;
  } else {
    base = form * 0.4 + consistency * 0.2 + classScore * 0.22 + connections * 0.18;
  }
  return Math.round(clamp(base + recentWin, 0, 100) * 10) / 10;
}

export function computeAIScore(horse) {
  return scoreHorse(horse, buildContext([horse]));
}

function computeValueIndex(aiScore, odds) {
  const o = num(odds, 0);
  if (o < 2) return 0;
  return aiScore * Math.log10(Math.max(1.1, o));
}

// Rank + badge a set of horses that ALREADY carry `aiScore` (+ valueIndex).
// Shared by analyzeRace (local scoring) and applyBackendPredictions (server
// scoring) so both produce an identically-shaped, consistently-badged race.
function annotateRace(race) {
  const scored = race.horses;
  const sortedByScore = [...scored].sort((a, b) => b.aiScore - a.aiScore);
  const topHorse = sortedByScore[0];
  const bestChrono = scored
    .filter((h) => num(h.chrono, 0) > 0)
    .reduce((min, h) => Math.min(min, h.chrono), Infinity);
  const bestValue = [...scored].sort((a, b) => b.valueIndex - a.valueIndex)[0];

  // Le serveur (edge modèle vs marché) prime sur l'heuristique locale.
  const anyBackendValue = scored.some((h) => h.backendValueBet === true);

  const annotated = sortedByScore.map((h, idx) => {
    const badges = [];
    if (topHorse && h.number === topHorse.number) badges.push(BADGES.TOP);
    const isValue = anyBackendValue
      ? h.backendValueBet === true && (!topHorse || h.number !== topHorse.number)
      : bestValue &&
        bestValue.valueIndex > 0 &&
        h.number === bestValue.number &&
        num(h.odds, 0) >= 4 &&
        (!topHorse || h.number !== topHorse.number);
    if (isValue) badges.push(BADGES.VALUE);
    if (num(h.chrono, 0) > 0 && h.chrono === bestChrono) badges.push(BADGES.CHRONO);
    return { ...h, rank: idx + 1, badges };
  });

  return { ...race, horses: annotated };
}

// ---- Probabilities (mirror of the backend engine) --------------------------
function softmax(scores, temperature = 12) {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

// Implied market probabilities, overround stripped (null when odds are sparse).
function marketProbs(horses) {
  const inv = horses.map((h) => {
    const o = num(h.odds, null);
    return o && o > 1 ? 1 / o : null;
  });
  const known = inv.filter((v) => v != null);
  if (known.length < Math.max(2, horses.length / 2)) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  const filled = inv.map((v) => (v != null ? v : avg * 0.6));
  const sum = filled.reduce((a, b) => a + b, 0) || 1;
  return filled.map((v) => v / sum);
}

// Exact Harville top-3 probability from win probabilities (n <= 40).
function harvillePodium(p) {
  const n = p.length;
  if (n <= 3) return p.map(() => 1);
  const total = p.reduce((a, b) => a + Math.max(b, 1e-9), 0);
  const w = p.map((v) => Math.max(v, 1e-9) / total);
  return w.map((pi, i) => {
    let p2 = 0;
    let p3 = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d1 = Math.max(1 - w[j], 1e-9);
      p2 += (w[j] * pi) / d1;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const d2 = Math.max(1 - w[j] - w[k], 1e-9);
        p3 += w[j] * (w[k] / d1) * (pi / d2);
      }
    }
    return clamp(pi + p2 + p3, 0, 1);
  });
}

const MODEL_WEIGHT = 0.6; // blend 60% modèle / 40% marché quand cotes publiées

export function analyzeRace(race) {
  if (!race || !Array.isArray(race.horses) || !race.horses.length) {
    return { ...race, horses: [] };
  }
  const ctx = buildContext(race.horses);
  const scores = race.horses.map((h) => scoreHorse(h, ctx));
  const modelP = softmax(scores);
  const market = marketProbs(race.horses);
  let winP = modelP;
  if (market) {
    const blended = modelP.map((p, i) => MODEL_WEIGHT * p + (1 - MODEL_WEIGHT) * market[i]);
    const sum = blended.reduce((a, b) => a + b, 0) || 1;
    winP = blended.map((p) => p / sum);
  }
  const podiumP = harvillePodium(winP);
  const scored = race.horses.map((h, i) => ({
    ...h,
    aiScore: scores[i],
    probaGagnant: Math.round(winP[i] * 1000) / 1000,
    probaPodium: Math.round(podiumP[i] * 1000) / 1000,
    valueIndex: computeValueIndex(scores[i], h.odds),
  }));
  return annotateRace({ ...race, horses: scored });
}

// Overlay the backend's predictions (the trained LightGBM/CatBoost ranker, or
// the server aiEngine) onto a race, then re-rank + re-badge. `picks` is the
// backend `topPicks` array: [{ number, aiScore, rank, probaGagnant?, probaPodium? }].
// Any runner missing from `picks` keeps its local score, so the screen never
// breaks if the server returns a partial field.
export function applyBackendPredictions(race, picks) {
  if (!race || !Array.isArray(race.horses) || !race.horses.length) return race;
  if (!Array.isArray(picks) || !picks.length) return race;

  const byNumber = new Map();
  picks.forEach((p) => {
    if (p && p.number != null) byNumber.set(p.number, p);
  });

  const merged = race.horses.map((h) => {
    const p = byNumber.get(h.number);
    if (!p) return h;
    const aiScore = num(p.aiScore, h.aiScore);
    return {
      ...h,
      aiScore,
      probaGagnant: num(p.probaGagnant, h.probaGagnant),
      probaPodium: num(p.probaPodium, h.probaPodium),
      // Value bet décidé côté serveur (edge modèle vs marché) quand disponible.
      backendValueBet: p.valueBet != null ? Boolean(p.valueBet) : h.backendValueBet,
      valueIndex: computeValueIndex(aiScore, h.odds),
      source: 'backend',
    };
  });

  return annotateRace({ ...race, horses: merged });
}

export function getTopPicks(race, n = 3) {
  const analyzed = race.horses?.[0]?.aiScore != null ? race : analyzeRace(race);
  return analyzed.horses.slice(0, n);
}

export function confidenceLabel(aiScore) {
  if (aiScore >= 72) return 'Confiance élevée';
  if (aiScore >= 58) return 'Confiance moyenne';
  return 'À surveiller';
}

export default {
  analyzeRace,
  applyBackendPredictions,
  computeAIScore,
  getTopPicks,
  confidenceLabel,
  BADGES,
};
