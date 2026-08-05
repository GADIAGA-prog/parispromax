'use strict';

const { ecdPodiumSize } = require('../../../shared/ecdRules');
const { preRacePredictionPicks } = require('./predictionSelection');

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizedPicks(value) {
  return (Array.isArray(value) ? value : [])
    .filter((pick) => pick && Number.isFinite(Number(pick.number)))
    .slice()
    .sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999));
}

function uniqueRunnerNumbers(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const number = Number(value?.number ?? value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) return [];
    seen.add(number);
    return [number];
  });
}

function activeRunnerCount(race) {
  const full = parseJson(race?.raw, {});
  const excluded = new Set(uniqueRunnerNumbers(parseJson(race?.nonPartants, [])));
  return uniqueRunnerNumbers(full?.horses || []).filter((number) => !excluded.has(number)).length;
}

function resultPodiumSize(result, winners) {
  const explicit = Number(result?.race?.podiumSize);
  if (Number.isInteger(explicit) && explicit > 0) {
    return explicit;
  }
  if (result?.race?.context === 'ecd' || result?.race?.context === 'national') return null;
  if (result?.race?.isEcd && result?.race?.rulesVerified === true) {
    return ecdPodiumSize(activeRunnerCount(result.race));
  }
  return Math.max(1, Math.min(3, winners.length));
}

function snapshotPicks(result) {
  const snapshot = parseJson(result?.predictionSnapshot, null);
  if (!snapshot || typeof snapshot !== 'object') return [];
  return normalizedPicks(
    snapshot.ranking || snapshot.topPicks || snapshot.groups?.selected || []
  );
}

function preRacePicks(result) {
  return normalizedPicks(preRacePredictionPicks(result?.race));
}

function evaluationPicks(result) {
  const snapshot = parseJson(result?.predictionSnapshot, null);
  const frozen = snapshotPicks(result);
  const picks = frozen.length ? frozen : preRacePicks(result);
  const first = picks[0] || {};
  return {
    picks,
    source: frozen.length ? 'snapshot' : 'pre-race-prediction',
    predictionSource: snapshot?.predictionMeta?.source
      || first.predictionSource
      || 'legacy-unversioned',
    modelVersion: snapshot?.predictionMeta?.modelVersion
      || first.modelVersion
      || 'legacy-unversioned',
  };
}

function percentage(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function buildSuccessRate(results, { now = () => new Date() } = {}) {
  const cutoff = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let sampleSize = 0;
  let hits = 0;
  let wins = 0;
  let podiumSum = 0;
  let sample30 = 0;
  let hits30 = 0;
  let snapshotSamples = 0;
  let smallFieldEcdSamples = 0;
  let ecdSamples = 0;
  let nationalSamples = 0;
  let incompleteArrivals = 0;
  let unknownPodiums = 0;
  const models = new Map();

  for (const result of results || []) {
    const winners = parseJson(result.winners, []).map(Number).filter(Number.isFinite);
    const evaluation = evaluationPicks(result);
    const picks = evaluation.picks;
    if (!winners.length || !picks.length) continue;

    const podiumSize = resultPodiumSize(result, winners);
    if (!Number.isInteger(podiumSize) || podiumSize <= 0) {
      unknownPodiums++;
      continue;
    }
    if (winners.length < podiumSize) {
      incompleteArrivals++;
      continue;
    }

    sampleSize++;
    if (evaluation.source === 'snapshot') snapshotSamples++;
    if (result.race?.context === 'ecd' || result.race?.isEcd) {
      ecdSamples++;
      if (podiumSize === 2) smallFieldEcdSamples++;
    }
    if (result.race?.context === 'national') nationalSamples++;
    const podium = winners.slice(0, podiumSize);
    const topNumber = Number(picks[0].number);
    const placed = podium.includes(topNumber);
    if (placed) hits++;
    if (topNumber === winners[0]) wins++;
    const uniquePicks = [...new Set(picks.slice(0, podiumSize).map((pick) => Number(pick.number)))];
    podiumSum += uniquePicks.filter((number) => podium.includes(number)).length;
    const modelKey = `${evaluation.predictionSource}:${evaluation.modelVersion}`;
    const model = models.get(modelKey) || {
      source: evaluation.predictionSource,
      modelVersion: evaluation.modelVersion,
      sampleSize: 0,
      hits: 0,
    };
    model.sampleSize++;
    if (placed) model.hits++;
    models.set(modelKey, model);

    if (result.race?.date && result.race.date >= cutoff) {
      sample30++;
      if (placed) hits30++;
    }
  }

  const totalRecords = (results || []).length;
  return {
    sampleSize,
    hits,
    rate: percentage(hits, sampleSize),
    winRate: percentage(wins, sampleSize),
    podiumCoverage: sampleSize > 0 ? Math.round((podiumSum / sampleSize) * 100) / 100 : null,
    last30Days: { sampleSize: sample30, rate: percentage(hits30, sample30) },
    excluded: Math.max(0, totalRecords - sampleSize),
    byModel: [...models.values()].map((model) => ({
      ...model,
      rate: percentage(model.hits, model.sampleSize),
    })),
    methodology: {
      metric: 'base-placee-podium-contextuel',
      snapshots: snapshotSamples,
      preRacePredictions: sampleSize - snapshotSamples,
      smallFieldEcdSamples,
      ecdSamples,
      nationalSamples,
      incompleteArrivals,
      unknownPodiums,
      mutableLatestExcluded: true,
    },
  };
}

// Keep the historical top-level contract while also exposing the two product
// contexts independently. A hybrid race deliberately contributes once to ECD
// and once to the national game because the applicable podium is different.
function buildContextualSuccessRate(results, options = {}) {
  const rows = Array.isArray(results) ? results : [];
  const ecdRows = rows.filter((result) => result?.race?.context === 'ecd');
  const nationalRows = rows.filter((result) => result?.race?.context === 'national');
  return {
    ...buildSuccessRate(rows, options),
    byContext: {
      ecd: buildSuccessRate(ecdRows, options),
      national: buildSuccessRate(nationalRows, options),
    },
  };
}

module.exports = {
  activeRunnerCount,
  buildSuccessRate,
  buildContextualSuccessRate,
  evaluationPicks,
  _test: {
    parseJson,
    normalizedPicks,
    uniqueRunnerNumbers,
    activeRunnerCount,
    resultPodiumSize,
    snapshotPicks,
    preRacePicks,
    percentage,
  },
};
