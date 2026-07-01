const express = require('express');
const prisma = require('../db');
const config = require('../config');

// Endpoints for the Python Learning-to-Rank daemon (ml/). It pushes fresh
// predictions here every ~10 min; we persist them into the existing Prediction
// table (mapped to the app's topPicks shape) so the mobile app and the
// hit-detection logic keep working unchanged — the LTR model simply supersedes
// the JS heuristic aiEngine.
const router = express.Router();

// Bearer-token guard. The daemon sends `Authorization: Bearer <PPM_PUSH_TOKEN>`.
function requireMlToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!config.mlToken || token !== config.mlToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Map one race's ML runners -> the app's topPicks shape:
//   [{ number, name, aiScore, rank, probaGagnant, probaPodium }]
// aiScore stays a 0-100 number (P(win) %) so existing UI/sorting is unaffected;
// the extra proba* fields are additive and optional for richer display.
function toTopPicks(runners) {
  return (runners || [])
    .slice()
    .sort((a, b) => (a.rang_predit || 999) - (b.rang_predit || 999))
    .map((r) => ({
      number: r.numero ?? Number(r.cheval_id) ?? null,
      name: r.nom || '',
      aiScore: Math.round((Number(r.probabilite_gagnant) || 0) * 1000) / 10,
      rank: r.rang_predit,
      probaGagnant: Number(r.probabilite_gagnant) || 0,
      probaPodium: Number(r.probabilite_podium) || 0,
    }));
}

// POST /ml/predictions
// Body: { generated_at, races: [{ race_id, runners: [...] }] } (see
// ml/turf_pipeline/inference.py::to_android_payload).
router.post('/predictions', requireMlToken, async (req, res) => {
  const races = Array.isArray(req.body?.races) ? req.body.races : [];
  if (!races.length) return res.status(400).json({ error: 'races[] requis' });

  let stored = 0;
  let missing = 0;
  for (const race of races) {
    const externalId = race.race_id;
    if (!externalId) continue;
    const found = await prisma.race.findUnique({
      where: { externalId },
      select: { id: true },
    });
    if (!found) {
      missing++;
      continue;
    }
    const picks = toTopPicks(race.runners);
    await prisma.prediction.create({
      data: { raceId: found.id, topPicks: JSON.stringify(picks) },
    });
    stored++;
  }

  res.json({ ok: true, stored, missing, generatedAt: req.body?.generated_at || null });
});

module.exports = router;
