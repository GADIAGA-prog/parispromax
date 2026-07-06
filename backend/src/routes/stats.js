const express = require('express');
const prisma = require('../db');

const router = express.Router();

// GET /stats/success-rate — REAL measured hit rate from recorded Results.
// "Hit" = our #1 AI pick finished among the actual placed runners.
// Returns { sampleSize, hits, rate } — rate is null until there's data, so the
// app never shows a fabricated number.
router.get('/success-rate', async (_req, res) => {
  const total = await prisma.result.count();
  const hits = await prisma.result.count({ where: { predicted: true } });
  const rate = total > 0 ? Math.round((hits / total) * 100) : null;
  res.json({ sampleSize: total, hits, rate });
});

// GET /stats/ltr-readiness — combien de courses TERMINÉES avec des lignes Runner
// (= le jeu d'entraînement du LTR). Public. Sert à surveiller quand le modèle
// pourra être entraîné (seuil = 150).
router.get('/ltr-readiness', async (_req, res) => {
  const threshold = Number(process.env.PPM_MIN_COURSES || 150);
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
