// Server-side AI engine (mirror of app src/services/aiEngine.js).
// Richer race-level scoring: form + consistency + recent-win + class + jockey +
// market + odds trend. Weights adapt to whether odds are published. Scores are
// converted into per-race win probabilities (softmax blended with the market)
// and podium probabilities (Harville), with value-bet detection.

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

// Parse a "musique" string into recent placings, most recent first.
//  - digits 1-9 = placing; 0 = finished unplaced (10th+), coded 10
//  - D/T/A/R = incident (disqualified, fell, stopped, demoted), coded 99
//  - "(24)" year markers are ignored; discipline letters (a,m,p,h,s,o,c) too.
function parseMusique(m) {
  const s = String(m || '').replace(/\(\s*\d{2}\s*\)/g, ' ');
  const tokens = s.match(/\d|[A-Za-z]/g) || [];
  const placings = [];
  for (const t of tokens) {
    if (placings.length >= 6) break;
    if (/^\d$/.test(t)) placings.push(t === '0' ? 10 : parseInt(t, 10));
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
  if (p >= 6 && p <= 9) return 32;
  if (p === 10) return 20; // "0" dans la musique : arrivé au-delà de la 9e place
  return 12; // incident (D/T/A/R)
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

// Market move: a horse backed in (odds shortening vs opening) is a live one.
// Returns a small additive bonus/malus in score points.
function oddsTrendBonus(h) {
  const open = num(h.coteOpen, null);
  const cur = num(h.odds ?? h.coteFloat, null);
  if (!open || !cur || open <= 1 || cur <= 1) return 0;
  const drift = (cur - open) / open; // <0 = steamer, >0 = drifter
  return clamp(-drift * 10, -4, 4);
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
  return Math.round(clamp(base + recentWin + oddsTrendBonus(h), 0, 100) * 10) / 10;
}

// ---- Probabilities --------------------------------------------------------

// Softmax over 0-100 scores. T=12 keeps a sensible spread for typical fields.
function softmax(scores, temperature = 12) {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

// Implied market probabilities with the overround stripped (null if no odds).
function marketProbs(horses) {
  const inv = horses.map((h) => {
    const o = num(h.odds, null);
    return o && o > 1 ? 1 / o : null;
  });
  const known = inv.filter((v) => v != null);
  if (known.length < Math.max(2, horses.length / 2)) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  const filled = inv.map((v) => (v != null ? v : avg * 0.6)); // missing = outsider-ish
  const sum = filled.reduce((a, b) => a + b, 0) || 1;
  return filled.map((v) => v / sum);
}

// Exact Harville top-3 probability from win probabilities. O(n^3), n<=40.
function harvillePodium(p) {
  const n = p.length;
  if (n <= 3) return p.map(() => 1);
  const q = p.map((v) => Math.max(v, 1e-9));
  const total = q.reduce((a, b) => a + b, 0);
  const w = q.map((v) => v / total);
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

const MODEL_WEIGHT = 0.6; // blend: 60% modèle, 40% marché (quand cotes publiées)
const VALUE_EDGE = 0.03;
const VALUE_MIN_ODDS = 2.0;
const VALUE_MIN_PROBA = 0.05;

function rankRunners(race) {
  if (!race || !Array.isArray(race.horses) || !race.horses.length) return [];
  const ctx = buildContext(race.horses);
  const scores = race.horses.map((h) => scoreOne(h, ctx));
  const modelP = softmax(scores);
  const market = marketProbs(race.horses);

  // Calibration pragmatique : mélange modèle/marché quand les cotes existent.
  let winP;
  if (market) {
    const blended = modelP.map((p, i) => MODEL_WEIGHT * p + (1 - MODEL_WEIGHT) * market[i]);
    const sum = blended.reduce((a, b) => a + b, 0) || 1;
    winP = blended.map((p) => p / sum);
  } else {
    winP = modelP;
  }
  const podiumP = harvillePodium(winP);

  const scored = race.horses.map((h, i) => {
    const odds = h.odds ?? null;
    const edge = market ? modelP[i] - market[i] : 0;
    return {
      number: h.number,
      name: h.name,
      aiScore: scores[i],
      odds,
      probaGagnant: Math.round(winP[i] * 1000) / 1000,
      probaPodium: Math.round(podiumP[i] * 1000) / 1000,
      valueBet: Boolean(
        market &&
          edge > VALUE_EDGE &&
          num(odds, 0) >= VALUE_MIN_ODDS &&
          modelP[i] >= VALUE_MIN_PROBA
      ),
    };
  });
  scored.sort((a, b) => b.probaGagnant - a.probaGagnant || b.aiScore - a.aiScore);
  return scored.map((h, i) => ({ ...h, rank: i + 1 }));
}

function computeAIScore(horse) {
  return scoreOne(horse, buildContext([horse]));
}

function topPicks(race, n = 5) {
  return rankRunners(race).slice(0, n);
}

module.exports = { computeAIScore, rankRunners, topPicks, parseMusique };
