const express = require('express');
const prisma = require('../db');

const router = express.Router();

function parseJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// GET /stats/success-rate — REAL measured hit rates from recorded Results.
// Backward-compatible shape { sampleSize, hits, rate } (rate = #1 pick placed,
// null until there's data so the app never shows a fabricated number), plus
// richer metrics: winRate (#1 pick won), podiumCoverage (avg count of our top-3
// picks inside the actual top 3), and the same rates over the last 30 days.
router.get('/success-rate', async (_req, res) => {
  const total = await prisma.result.count();
  const hits = await prisma.result.count({ where: { predicted: true } });
  const rate = total > 0 ? Math.round((hits / total) * 100) : null;

  // Detailed metrics over the most recent results (bounded scan).
  const recent = await prisma.result.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      race: { select: { date: true, predictions: { orderBy: { createdAt: 'desc' }, take: 1 } } },
    },
  });
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let winHits = 0;
  let podiumSum = 0;
  let scored = 0;
  let s30 = 0;
  let hits30 = 0;
  for (const r of recent) {
    const winners = parseJson(r.winners, []);
    const picks = parseJson(r.race.predictions[0]?.topPicks, []);
    if (!winners.length || !picks.length) continue;
    scored++;
    const top3 = winners.slice(0, 3).map(Number);
    if (Number(picks[0]?.number) === Number(winners[0])) winHits++;
    podiumSum += picks.slice(0, 3).filter((p) => top3.includes(Number(p.number))).length;
    if (r.race.date && r.race.date >= cutoff30) {
      s30++;
      if (r.predicted) hits30++;
    }
  }

  res.json({
    sampleSize: total,
    hits,
    rate,
    winRate: scored > 0 ? Math.round((winHits / scored) * 100) : null,
    podiumCoverage: scored > 0 ? Math.round((podiumSum / scored) * 100) / 100 : null,
    last30Days: {
      sampleSize: s30,
      rate: s30 > 0 ? Math.round((hits30 / s30) * 100) : null,
    },
  });
});

// GET /stats/ltr-readiness — combien de courses TERMINÉES avec des lignes Runner
// (= le jeu d'entraînement du LTR). Public. Sert à surveiller quand le modèle
// pourra être entraîné (seuil = 150).
router.get('/ltr-readiness', async (_req, res) => {
  const threshold = Number(process.env.PPM_MIN_COURSES || 100);
  const [finishedTotal, withRunners, ready] = await Promise.all([
    prisma.result.count(),
    prisma.race.count({ where: { runners: { some: {} } } }),
    prisma.race.count({ where: { result: { isNot: null }, runners: { some: {} } } }),
  ]);
  res.json({
    courses: ready,            // courses exploitables pour le LTR
    threshold,
    pct: Math.min(100, Math.round((ready / threshold) * 100)),
    ready: ready >= threshold, // true -> le workflow entraînera au prochain run
    finishedTotal,             // toutes arrivées enregistrées
    withRunners,               // courses avec données Runner (M1)
  });
});

module.exports = router;
