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

// Parse a "musique" (e.g. "1a2aDa3a") into recent placings (most recent first).
function parseMusique(m) {
  const tokens = (m || '').match(/\d+|[A-Za-z]/g) || [];
  const placings = [];
  for (const t of tokens) {
    if (placings.length >= 6) break;
    if (/^\d+$/.test(t)) placings.push(parseInt(t, 10));
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
  if (p >= 6 && p < 99) return 32;
  return 12;
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

export function analyzeRace(race) {
  if (!race || !Array.isArray(race.horses) || !race.horses.length) {
    return { ...race, horses: [] };
  }
  const ctx = buildContext(race.horses);

  const scored = race.horses.map((h) => {
    const aiScore = scoreHorse(h, ctx);
    return { ...h, aiScore, valueIndex: computeValueIndex(aiScore, h.odds) };
  });

  const sortedByScore = [...scored].sort((a, b) => b.aiScore - a.aiScore);
  const topHorse = sortedByScore[0];
  const bestChrono = scored
    .filter((h) => num(h.chrono, 0) > 0)
    .reduce((min, h) => Math.min(min, h.chrono), Infinity);
  const bestValue = [...scored].sort((a, b) => b.valueIndex - a.valueIndex)[0];

  const annotated = sortedByScore.map((h, idx) => {
    const badges = [];
    if (topHorse && h.number === topHorse.number) badges.push(BADGES.TOP);
    if (
      bestValue &&
      bestValue.valueIndex > 0 &&
      h.number === bestValue.number &&
      num(h.odds, 0) >= 4 &&
      (!topHorse || h.number !== topHorse.number)
    ) {
      badges.push(BADGES.VALUE);
    }
    if (num(h.chrono, 0) > 0 && h.chrono === bestChrono) badges.push(BADGES.CHRONO);
    return { ...h, rank: idx + 1, badges };
  });

  return { ...race, horses: annotated };
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

export default { analyzeRace, computeAIScore, getTopPicks, confidenceLabel, BADGES };
