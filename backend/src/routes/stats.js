const express = require('express');
const prisma = require('../db');
const {
  activeRunnerCount,
  buildSuccessRate,
  buildContextualSuccessRate,
} = require('../services/successRate');
const { getNationalGame } = require('../../../shared/nationalGameRules');
const { getEcdProfile, ecdPredictionFormat } = require('../../../shared/ecdRules');
const { payoutRowsForCountry } = require('../../../shared/ecdTicketOutcome');

const router = express.Router();
const SUCCESS_RATE_LIMIT = 2000;
const SUCCESS_RATE_CACHE_MS = 15 * 1000;
const SUCCESS_RATE_PICK_LIMIT = SUCCESS_RATE_LIMIT;
const successRateCache = new Map();

// GET /stats/success-rate — REAL measured hit rates from recorded Results.
// Backward-compatible shape { sampleSize, hits, rate } (rate = #1 pick placed,
// null until there's data so the app never shows a fabricated number), plus
// richer metrics: winRate (#1 pick won), contextual podium coverage (Jumele for
// an ECD under eight active runners, Trio otherwise), and the last 30 days.
router.get('/success-rate', async (req, res) => {
  const country = String(req.query.country || 'bf').trim().toLowerCase();
  const ecdProfile = getEcdProfile(country);
  if (!ecdProfile) return res.status(400).json({ error: 'country invalide' });
  const cached = successRateCache.get(country);
  if (cached && Date.now() - cached.savedAt < SUCCESS_RATE_CACHE_MS) {
    return res.json(cached.value);
  }

  // Select the country's product contexts first. A global Result window made
  // one country's history depend on unrelated traffic and old backfills.
  const [ecdPicks, nationalPicks] = await Promise.all([
    prisma.ecdPick.findMany({
      where: { country },
      orderBy: { date: 'desc' },
      take: SUCCESS_RATE_PICK_LIMIT,
      select: { date: true, externalId: true },
    }),
    prisma.nationalPick.findMany({
      where: { country },
      orderBy: { date: 'desc' },
      take: SUCCESS_RATE_PICK_LIMIT,
      select: { date: true, externalId: true, betType: true },
    }),
  ]);
  const relevantExternalIds = [...new Set(
    [...ecdPicks, ...nationalPicks].map((pick) => pick.externalId).filter(Boolean)
  )];
  const results = relevantExternalIds.length
    ? await prisma.result.findMany({
        where: { race: { externalId: { in: relevantExternalIds } } },
        orderBy: [{ race: { date: 'desc' } }, { createdAt: 'desc' }],
        take: SUCCESS_RATE_LIMIT,
        include: {
          race: {
            select: {
              externalId: true,
              date: true,
              raw: true,
              nonPartants: true,
              predictions: { orderBy: { createdAt: 'desc' }, take: 50 },
            },
          },
        },
      })
    : [];
  const ecdIds = new Set(ecdPicks.map((pick) => `${pick.date}:${pick.externalId}`));
  const nationalById = new Map(
    nationalPicks.map((pick) => [`${pick.date}:${pick.externalId}`, pick.betType])
  );
  const contextExclusions = {
    unverifiedEcdRules: 0,
    unknownEcdRunnerCount: 0,
    unknownNationalGame: 0,
  };
  const contextualResults = results.flatMap((result) => {
    const identity = `${result.race.date}:${result.race.externalId}`;
    const contexts = [];
    if (ecdIds.has(identity)) {
      if (ecdProfile.verified) {
        const runnerCount = activeRunnerCount(result.race);
        let storedRows = [];
        try {
          storedRows = payoutRowsForCountry(JSON.parse(result.payouts || '[]'), country, 'bf', 'ecd');
        } catch {
          storedRows = [];
        }
        const storedPodium = Number(storedRows.find((row) => Number(row?.podium))?.podium);
        if (runnerCount > 0 || [2, 3].includes(storedPodium)) {
          const podiumSize = [2, 3].includes(storedPodium)
            ? storedPodium
            : ecdPredictionFormat(runnerCount).podium;
          contexts.push({
            ...result,
            race: {
              ...result.race,
              context: 'ecd',
              isEcd: true,
              rulesVerified: true,
              podiumSize,
            },
          });
        } else {
          contextExclusions.unknownEcdRunnerCount++;
        }
      } else {
        contextExclusions.unverifiedEcdRules++;
      }
    }
    if (nationalById.has(identity)) {
      const game = getNationalGame(country, result.race.date, {
        betType: nationalById.get(identity),
      });
      const podiumSize = Number(game?.podium);
      if (game?.verified && Number.isInteger(podiumSize) && podiumSize > 0) {
        contexts.push({
          ...result,
          race: {
            ...result.race,
            context: 'national',
            isEcd: false,
            podiumSize,
          },
        });
      } else {
        contextExclusions.unknownNationalGame++;
      }
    }
    return contexts;
  });
  const measuredContexts = contextualResults.filter(
    (result) => buildSuccessRate([result]).sampleSize === 1
  );
  const uniqueRaceSampleSize = new Set(
    measuredContexts.map((result) => result?.race?.externalId).filter(Boolean)
  ).size;
  const contextsByRace = new Map();
  measuredContexts.forEach((result) => {
    const identity = `${result.race.date}:${result.race.externalId}`;
    if (!contextsByRace.has(identity)) contextsByRace.set(identity, new Set());
    contextsByRace.get(identity).add(result.race.context);
  });
  const hybridSampleSize = [...contextsByRace.values()].filter((contexts) => contexts.size > 1).length;
  const sampleDates = measuredContexts.map((result) => result.race.date).filter(Boolean).sort();
  const rates = buildContextualSuccessRate(contextualResults);
  const value = {
    country,
    ...rates,
    contextExclusions,
    window: {
      sourceResults: results.length,
      contextualCandidates: contextualResults.length,
      contextualResults: measuredContexts.length,
      uniqueRaceSampleSize,
      hybridSampleSize,
      dateFrom: sampleDates[0] || null,
      dateTo: sampleDates.at(-1) || null,
      resultLimit: SUCCESS_RATE_LIMIT,
      truncated: results.length === SUCCESS_RATE_LIMIT
        || ecdPicks.length === SUCCESS_RATE_PICK_LIMIT
        || nationalPicks.length === SUCCESS_RATE_PICK_LIMIT,
    },
  };
  successRateCache.set(country, { savedAt: Date.now(), value });
  return res.json(value);
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
module.exports._test = {
  successRateCache,
  SUCCESS_RATE_LIMIT,
  SUCCESS_RATE_CACHE_MS,
  SUCCESS_RATE_PICK_LIMIT,
};
