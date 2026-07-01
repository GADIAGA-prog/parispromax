// Server-side AI engine (mirror of app src/services/aiEngine.js).
// Richer race-level scoring: form + consistency + recent-win + class + jockey +
// market. Weights adapt to whether odds are published.

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

function parseMusique(m) {
  const tokens = (m || '').match(/\d+|[A-Za-z]/g) || [];
  const placings = [];
  for (const t of tokens) {
    if (placings.length >= 6) break;
    if (/^\d+$/.test(t)) placings.push(parseInt(t, 10));
    else if (/^[DTAR]$/i.test(t)) placings.push(99);
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
function formMetrics(h) {
  const placings = parseMusique(h.form);
  if (!placings.length) {
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

function scoreOne(h, ctx) {
  const { form, consistency, recentWin } = formMetrics(h);
  const lg = Math.log10(Math.max(1, num(h.gains, 0)) + 1);
  const range = ctx.maxLG - ctx.minLG || 1;
  const classScore = ctx.maxLG > 0 ? clamp(((lg - ctx.minLG) / range) * 100, 0, 100) : 50;
  const connections = clamp(num(h.jockeyRating, 60), 0, 100);
  const market = oddsStrength(h.odds);
  let base;
  if (ctx.anyOdds && market != null) {
    base = form * 0.3 + market * 0.28 + consistency * 0.14 + classScore * 0.16 + connections * 0.12;
  } else {
    base = form * 0.4 + consistency * 0.2 + classScore * 0.22 + connections * 0.18;
  }
  return Math.round(clamp(base + recentWin, 0, 100) * 10) / 10;
}

function rankRunners(race) {
  if (!race || !Array.isArray(race.horses) || !race.horses.length) return [];
  const ctx = buildContext(race.horses);
  const scored = race.horses.map((h) => ({
    number: h.number,
    name: h.name,
    aiScore: scoreOne(h, ctx),
    odds: h.odds ?? null,
  }));
  scored.sort((a, b) => b.aiScore - a.aiScore);
  return scored.map((h, i) => ({ ...h, rank: i + 1 }));
}

function computeAIScore(horse) {
  return scoreOne(horse, buildContext([horse]));
}

function topPicks(race, n = 5) {
  return rankRunners(race).slice(0, n);
}

module.exports = { computeAIScore, rankRunners, topPicks };
