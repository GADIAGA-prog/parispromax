const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSuccessRate,
  buildContextualSuccessRate,
  evaluationPicks,
} = require('../src/services/successRate');

function prediction(numbers, createdAt) {
  return {
    createdAt: new Date(createdAt),
    topPicks: JSON.stringify(numbers.map((number, index) => ({ number, rank: index + 1 }))),
  };
}

function result(overrides = {}) {
  return {
    winners: '[2,4,7]',
    predictionSnapshot: null,
    race: {
      date: '2026-08-04',
      raw: JSON.stringify({ time: '14:00' }),
      predictions: [],
    },
    ...overrides,
  };
}

test('mesure le snapshot fige et ignore un classement mutable plus recent', () => {
  const row = result({
    predictionSnapshot: JSON.stringify({
      ranking: [{ number: 2, rank: 1 }, { number: 7, rank: 2 }],
    }),
    race: {
      date: '2026-08-04',
      raw: JSON.stringify({ time: '14:00' }),
      predictions: [prediction([9, 8], '2026-08-04T13:00:00.000Z')],
    },
  });

  assert.equal(evaluationPicks(row).source, 'snapshot');
  const stats = buildSuccessRate([row], { now: () => new Date('2026-08-05T00:00:00Z') });
  assert.deepEqual({ sampleSize: stats.sampleSize, hits: stats.hits, rate: stats.rate }, {
    sampleSize: 1,
    hits: 1,
    rate: 100,
  });
  assert.equal(stats.methodology.snapshots, 1);
});

test('sans snapshot, utilise uniquement la derniere prediction anterieure au depart', () => {
  const row = result();
  // 14h Paris en aout = 12h UTC.
  row.race.predictions = [
    prediction([9, 8], '2026-08-04T12:30:00.000Z'),
    prediction([2, 7], '2026-08-04T11:59:00.000Z'),
    prediction([4, 2], '2026-08-04T10:00:00.000Z'),
  ];

  const evaluation = evaluationPicks(row);
  assert.equal(evaluation.source, 'pre-race-prediction');
  assert.equal(evaluation.picks[0].number, 2);
  const stats = buildSuccessRate([row], { now: () => new Date('2026-08-05T00:00:00Z') });
  assert.equal(stats.rate, 100);
  assert.equal(stats.methodology.preRacePredictions, 1);
});

test('exclut du taux une course qui ne possede qu une prediction post-course', () => {
  const row = result();
  row.race.predictions = [prediction([2, 7], '2026-08-04T12:30:00.000Z')];
  const stats = buildSuccessRate([row], { now: () => new Date('2026-08-05T00:00:00Z') });

  assert.equal(stats.sampleSize, 0);
  assert.equal(stats.rate, null);
  assert.equal(stats.excluded, 1);
});

test('ne compte pas le troisieme comme place sur un ECD de moins de huit partants', () => {
  const row = result({
    predictionSnapshot: JSON.stringify({ ranking: [{ number: 7, rank: 1 }] }),
    race: {
      externalId: 'ecd-small',
      date: '2026-08-04',
      raw: JSON.stringify({
        time: '14:00',
        horses: Array.from({ length: 7 }, (_value, index) => ({ number: index + 1 })),
      }),
      nonPartants: '[]',
      context: 'ecd',
      isEcd: true,
      rulesVerified: true,
      podiumSize: 2,
      predictions: [],
    },
  });
  const stats = buildSuccessRate([row], { now: () => new Date('2026-08-05T00:00:00Z') });

  assert.equal(stats.sampleSize, 1);
  assert.equal(stats.hits, 0);
  assert.equal(stats.rate, 0);
  assert.equal(stats.methodology.smallFieldEcdSamples, 1);
});

test('utilise le podium explicite du jeu national', () => {
  const row = result({
    winners: '[2,4,7,9,5]',
    predictionSnapshot: JSON.stringify({ ranking: [{ number: 9, rank: 1 }] }),
    race: {
      externalId: 'national-quarte',
      date: '2026-08-04',
      raw: JSON.stringify({ time: '14:00' }),
      nonPartants: '[]',
      context: 'national',
      isEcd: false,
      podiumSize: 4,
      predictions: [],
    },
  });
  const stats = buildSuccessRate([row], { now: () => new Date('2026-08-05T00:00:00Z') });

  assert.equal(stats.rate, 100);
  assert.equal(stats.methodology.nationalSamples, 1);
  assert.equal(stats.methodology.ecdSamples, 0);
});

test('exclut un Quarté ou Quinté tant que l’arrivée attendue est incomplète', () => {
  const row = result({
    winners: '[2,4,7]',
    predictionSnapshot: JSON.stringify({ ranking: [{ number: 2, rank: 1 }] }),
    race: {
      externalId: 'national-quinte-incomplet',
      date: '2026-08-04',
      raw: JSON.stringify({ time: '14:00' }),
      context: 'national',
      isEcd: false,
      podiumSize: 5,
      predictions: [],
    },
  });

  const stats = buildSuccessRate([row], { now: () => new Date('2026-08-05T00:00:00Z') });
  assert.equal(stats.sampleSize, 0);
  assert.equal(stats.rate, null);
  assert.equal(stats.methodology.incompleteArrivals, 1);
});

test('publie des taux ECD et nationale separes en plus du resume global', () => {
  const snapshot = JSON.stringify({ ranking: [{ number: 4, rank: 1 }] });
  const ecd = result({
    winners: '[4,2,7]',
    predictionSnapshot: snapshot,
    race: {
      date: '2026-08-04',
      context: 'ecd',
      isEcd: true,
      rulesVerified: true,
      podiumSize: 3,
      raw: JSON.stringify({
        time: '14:00',
        horses: Array.from({ length: 8 }, (_value, index) => ({ number: index + 1 })),
      }),
      nonPartants: '[]',
      predictions: [],
    },
  });
  const national = result({
    winners: '[2,7,9,4]',
    predictionSnapshot: snapshot,
    race: {
      date: '2026-08-04',
      context: 'national',
      isEcd: false,
      podiumSize: 4,
      raw: JSON.stringify({ time: '14:00' }),
      predictions: [],
    },
  });

  const stats = buildContextualSuccessRate([ecd, national], {
    now: () => new Date('2026-08-05T00:00:00Z'),
  });

  assert.deepEqual(
    {
      global: [stats.sampleSize, stats.rate],
      ecd: [stats.byContext.ecd.sampleSize, stats.byContext.ecd.rate],
      national: [stats.byContext.national.sampleSize, stats.byContext.national.rate],
    },
    { global: [2, 100], ecd: [1, 100], national: [1, 100] }
  );
});

test('publie le taux par version de modele pour suivre son amelioration', () => {
  const versioned = result({
    predictionSnapshot: JSON.stringify({
      ranking: [{ number: 2, rank: 1 }],
      predictionMeta: { source: 'ltr', modelVersion: 'ltr-2026-08' },
    }),
  });
  const legacy = result({
    winners: '[4,7,9]',
    predictionSnapshot: JSON.stringify({
      ranking: [{ number: 2, rank: 1 }],
    }),
  });

  const stats = buildSuccessRate([versioned, legacy], {
    now: () => new Date('2026-08-05T00:00:00Z'),
  });

  assert.deepEqual(stats.byModel, [
    {
      source: 'ltr',
      modelVersion: 'ltr-2026-08',
      sampleSize: 1,
      hits: 1,
      rate: 100,
    },
    {
      source: 'legacy-unversioned',
      modelVersion: 'legacy-unversioned',
      sampleSize: 1,
      hits: 0,
      rate: 0,
    },
  ]);
});
