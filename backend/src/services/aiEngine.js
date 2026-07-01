// Server-side AI engine (mirror of app src/services/aiEngine.js).
// Race-level scoring that blends the signals we actually have from the source:
//   - recent form (musique -> formScore, recency-weighted upstream)
//   - class (career earnings "gains", normalized within the race)
//   - market confidence (odds, when published)
//   - jockey rating (when available)
// Weights adapt: if odds are published we trust the market more; otherwise the
// weight shifts to form + class.

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function oddsStrength(odds) {
  if (!odds || odds <= 1) return null; // unknown
  return clamp((1 / odds) * 110, 0, 100);
}

// Rank the runners of a race. Returns runners sorted by aiScore desc with rank.
function rankRunners(race) {
  if (!race || !Array.isArray(race.horses) || !race.horses.length) return [];
  const horses = race.horses;

  // Class score from gains, normalized within this race.
  const gains = horses.map((h) => num(h.gains, 0));
  const maxG = Math.max(...gains, 0);
  const minG = Math.min(...gains);
  const range = maxG - minG || 1;

  const anyOdds = horses.some((h) => num(h.odds, 0) > 1);

  const scored = horses.map((h) => {
    const form = clamp(num(h.formScore, 45), 0, 100);
    const classScore = maxG > 0 ? ((num(h.gains, 0) - minG) / range) * 100 : 50;
    const jockey = clamp(num(h.jockeyRating, 60), 0, 100);
    const market = oddsStrength(h.odds);

    let score;
    if (anyOdds && market != null) {
      score = form * 0.34 + market * 0.3 + classScore * 0.21 + jockey * 0.15;
    } else {
      // No market signal -> lean on form + class.
      score = form * 0.5 + classScore * 0.35 + jockey * 0.15;
    }
    return {
      number: h.number,
      name: h.name,
      aiScore: Math.round(score * 10) / 10,
      odds: h.odds ?? null,
    };
  });

  scored.sort((a, b) => b.aiScore - a.aiScore);
  return scored.map((h, i) => ({ ...h, rank: i + 1 }));
}

function computeAIScore(horse) {
  // Standalone (no race context) fallback.
  return rankRunners({ horses: [horse] })[0]?.aiScore ?? 0;
}

function topPicks(race, n = 5) {
  return rankRunners(race).slice(0, n);
}

module.exports = { computeAIScore, rankRunners, topPicks };
