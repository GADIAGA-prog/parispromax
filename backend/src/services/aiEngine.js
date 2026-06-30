// Server-side AI engine (CommonJS mirror of the app's src/services/aiEngine.js).
// Scores runners and returns ranked top picks. Kept dependency-free.

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function oddsStrength(odds) {
  if (!odds || odds <= 1) return 50;
  return clamp((1 / odds) * 110, 0, 100);
}

function computeAIScore(horse) {
  const form = clamp(num(horse.formScore, 50), 0, 100);
  const market = oddsStrength(num(horse.odds, 6));
  const win = clamp(num(horse.winRate, 0.15) * 100, 0, 100);
  const jockey = clamp(num(horse.jockeyRating, 60), 0, 100);
  const score = form * 0.4 + market * 0.3 + win * 0.18 + jockey * 0.12;
  return Math.round(score * 10) / 10;
}

// Returns the race's runners ranked, each with aiScore + rank.
function rankRunners(race) {
  if (!race || !Array.isArray(race.horses)) return [];
  const scored = race.horses.map((h) => ({ ...h, aiScore: computeAIScore(h) }));
  scored.sort((a, b) => b.aiScore - a.aiScore);
  return scored.map((h, i) => ({
    number: h.number,
    name: h.name,
    aiScore: h.aiScore,
    odds: h.odds ?? null,
    rank: i + 1,
  }));
}

function topPicks(race, n = 5) {
  return rankRunners(race).slice(0, n);
}

module.exports = { computeAIScore, rankRunners, topPicks };
