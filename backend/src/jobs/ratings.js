const prisma = require('../db');

// Computes real jockey/trainer performance ratings from recorded results.
// A "placed" run = the horse finished in the top 3 of a race we have a result
// for. Ratings use Bayesian shrinkage toward a neutral prior so a jockey with
// very few runs stays near neutral until enough evidence accumulates.

const PRIOR_RATE = 0.35; // ~ average top-3 rate
const PRIOR_N = 6; // pseudo-runs of prior weight
const HALF_LIFE_DAYS = 120; // recency decay: a run 120 days old weighs 0.5

// Recency weight for a race date (YYYY-MM-DD); unknown dates count fully.
function decayWeight(dateStr) {
  const t = Date.parse(dateStr || '');
  if (!Number.isFinite(t)) return 1;
  const ageDays = Math.max(0, (Date.now() - t) / (24 * 60 * 60 * 1000));
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function bump(map, name, { placed, won, weight }) {
  if (!name) return;
  const s = map.get(name) || { runs: 0, top3: 0, wRuns: 0, wTop3: 0, wWins: 0 };
  s.runs += 1;
  if (placed) s.top3 += 1;
  s.wRuns += weight;
  if (placed) s.wTop3 += weight;
  if (won) s.wWins += weight;
  map.set(name, s);
}

// Bayesian-shrunk, recency-weighted rating. Blends the top-3 rate with the win
// rate (a jockey who wins outright is worth more than one who scrapes 3rds).
function ratingFrom(stat) {
  const wRuns = stat ? (stat.wRuns ?? stat.runs) : 0;
  const wTop3 = stat ? (stat.wTop3 ?? stat.top3) : 0;
  const wWins = stat ? stat.wWins || 0 : 0;
  const top3Rate = (wTop3 + PRIOR_RATE * PRIOR_N) / (wRuns + PRIOR_N);
  const winRate = (wWins + (PRIOR_RATE / 3) * PRIOR_N) / (wRuns + PRIOR_N);
  const blended = top3Rate * 0.7 + winRate * 3 * 0.3; // winRate ~ top3Rate/3 scale
  return Math.round(Math.max(0, Math.min(100, blended * 160)));
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
    const winner = winners[0];
    let raw;
    try {
      raw = JSON.parse(res.race.raw);
    } catch {
      continue;
    }
    const weight = decayWeight(res.race.date);
    for (const h of raw.horses || []) {
      const perf = { placed: top3.has(h.number), won: h.number === winner, weight };
      bump(jockey, h.jockey, perf);
      bump(trainer, h.trainer, perf);
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

// M1/M2 bridge — persist the computed jockey/trainer stats into ActorStat so the
// Python LTR pipeline and the imputation layer can read them from the DB.
async function syncActorStats(maps) {
  const prisma = require('../db');
  for (const kind of ['jockey', 'trainer']) {
    for (const [name, stat] of maps[kind]) {
      if (!name || String(name).trim().length < 2) continue;
      const rating = ratingFrom(stat);
      await prisma.actorStat.upsert({
        where: { kind_name: { kind, name } },
        update: { runs: stat.runs, top3: stat.top3, rating },
        create: { kind, name, runs: stat.runs, top3: stat.top3, rating },
      });
    }
  }
}

module.exports = { computeRatings, ratingForHorse, ratingFrom, syncActorStats };
