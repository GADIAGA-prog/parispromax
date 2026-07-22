const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPredictionSnapshot } = require('../src/services/predictionSelection');

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
  const snapshot = buildPredictionSnapshot(picks(), { name: 'Prix test', raw: '{}' }, 3);

  assert.equal(snapshot.groups.format.places, 3);
  assert.equal(snapshot.groups.selectionSize, 5);
  assert.equal(snapshot.topPicks.length, 5);
  assert.equal(new Set(snapshot.topPicks.map((pick) => pick.number)).size, 5);
});

test('garde podium + 2 même pour une course Quinté', () => {
  const snapshot = buildPredictionSnapshot(picks(), { name: 'Quinté du jour', raw: '{}' }, 5);

  assert.equal(snapshot.groups.format.places, 3);
  assert.equal(snapshot.groups.format.label, 'Podium + 2');
  assert.equal(snapshot.groups.format.raceLabel, 'Quinté');
  assert.equal(snapshot.groups.selectionSize, 5);
  assert.equal(snapshot.topPicks.length, 5);
  assert.deepEqual(snapshot.groups.couple.map((pick) => pick.number), [1, 2]);
});
