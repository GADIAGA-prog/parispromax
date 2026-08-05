const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { _test } = require('../src/jobs/results');

function race(runners, nonPartants = []) {
  return {
    raw: JSON.stringify({
      horses: Array.from({ length: runners }, (_value, index) => ({ number: index + 1 })),
    }),
    nonPartants: JSON.stringify(nonPartants),
  };
}

test('demande cinq arrivants pour compléter un support Quarté ou Quinté', () => {
  assert.equal(_test.requiredArrivalLength(race(14)), 5);
  assert.equal(_test.requiredArrivalLength(race(8, [8])), 5);
});

test('respecte la taille réelle des champs de moins de cinq partants', () => {
  assert.equal(_test.requiredArrivalLength(race(4)), 4);
  assert.equal(_test.requiredArrivalLength(race(5, [5])), 4);
});

test('fusionne une arrivée complétée sans dupliquer les numéros', () => {
  assert.deepEqual(_test.uniqueWinnerNumbers([6, 1, 4, 6, '2']), [6, 1, 4, 2]);
});

test('un fetch ancien ne tronque jamais les quatrième et cinquième places déjà stockées', () => {
  assert.deepEqual(
    _test.mergeLatestArrival([6, 1, 4, 2, 9], [6, 1, 4]),
    [6, 1, 4, 2, 9]
  );
});

test('un fetch compatible peut compléter le préfixe relu dans la transaction', () => {
  assert.deepEqual(
    _test.mergeLatestArrival([6, 1, 4], [6, 1, 4, 2, 9]),
    [6, 1, 4, 2, 9]
  );
});

test('une arrivée contradictoire conserve la valeur la plus récente de la base', () => {
  assert.deepEqual(
    _test.mergeLatestArrival([6, 1, 4, 2, 9], [7, 3, 8, 5, 10]),
    [6, 1, 4, 2, 9]
  );
});

test('relit le Result dans la transaction avant de fusionner le fetch', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'jobs', 'results.js'),
    'utf8'
  );
  assert.match(
    source,
    /serializableTransaction\(prisma, async \(tx\)[\s\S]*tx\.result\.findUnique[\s\S]*mergeLatestArrival\(currentWinners, winners\)/
  );
  assert.match(source, /isComplete: mergedWinners\.length >= requiredWinners/);
});
