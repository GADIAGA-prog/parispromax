// ---------------------------------------------------------------------------
// PARISPROMAX — AI prediction engine
//
// Lightweight, fully on-device heuristic "AI" that scores each runner and
// assigns visual badges. No network / no heavy ML — designed to run instantly
// on low-end Android hardware and offline.
//
// Each horse is expected to expose (all optional, sane defaults applied):
//   number      : bib number
//   name        : string
//   odds        : decimal odds / cote (e.g. 4.5)  — lower = more favored
//   formScore   : 0..100 recent-form rating
//   chrono      : reduction kilométrique in seconds (lower = faster). Trot/plat.
//   winRate     : 0..1 historical win ratio
//   jockeyRating: 0..100
// ---------------------------------------------------------------------------

export const BADGES = {
  TOP: { key: 'TOP', label: '🔥 TOP PRONO', color: '#10b981' },
  VALUE: { key: 'VALUE', label: '⭐ VALUE BET', color: '#fbbf24' },
  CHRONO: { key: 'CHRONO', label: '⏱️ RECORD CHRONO', color: '#38bdf8' },
};

// Normalize odds into an implied-probability-ish 0..100 strength (lower odds -> higher).
function oddsStrength(odds) {
  if (!odds || odds <= 1) return 50;
  // implied prob = 1/odds; map ~[0.02..0.9] to 0..100
  const implied = 1 / odds;
  return Math.max(0, Math.min(100, implied * 110));
}

// Core blended AI score for a single horse (0..100).
export function computeAIScore(horse) {
  const form = clamp(num(horse.formScore, 50), 0, 100);
  const market = oddsStrength(num(horse.odds, 6));
  const win = clamp(num(horse.winRate, 0.15) * 100, 0, 100);
  const jockey = clamp(num(horse.jockeyRating, 60), 0, 100);

  // Weighted blend tuned to favor recent form + market confidence.
  const score = form * 0.4 + market * 0.3 + win * 0.18 + jockey * 0.12;
  return Math.round(score * 10) / 10;
}

// "Value" = strong AI score that the market under-rates (decent odds).
function computeValueIndex(horse, aiScore) {
  const odds = num(horse.odds, 6);
  // High AI score combined with non-favorite odds (>= 4.0) signals value.
  return aiScore * Math.log10(Math.max(1.1, odds));
}

// Analyze a whole race: returns a NEW race object whose horses are annotated
// with { aiScore, rank, valueIndex, badges:[] } and sorted by aiScore desc.
export function analyzeRace(race) {
  if (!race || !Array.isArray(race.horses)) {
    return { ...race, horses: [] };
  }

  // 1. Score every horse.
  const scored = race.horses.map((h) => {
    const aiScore = computeAIScore(h);
    return {
      ...h,
      aiScore,
      valueIndex: computeValueIndex(h, aiScore),
    };
  });

  // 2. Reference values for badge thresholds.
  const sortedByScore = [...scored].sort((a, b) => b.aiScore - a.aiScore);
  const topHorse = sortedByScore[0];

  const bestChrono = scored
    .filter((h) => num(h.chrono, 0) > 0)
    .reduce((min, h) => Math.min(min, h.chrono), Infinity);

  const bestValue = [...scored].sort((a, b) => b.valueIndex - a.valueIndex)[0];

  // 3. Assign badges and ranks.
  const annotated = sortedByScore.map((h, idx) => {
    const badges = [];

    // TOP PRONO: best AI score of the race.
    if (topHorse && h.number === topHorse.number) {
      badges.push(BADGES.TOP);
    }

    // VALUE BET: best value index, but only if it's a genuine outsider
    // (not the same as the top favorite) and odds are interesting.
    if (
      bestValue &&
      h.number === bestValue.number &&
      num(h.odds, 0) >= 4 &&
      (!topHorse || h.number !== topHorse.number)
    ) {
      badges.push(BADGES.VALUE);
    }

    // RECORD CHRONO: fastest reduction of the race.
    if (num(h.chrono, 0) > 0 && h.chrono === bestChrono) {
      badges.push(BADGES.CHRONO);
    }

    return { ...h, rank: idx + 1, badges };
  });

  return { ...race, horses: annotated };
}

// Convenience: top-N picks of a race (already analyzed or raw).
export function getTopPicks(race, n = 3) {
  const analyzed = race.horses?.[0]?.aiScore != null ? race : analyzeRace(race);
  return analyzed.horses.slice(0, n);
}

// Confidence label for a pick, used in UI.
export function confidenceLabel(aiScore) {
  if (aiScore >= 75) return 'Confiance élevée';
  if (aiScore >= 60) return 'Confiance moyenne';
  return 'À surveiller';
}

// --- tiny helpers ----------------------------------------------------------
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export default { analyzeRace, computeAIScore, getTopPicks, confidenceLabel, BADGES };
