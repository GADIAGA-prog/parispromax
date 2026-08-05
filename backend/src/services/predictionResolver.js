'use strict';

const prisma = require('../db');
const { rankRunners } = require('./aiEngine');

const inFlightResolutions = new Map();

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function runnerNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function raceContext(race) {
  return parseJson(race?.raw, {}) || {};
}

function nonPartantNumbers(race) {
  return new Set(
    parseJson(race?.nonPartants, [])
      .map(runnerNumber)
      .filter(Boolean)
  );
}

function activeHorses(race) {
  const full = raceContext(race);
  const nonPartants = nonPartantNumbers(race);
  const seen = new Set();
  return (Array.isArray(full.horses) ? full.horses : []).flatMap((horse) => {
    const number = runnerNumber(horse?.number);
    if (!number || nonPartants.has(number) || seen.has(number)) return [];
    seen.add(number);
    return [{ ...horse, number, name: String(horse?.name || `N\u00b0 ${number}`).trim() }];
  });
}

function sanitizePicks(values, race) {
  const picks = Array.isArray(values) ? values : [];
  const horses = activeHorses(race);
  const horseByNumber = new Map(horses.map((horse) => [horse.number, horse]));
  const knownNumbers = new Set(horseByNumber.keys());
  const excluded = nonPartantNumbers(race);
  const seen = new Set();

  return picks
    .map((pick, index) => ({ pick, index }))
    .sort((a, b) => {
      const rankA = Number(a.pick?.rank);
      const rankB = Number(b.pick?.rank);
      return (Number.isFinite(rankA) ? rankA : 9999) - (Number.isFinite(rankB) ? rankB : 9999)
        || a.index - b.index;
    })
    .flatMap(({ pick }) => {
      const number = runnerNumber(pick?.number);
      if (!number || excluded.has(number) || seen.has(number)) return [];
      if (knownNumbers.size && !knownNumbers.has(number)) return [];
      seen.add(number);
      const horse = horseByNumber.get(number);
      return [{
        ...pick,
        number,
        name: String(pick?.name || horse?.name || `N\u00b0 ${number}`).trim(),
      }];
    })
    .map((pick, index) => ({ ...pick, rank: index + 1 }));
}

function usableStoredPicks(race) {
  const row = race?.predictions?.[0];
  return sanitizePicks(parseJson(row?.topPicks, []), race);
}

function rankingSignature(picks) {
  const ranking = (picks || []).map((pick) => runnerNumber(pick?.number)).filter(Boolean).join(',');
  const first = picks?.[0] || {};
  return [ranking, first.predictionSource || '', first.modelVersion || ''].join('|');
}

function withPredictionMeta(picks, { source, modelVersion } = {}) {
  const normalizedSource = String(source || 'unknown').trim();
  const normalizedVersion = String(modelVersion || `${normalizedSource}-v1`).trim();
  return (picks || []).map((pick) => ({
    ...pick,
    predictionSource: normalizedSource,
    modelVersion: normalizedVersion,
  }));
}

function ltrToTopPicks(predictions) {
  return (predictions || [])
    .slice()
    .sort((a, b) => (Number(a.rang_predit) || 999) - (Number(b.rang_predit) || 999))
    .map((prediction, index) => ({
      number: prediction.number,
      name: prediction.name,
      aiScore: Math.round((Number(prediction.proba_win) || 0) * 1000) / 10,
      rank: Number(prediction.rang_predit) || index + 1,
      probaGagnant: Number(prediction.proba_win) || 0,
      probaPodium: Number(prediction.proba_podium) || 0,
      valueBet: Boolean(prediction.value_bet),
    }));
}

function rawFallbackRanking(race, rankRunnersFn = rankRunners) {
  const horses = activeHorses(race);
  if (!horses.length) return [];
  let ranked = [];
  try { ranked = sanitizePicks(rankRunnersFn({ ...raceContext(race), horses }), race); }
  catch { ranked = []; }
  const seen = new Set(ranked.map((pick) => pick.number));
  const missing = horses
    .filter((horse) => !seen.has(horse.number))
    .map((horse) => ({ number: horse.number, name: horse.name }));
  return [...ranked, ...missing].map((pick, index) => ({ ...pick, rank: index + 1 }));
}

function completeRanking(prefix, race, rankRunnersFn = rankRunners) {
  const canonicalPrefix = sanitizePicks(prefix, race);
  const seen = new Set(canonicalPrefix.map((pick) => pick.number));
  const complements = rawFallbackRanking(race, rankRunnersFn)
    .filter((pick) => !seen.has(pick.number));
  return [...canonicalPrefix, ...complements]
    .map((pick, index) => ({ ...pick, rank: index + 1 }));
}

async function persistIfChanged(race, picks, { db = prisma, logger = console } = {}) {
  const current = usableStoredPicks(race);
  const nextSignature = rankingSignature(picks);
  if (!nextSignature) return { persisted: false, created: false };
  if (rankingSignature(current) === nextSignature) {
    return { persisted: true, created: false };
  }

  try {
    await db.prediction.create({
      data: { raceId: race.id, topPicks: JSON.stringify(picks) },
    });
    return { persisted: true, created: true };
  } catch (error) {
    // The ranking can still be served during a transient write failure.
    logger.warn?.(`[prediction] classement non persiste ${race.externalId}: ${error.message}`);
    return { persisted: false, created: false };
  }
}

async function computeAndPersistFallback(race, {
  db = prisma,
  rankRunnersFn = rankRunners,
  logger = console,
} = {}) {
  const horses = activeHorses(race);
  if (!horses.length) {
    return { picks: [], source: 'unavailable', persisted: false };
  }

  const picks = withPredictionMeta(rawFallbackRanking(race, rankRunnersFn), {
    source: 'heuristic-fallback',
    modelVersion: process.env.PPM_HEURISTIC_VERSION || 'heuristic-v1',
  });
  if (!picks.length) {
    return { picks: [], source: 'unavailable', persisted: false };
  }

  const saved = await persistIfChanged(race, picks, { db, logger });
  return { picks, source: 'heuristic-fallback', persisted: saved.persisted };
}

async function resolveCanonicalPrediction(race, options = {}) {
  if (!race?.id) return { picks: [], source: 'unavailable', persisted: false };
  if (inFlightResolutions.has(race.id)) return inFlightResolutions.get(race.id);

  const task = (async () => {
    const logger = options.logger || console;
    const iaEnabled = options.iaEnabled ?? Boolean(process.env.IA_URL);
    if (iaEnabled && race.externalId) {
      try {
        const getPredictionsFn = options.getPredictionsFn
          || require('./iaClient').getPredictions;
        const response = await getPredictionsFn(race.externalId);
        const ltrPrefix = sanitizePicks(ltrToTopPicks(response?.predictions), race);
        const ranking = ltrPrefix.length
          ? completeRanking(ltrPrefix, race, options.rankRunnersFn || rankRunners)
          : [];
        const picks = withPredictionMeta(ranking, {
          source: 'ltr',
          modelVersion: response?.modelVersion
            || response?.model_version
            || process.env.IA_MODEL_VERSION
            || 'ltr-unversioned',
        });
        if (picks.length) {
          const saved = await persistIfChanged(race, picks, {
            db: options.db || prisma,
            logger,
          });
          return { picks, source: 'ltr', persisted: saved.persisted };
        }
      } catch (error) {
        logger.warn?.(`[prediction] IA indisponible ${race.externalId}: ${error.message}`);
      }
    }

    const stored = usableStoredPicks(race);
    if (stored.length) {
      const source = stored[0]?.predictionSource || 'stored-legacy';
      const modelVersion = stored[0]?.modelVersion || `${source}-unversioned`;
      const picks = withPredictionMeta(
        completeRanking(stored, race, options.rankRunnersFn || rankRunners),
        { source, modelVersion }
      );
      const saved = await persistIfChanged(race, picks, {
        db: options.db || prisma,
        logger,
      });
      return { picks, source: 'stored', persisted: saved.persisted };
    }
    return computeAndPersistFallback(race, options);
  })().finally(() => inFlightResolutions.delete(race.id));

  inFlightResolutions.set(race.id, task);
  return task;
}

const resolveStoredOrFallbackPrediction = resolveCanonicalPrediction;

module.exports = {
  activeHorses,
  sanitizePicks,
  usableStoredPicks,
  ltrToTopPicks,
  completeRanking,
  resolveCanonicalPrediction,
  resolveStoredOrFallbackPrediction,
  _test: {
    parseJson,
    runnerNumber,
    rankingSignature,
    withPredictionMeta,
    rawFallbackRanking,
    persistIfChanged,
    computeAndPersistFallback,
    inFlightResolutions,
  },
};
