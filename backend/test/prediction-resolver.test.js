const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activeHorses,
  resolveCanonicalPrediction,
} = require('../src/services/predictionResolver');

function race(overrides = {}) {
  return {
    id: 'race-db-1',
    externalId: 'pmu-r1-c1',
    nonPartants: '[4]',
    raw: JSON.stringify({
      horses: [
        { number: 1, name: 'Un', odds: 3 },
        { number: 2, name: 'Deux', odds: 5 },
        { number: 3, name: '', odds: 8 },
        { number: 4, name: 'NP', odds: 2 },
        { number: 2, name: 'Doublon', odds: 6 },
      ],
    }),
    predictions: [{ topPicks: '[]' }],
    ...overrides,
  };
}

test('calcule et persiste un pronostic de repli depuis les partants actifs', async () => {
  const saved = [];
  const currentRace = race();
  assert.deepEqual(activeHorses(currentRace).map((horse) => horse.number), [1, 2, 3]);

  const result = await resolveCanonicalPrediction(currentRace, {
    iaEnabled: false,
    db: { prediction: { create: async (query) => saved.push(query.data) } },
    rankRunnersFn: ({ horses }) => horses.slice().reverse().map((horse, index) => ({
      number: horse.number,
      name: horse.name,
      rank: index + 1,
      aiScore: 80 - index,
    })),
  });

  assert.equal(result.source, 'heuristic-fallback');
  assert.deepEqual(result.picks.map((pick) => pick.number), [3, 2, 1]);
  assert.equal(saved.length, 1);
  assert.deepEqual(JSON.parse(saved[0].topPicks).map((pick) => pick.number), [3, 2, 1]);
});

test('prefere le LTR et versionne une Prediction legacy au classement identique', async () => {
  let creates = 0;
  const currentRace = race({
    predictions: [{ topPicks: JSON.stringify([
      { number: 2, name: 'Deux', rank: 1 },
      { number: 1, name: 'Un', rank: 2 },
      { number: 3, name: 'Trois', rank: 3 },
    ]) }],
  });

  const result = await resolveCanonicalPrediction(currentRace, {
    iaEnabled: true,
    getPredictionsFn: async () => ({ model_version: 'ltr-2026-08', predictions: [
      { number: 2, name: 'Deux', rang_predit: 1, proba_win: 0.6, proba_podium: 0.8 },
      { number: 1, name: 'Un', rang_predit: 2, proba_win: 0.3, proba_podium: 0.7 },
      { number: 3, name: 'Trois', rang_predit: 3, proba_win: 0.1, proba_podium: 0.4 },
    ] }),
    db: { prediction: { create: async () => { creates += 1; } } },
  });

  assert.equal(result.source, 'ltr');
  assert.deepEqual(result.picks.map((pick) => pick.number), [2, 1, 3]);
  assert.equal(result.picks[0].predictionSource, 'ltr');
  assert.equal(result.picks[0].modelVersion, 'ltr-2026-08');
  assert.equal(creates, 1);
});

test('retombe sur le dernier classement stocke quand le service LTR echoue', async () => {
  const warnings = [];
  const saved = [];
  const currentRace = race({
    predictions: [{ topPicks: JSON.stringify([
      { number: 1, name: 'Un', rank: 1 },
      { number: 2, name: 'Deux', rank: 2 },
      { number: 3, name: 'Trois', rank: 3 },
    ]) }],
  });
  const result = await resolveCanonicalPrediction(currentRace, {
    iaEnabled: true,
    getPredictionsFn: async () => { throw new Error('hors ligne'); },
    logger: { warn: (message) => warnings.push(message) },
    db: { prediction: { create: async (query) => saved.push(query.data) } },
  });

  assert.equal(result.source, 'stored');
  assert.deepEqual(result.picks.map((pick) => pick.number), [1, 2, 3]);
  assert.equal(warnings.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(result.picks[0].predictionSource, 'stored-legacy');
  assert.equal(result.picks[0].modelVersion, 'stored-legacy-unversioned');
});

test('complete un ancien classement tronque sans modifier son prefixe', async () => {
  const horses = Array.from({ length: 8 }, (_value, index) => ({
    number: index + 1,
    name: `Cheval ${index + 1}`,
    odds: index + 2,
  }));
  const saved = [];
  const currentRace = race({
    nonPartants: '[]',
    raw: JSON.stringify({ horses }),
    predictions: [{ topPicks: JSON.stringify([
      { number: 5, name: 'Cheval 5', rank: 1 },
      { number: 2, name: 'Cheval 2', rank: 2 },
      { number: 7, name: 'Cheval 7', rank: 3 },
    ]) }],
  });
  const result = await resolveCanonicalPrediction(currentRace, {
    iaEnabled: false,
    rankRunnersFn: ({ horses: values }) => values.slice().reverse().map((horse, index) => ({
      ...horse,
      rank: index + 1,
    })),
    db: { prediction: { create: async (query) => saved.push(query.data) } },
  });

  assert.deepEqual(result.picks.slice(0, 3).map((pick) => pick.number), [5, 2, 7]);
  assert.equal(result.picks.length, 8);
  assert.equal(saved.length, 1);
});
