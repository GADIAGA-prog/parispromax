const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ecdPodiumSize,
  ecdPredictionFormat,
} = require('../../shared/ecdRules');

test('un ECD de moins de huit partants est un Jumele + 2', () => {
  assert.equal(ecdPodiumSize(7), 2);
  assert.deepEqual(ecdPredictionFormat(7), {
    label: 'Jumelé ordre',
    podium: 2,
    selectionSize: 4,
    minimumRunnersForTrio: 8,
  });
});

test('un ECD de huit partants ou plus est un Trio + 2', () => {
  assert.equal(ecdPodiumSize(8), 3);
  assert.equal(ecdPredictionFormat(14).selectionSize, 5);
});

test('un nombre de partants inconnu ne devient jamais un petit champ', () => {
  assert.equal(ecdPodiumSize(0), 3);
  assert.equal(ecdPodiumSize(null), 3);
  assert.equal(ecdPodiumSize(undefined), 3);
  assert.equal(ecdPodiumSize('inconnu'), 3);
});
