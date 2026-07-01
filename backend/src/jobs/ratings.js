const prisma = require('../db');

// Computes real jockey/trainer performance ratings from recorded results.
// A "placed" run = the horse finished in the top 3 of a race we have a result
// for. Ratings use Bayesian shrinkage toward a neutral prior so a jockey with
// very few runs stays near neutral until enough evidence accumulates.

const PRIOR_RATE = 0.35; // ~ average top-3 rate
const PRIOR_N = 6; // pseudo-runs of prior weight

function bump(map, name, placed) {
  if (!name) return;
  const s = map.get(name) || { runs: 0, top3: 0 };
  s.runs += 1;
  if (placed) s.top3 += 1;
  map.set(name, s);
}

function ratingFrom(stat) {
  const top3 = stat ? stat.top3 : 0;
  const runs = stat ? stat.runs : 0;
  const rate = (top3 + PRIOR_RATE * PRIOR_N) / (runs + PRIOR_N);
  return Math.round(Math.max(0, Math.min(100, rate * 160)));
}

// Returns { jockey: Map(name->stat), trainer: Map(name->stat) }.
async function computeRatings() {
  const results = await prisma.result.findMany({ include: { race: true } });
  const jockey = new Map();
  const trainer = new Map();

  for (const res of results) {
    let winners;
    try {
      winners = JSON.parse(res.winners);
    } catch {
      continue;
    }
    const top3 = new Set(winners.slice(0, 3));
    let raw;
    try {
      raw = JSON.parse(res.race.raw);
    } catch {
      continue;
    }
    for (const h of raw.horses || []) {
      const placed = top3.has(h.number);
      bump(jockey, h.jockey, placed);
      bump(trainer, h.trainer, placed);
    }
  }
  return { jockey, trainer };
}

// Blended jockey+trainer rating (0-100) for a horse, given the maps.
function ratingForHorse(h, maps) {
  const jr = ratingFrom(maps.jockey.get(h.jockey));
  const tr = ratingFrom(maps.trainer.get(h.trainer));
  return Math.round(jr * 0.6 + tr * 0.4);
}

module.exports = { computeRatings, ratingForHorse, ratingFrom };
