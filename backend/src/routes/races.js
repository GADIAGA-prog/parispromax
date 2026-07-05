const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../auth');
const { getAccess } = require('../services/subscription');

const router = express.Router();

function parse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// GET /races — list of today's (latest) races, grouped by track. Public.
router.get('/', async (req, res) => {
  const date = req.query.date;
  const where = date ? { date } : {};
  const races = await prisma.race.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Group by track, expose only public fields (no AI picks here).
  const byTrack = {};
  for (const r of races) {
    if (!byTrack[r.track]) {
      byTrack[r.track] = {
        id: r.track.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: r.track,
        condition: r.condition,
        discipline: r.discipline,
        races: [],
      };
    }
    const full = parse(r.raw, {});
    byTrack[r.track].races.push({
      id: r.externalId,
      number: full.number || '',
      name: r.name,
      distance: r.distance,
      time: full.time || '',
      runners: (full.horses || []).length,
    });
  }
  res.json({ racetracks: Object.values(byTrack) });
});

// GET /races/full — complete dataset (tracks -> races -> horses) in the app's
// schema, so the mobile app can render + compute AI locally. Public.
router.get('/full', async (req, res) => {
  let date = req.query.date;
  // No date specified -> use the most recent race date available (so a fresh
  // live scrape supersedes older/demo data instead of mixing with it).
  if (!date) {
    const latest = await prisma.race.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
    date = latest?.date;
  }
  const where = date ? { date } : {};
  const races = await prisma.race.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });

  const byTrack = {};
  for (const r of races) {
    const full = parse(r.raw, {});
    if (!byTrack[r.track]) {
      byTrack[r.track] = {
        id: r.track.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: r.track,
        condition: r.condition,
        discipline: r.discipline,
        prizePool: full.prizePool || null,
        races: [],
      };
    }
    byTrack[r.track].races.push({
      id: r.externalId,
      number: full.number || '',
      name: r.name,
      distance: r.distance,
      time: full.time || '',
      condition: r.condition,
      runners: (full.horses || []).length,
      horses: full.horses || [],
    });
  }

  res.json({
    meta: { source: 'backend', date: date || null },
    racetracks: Object.values(byTrack),
  });
});

// GET /races/history — finished races with our AI prediction + the actual
// arrival + whether our #1 pick placed (top 3). Public. Drives the app's
// History screen so users compare pronostic vs résultat.
router.get('/history', async (req, res) => {
  const results = await prisma.result.findMany({
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      race: { include: { predictions: { orderBy: { createdAt: 'desc' }, take: 1 } } },
    },
  });

  const history = results.map((r) => {
    const winners = parse(r.winners, []);
    const picks = parse(r.race.predictions[0]?.topPicks, []);
    return {
      id: r.id,
      track: r.race.track,
      race: r.race.name,
      date: r.race.date,
      winners, // finishing order [num, num, ...]
      topPicks: picks, // [{ number, name, aiScore, rank }]
      aiHit: r.predicted, // our #1 pick finished in the top 3
    };
  });

  res.json({ history });
});

// GET /races/:externalId/non-partants — live scratchings for a race, consumed
// by the Python ML daemon before it re-scores the field. Public (read-only).
// Returns { race_id, non_partants: [numbers] }.
router.get('/:externalId/non-partants', async (req, res) => {
  const race = await prisma.race.findUnique({
    where: { externalId: req.params.externalId },
    select: { nonPartants: true },
  });
  if (!race) return res.status(404).json({ error: 'Course introuvable' });
  const np = race.nonPartants ? parse(race.nonPartants, []) : [];
  res.json({ race_id: req.params.externalId, non_partants: Array.isArray(np) ? np : [] });
});

// GET /races/:externalId — race detail with runners (public, no AI scores).
router.get('/:externalId', async (req, res) => {
  const race = await prisma.race.findUnique({ where: { externalId: req.params.externalId } });
  if (!race) return res.status(404).json({ error: 'Course introuvable' });
  const full = parse(race.raw, {});
  res.json({
    id: race.externalId,
    track: race.track,
    name: race.name,
    condition: race.condition,
    distance: race.distance,
    horses: (full.horses || []).map((h) => ({
      number: h.number,
      name: h.name,
      jockey: h.jockey,
      odds: h.odds,
      form: h.form,
    })),
  });
});

// Map the LTR microservice output to the app's `topPicks` shape (unchanged
// contract: number/name/aiScore/rank + proba* — so the app needs no change).
function ltrToTopPicks(preds) {
  return (preds || [])
    .slice()
    .sort((a, b) => (a.rang_predit || 999) - (b.rang_predit || 999))
    .map((p) => ({
      number: p.number,
      name: p.name,
      aiScore: Math.round((Number(p.proba_win) || 0) * 1000) / 10,
      rank: p.rang_predit,
      probaGagnant: Number(p.proba_win) || 0,
      probaPodium: Number(p.proba_podium) || 0,
      valueBet: !!p.value_bet,
    }));
}

// GET /races/:externalId/prediction — AI top picks. GATED: requires an active
// subscription or trial. Serves the trained LTR model when the IA microservice
// is enabled (IA_URL), and falls back to the stored JS-engine predictions.
router.get('/:externalId/prediction', requireAuth, async (req, res) => {
  const access = await getAccess(req.userId);
  if (!access.hasAccess) {
    return res.status(402).json({ error: 'Abonnement requis', locked: true });
  }
  const race = await prisma.race.findUnique({
    where: { externalId: req.params.externalId },
    include: { predictions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!race) return res.status(404).json({ error: 'Pronostic indisponible' });

  // Prefer the trained LTR model (guarded: only when the IA service is wired).
  if (process.env.IA_URL) {
    try {
      const { getPredictions } = require('../services/iaClient');
      const ia = await getPredictions(req.params.externalId);
      if (ia && Array.isArray(ia.predictions) && ia.predictions.length) {
        return res.json({ raceId: race.externalId, source: 'ltr', topPicks: ltrToTopPicks(ia.predictions) });
      }
    } catch (e) {
      console.error('[prediction] IA fallback ->', e.message);
    }
  }

  // Fallback — stored JS-engine predictions.
  if (!race.predictions.length) {
    return res.status(404).json({ error: 'Pronostic indisponible' });
  }
  res.json({ raceId: race.externalId, source: 'js', topPicks: parse(race.predictions[0].topPicks, []) });
});

module.exports = router;
