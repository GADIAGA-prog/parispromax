'use strict';

const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../auth');
const { getAccess } = require('../services/subscription');
const { resolveCanonicalPrediction } = require('../services/predictionResolver');
const { buildDailyPublication } = require('../services/dailyPublication');
const { syncOfficialEcdProgram } = require('../services/ecdOfficialSource');

const router = express.Router();

// GET /publications/daily — complete daily sheet (national + official ECD).
// This is deliberately protected server-side: a hidden mobile or web view is
// not a security boundary for the published selections.
router.get('/daily', requireAuth, async (req, res) => {
  const access = await getAccess(req.userId);
  if (!access.hasAccess) {
    return res.status(403).json({ error: 'Un abonnement actif est requis pour cette publication.', locked: true });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { country: true },
  });
  const country = String(user?.country || '').trim().toLowerCase();
  if (!country) return res.status(400).json({ error: 'Pays du compte requis' });

  const date = String(req.query.date || '').trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Date invalide' });

  // The operator’s two meetings are synchronized before reading ECD picks so
  // the premium sheet follows the complete official programme (not a stale
  // manually selected subset). A temporary source failure leaves the last
  // verified programme available to subscribers.
  try {
    await syncOfficialEcdProgram(country, date);
  } catch (error) {
    console.warn(`[publication] programme ECD ${country}/${date}: ${error.message}`);
  }

  const [nationalPick, ecdPicks] = await Promise.all([
    prisma.nationalPick.findUnique({ where: { date_country: { date, country } } }),
    prisma.ecdPick.findMany({
      where: { date, country },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const races = await prisma.race.findMany({
    where: { date },
    include: {
      result: true,
      predictions: { orderBy: { createdAt: 'desc' }, take: 500 },
    },
  });
  if (!races.length) return res.status(404).json({ error: 'La publication du jour est en préparation.' });

  const publication = await buildDailyPublication({
    country,
    date,
    nationalPick,
    ecdPicks,
    racesById: new Map(races.map((race) => [race.externalId, race])),
    resolvePrediction: resolveCanonicalPrediction,
  });
  res.set('Cache-Control', 'private, no-store');
  return res.json(publication);
});

module.exports = router;
