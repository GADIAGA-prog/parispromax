const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPredictionSnapshot,
  preRacePredictionPicks,
} = require('../src/services/predictionSelection');

function picks(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    name: `Cheval ${index + 1}`,
    rank: index + 1,
    aiScore: 90 - index,
    odds: index === 7 ? 20 : 3 + index,
    probaPodium: 0.5 - index * 0.02,
  }));
}

test('fige podium + 2 pour une arrivée de trois chevaux', () => {
  const ranking = picks();
  ranking[0] = {
    ...ranking[0],
    predictionSource: 'ltr',
    modelVersion: 'ltr-2026-08',
  };
  const snapshot = buildPredictionSnapshot(ranking, { name: 'Prix test', raw: '{}' }, 3);

  assert.equal(snapshot.groups.format.places, 3);
  assert.equal(snapshot.groups.selectionSize, 5);
  assert.equal(snapshot.topPicks.length, 5);
  assert.equal(new Set(snapshot.topPicks.map((pick) => pick.number)).size, 5);
  assert.deepEqual(snapshot.predictionMeta, {
    source: 'ltr',
    modelVersion: 'ltr-2026-08',
  });
});

test('adapte podium + 2 au nombre de places de la course', () => {
  const snapshot = buildPredictionSnapshot(picks(), { name: 'Quinté du jour', raw: '{}' }, 5);

  assert.equal(snapshot.groups.format.places, 5);
  assert.equal(snapshot.groups.format.label, 'Podium + 2');
  assert.equal(snapshot.groups.format.raceLabel, 'Quinté');
  assert.equal(snapshot.groups.selectionSize, 7);
  assert.equal(snapshot.topPicks.length, 7);
  assert.deepEqual(snapshot.groups.couple.map((pick) => pick.number), [1, 2]);
});

test('publie six chevaux pour un Quarté', () => {
  const snapshot = buildPredictionSnapshot(picks(), { name: 'Quarté du jour', raw: '{}' }, 4);

  assert.equal(snapshot.groups.format.places, 4);
  assert.equal(snapshot.groups.selectionSize, 6);
  assert.equal(snapshot.topPicks.length, 6);
});

test('ECD et nationale gardent le meme classement et ne changent que sa longueur', () => {
  const ranking = picks();
  const race = { name: 'Course commune', raw: '{}' };
  const ecdTrio = buildPredictionSnapshot(ranking, race, 3);
  const nationalQuarte = buildPredictionSnapshot(ranking, race, 4);
  const nationalQuinte = buildPredictionSnapshot(ranking, race, 5);

  assert.deepEqual(ecdTrio.topPicks.map((pick) => pick.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(nationalQuarte.topPicks.map((pick) => pick.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(nationalQuinte.topPicks.map((pick) => pick.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(nationalQuinte.ranking.map((pick) => pick.number), ranking.map((pick) => pick.number));
});

test('un ECD a moins de huit partants publie Jumele + 2', () => {
  const snapshot = buildPredictionSnapshot(picks(), { name: 'ECD petit champ', raw: '{}' }, 2);

  assert.equal(snapshot.groups.format.places, 2);
  assert.equal(snapshot.groups.selectionSize, 4);
  assert.deepEqual(snapshot.topPicks.map((pick) => pick.number), [1, 2, 3, 4]);
});

test('fige la derniere prediction valide publiee avant le depart', () => {
  const row = (createdAt, topPicks) => ({ createdAt: new Date(createdAt), topPicks });
  const race = {
    date: '2026-08-04',
    raw: JSON.stringify({ time: '14:00' }),
    predictions: [
      row('2026-08-04T10:00:00Z', '[{"number":1,"rank":1}]'),
      row('2026-08-04T12:30:00Z', '[{"number":9,"rank":1}]'),
      row('2026-08-04T11:55:00Z', 'json-invalide'),
      row('2026-08-04T11:50:00Z', '[{"number":2,"rank":1}]'),
    ],
  };

  assert.deepEqual(preRacePredictionPicks(race).map((pick) => pick.number), [2]);
  assert.deepEqual(preRacePredictionPicks({ ...race, raw: '{}' }), []);
});
