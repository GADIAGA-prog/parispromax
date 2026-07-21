const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../auth');
const { getAccess } = require('../services/subscription');
const { groupPicks: buildGroups } = require('../services/predictionSelection');

const router = express.Router();

function parse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// Convertit une date/heure hippique française en ISO UTC, indépendamment du
// fuseau du serveur Render. Cela garde les alertes mobiles exactes en Afrique.
function parisStartIso(date, time) {
  const match = String(time || '').match(/(\d{1,2})[:h](\d{2})/i);
  if (!date || !match) return null;
  const [year, month, day] = String(date).split('-').map(Number);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(guess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayedAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute)
  );
  return new Date(guess - (displayedAsUtc - guess)).toISOString();
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
      date: r.date,
      startsAt: parisStartIso(r.date, full.time),
      prize: full.prize ?? null,
      bets: full.bets || [],
      isQuinte: Boolean(full.isQuinte),
      type: full.type || r.discipline || null,
      autostart: Boolean(full.autostart),
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
  const races = await prisma.race.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 300, include: { result: true },
  });

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
      date: r.date,
      startsAt: parisStartIso(r.date, full.time),
      result: r.result ? { winners: parse(r.result.winners, []) } : null,
      prize: full.prize ?? null,
      bets: full.bets || [],
      isQuinte: Boolean(full.isQuinte),
      type: full.type || r.discipline || null,
      autostart: Boolean(full.autostart),
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

// GET /races/national?country=bf&date=YYYY-MM-DD — LA course support des paris
// PMU du pays (Quarté LONAB au Burkina, LONACI en CI…), désignée chaque jour
// depuis le back-office, + le journal hippique national à télécharger. Public.
router.get('/national', async (req, res) => {
  const country = String(req.query.country || '').trim().toLowerCase();
  if (!country) return res.status(400).json({ error: 'country requis' });
  let date = req.query.date;
  if (!date) {
    const latest = await prisma.race.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
    date = latest?.date || new Date().toISOString().slice(0, 10);
  }

  const pick = await prisma.nationalPick.findUnique({
    where: { date_country: { date, country } },
  });
  if (!pick) return res.json({ country, date, pick: null });

  const race = await prisma.race.findUnique({ where: { externalId: pick.externalId } });
  const full = race ? parse(race.raw, {}) : {};
  res.json({
    country,
    date,
    pick: {
      betType: pick.betType || 'Course du jour',
      journalUrl: pick.journalUrl || null,
      race: race
        ? {
            id: race.externalId,
            track: race.track,
            name: race.name,
            number: full.number || '',
            time: full.time || '',
            prize: full.prize ?? null,
            betType: pick.betType || 'Course du jour',
            bets: full.bets || [],
            isQuinte: Boolean(full.isQuinte),
            type: full.type || race.discipline || null,
            autostart: Boolean(full.autostart),
            distance: race.distance,
            discipline: race.discipline,
            runners: (full.horses || []).length,
          }
        : null,
    },
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
      race: { include: { predictions: { orderBy: { createdAt: 'desc' }, take: 50 } } },
    },
  });

  const history = results.map((r) => {
    const winners = parse(r.winners, []);
    const snapshot = parse(r.predictionSnapshot, null);
    // For legacy rows without a snapshot, use the prediction that existed
    // when the result was recorded instead of a later recalculation.
    const historicalPrediction = r.race.predictions.find(
      (prediction) => prediction.createdAt <= r.createdAt
    ) || r.race.predictions.at(-1);
    const picks = parse(historicalPrediction?.topPicks, []);
    const groups = snapshot?.groups || buildGroups(picks, r.race, Math.min(winners.length, 5));
    return {
      id: r.id,
      track: r.race.track,
      race: r.race.name,
      date: r.race.date,
      winners, // finishing order [num, num, ...]
      topPicks: snapshot?.topPicks || groups.selected, // pronostic figé = arrivée + 2
      groups,
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
// Exposes the full public data we hold on each runner so the app can display
// rich cards (trainer, career earnings, unshod status, odds trend…).
router.get('/:externalId', async (req, res) => {
  const race = await prisma.race.findUnique({
    where: { externalId: req.params.externalId },
    include: { result: true },
  });
  if (!race) return res.status(404).json({ error: 'Course introuvable' });
  const full = parse(race.raw, {});
  const nonPartants = race.nonPartants ? parse(race.nonPartants, []) : [];
  res.json({
    id: race.externalId,
    track: race.track,
    name: race.name,
    date: race.date,
    time: full.time || '',
    discipline: race.discipline,
    type: full.type || race.discipline || null, // Trot Attelé / Plat / Obstacle…
    autostart: Boolean(full.autostart),
    condition: race.condition,
    distance: race.distance,
    prize: full.prize ?? null, // allocation de la course (euros)
    prizePool: full.prizePool || null,
    nonPartants: Array.isArray(nonPartants) ? nonPartants : [],
    result: race.result ? { winners: parse(race.result.winners, []) } : null,
    horses: (full.horses || []).map((h) => ({
      number: h.number,
      name: h.name,
      jockey: h.jockey,
      trainer: h.trainer || null,
      odds: h.odds ?? null,
      coteOpen: h.coteOpen ?? null,
      form: h.form,
      gains: Number.isFinite(Number(h.gains)) ? Number(h.gains) : null,
      chrono: h.chrono ?? null,
      deferrage: h.deferrage || null,
      nonPartant: Array.isArray(nonPartants) && nonPartants.includes(Number(h.number)),
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
        const picks = ltrToTopPicks(ia.predictions);
        return res.json({ raceId: race.externalId, source: 'ltr', topPicks: picks, groups: buildGroups(picks, race) });
      }
    } catch (e) {
      console.error('[prediction] IA fallback ->', e.message);
    }
  }

  // Fallback — stored JS-engine predictions.
  if (!race.predictions.length) {
    return res.status(404).json({ error: 'Pronostic indisponible' });
  }
  const picks = parse(race.predictions[0].topPicks, []);
  res.json({ raceId: race.externalId, source: 'js', topPicks: picks, groups: buildGroups(picks, race) });
});

module.exports = router;
