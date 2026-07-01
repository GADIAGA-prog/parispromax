// ---------------------------------------------------------------------------
// PARISPROMAX — AI prediction engine (app). Mirrors backend src/services/aiEngine.
//
// Race-level scoring blending the real signals from the source:
//   - recent form (musique -> formScore, recency-weighted upstream)
//   - class (career earnings "gains", normalized within the race)
//   - market confidence (odds, when published)
//   - jockey rating (when available)
// Weights adapt to whether odds are published.
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

// Score a single horse given precomputed race context.
function scoreHorse(h, ctx) {
  const form = clamp(num(h.formScore, 45), 0, 100);
  const classScore = ctx.maxG > 0 ? ((num(h.gains, 0) - ctx.minG) / ctx.range) * 100 : 50;
  const jockey = clamp(num(h.jockeyRating, 60), 0, 100);
  const market = oddsStrength(h.odds);

  let score;
  if (ctx.anyOdds && market != null) {
    score = form * 0.34 + market * 0.3 + classScore * 0.21 + jockey * 0.15;
  } else {
    score = form * 0.5 + classScore * 0.35 + jockey * 0.15;
  }
  return Math.round(score * 10) / 10;
}

export function computeAIScore(horse) {
  return scoreHorse(horse, { maxG: 0, minG: 0, range: 1, anyOdds: num(horse.odds, 0) > 1 });
}

// Value index: reward strong AI score at generous odds (an underrated runner).
function computeValueIndex(aiScore, odds) {
  const o = num(odds, 0);
  if (o < 2) return 0;
  return aiScore * Math.log10(Math.max(1.1, o));
}

// Analyze a whole race -> new race with annotated, ranked horses + badges.
export function analyzeRace(race) {
  if (!race || !Array.isArray(race.horses) || !race.horses.length) {
    return { ...race, horses: [] };
  }

  const gains = race.horses.map((h) => num(h.gains, 0));
  const ctx = {
    maxG: Math.max(...gains, 0),
    minG: Math.min(...gains),
    anyOdds: race.horses.some((h) => num(h.odds, 0) > 1),
  };
  ctx.range = ctx.maxG - ctx.minG || 1;

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
