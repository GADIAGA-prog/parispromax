const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyPublication } = require('../src/services/dailyPublication');

function race({ id, number, result = null }) {
  return {
    id,
    externalId: id,
    track: 'Hippodrome test',
    name: `Prix ${number}`,
    date: '2026-09-24',
    distance: '2 400 m',
    raw: JSON.stringify({
      number,
      time: '14:30',
      type: 'Plat',
      horses: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, name: `Cheval ${index + 1}` })),
    }),
    nonPartants: '[]',
    result,
    predictions: [{ createdAt: new Date('2026-09-24T10:00:00Z'), topPicks: JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ number: i + 1, rank: i + 1 }))) }],
  };
}

const resolver = async () => ({
  picks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, name: `Cheval ${index + 1}`, rank: index + 1 })),
});

test('la publication premium joint programme, Podium + 2 et arrivée officielle', async () => {
  const nationalRace = race({ id: 'national', number: 'R1C1', result: { winners: '[4,7,1]' } });
  const ecdRace = race({ id: 'ecd', number: 'R2C3' });
  const publication = await buildDailyPublication({
    country: 'bf',
    date: '2026-09-24',
    nationalPick: { externalId: 'national', betType: 'Quarté', journalUrl: null },
    ecdPicks: [{ externalId: 'ecd', priority: 1, journalUrl: null }],
    racesById: new Map([['national', nationalRace], ['ecd', ecdRace]]),
    resolvePrediction: resolver,
  });

  assert.equal(publication.national.race.result.available, true);
  assert.deepEqual(publication.national.race.result.arrival, [4, 7, 1]);
  assert.equal(publication.national.selection.length, publication.national.selectionSize);
  assert.equal(publication.ecd.length, 1);
  assert.equal(publication.ecd[0].label, 'Trio');
  assert.equal(publication.ecd[0].selection.length, 5);
  assert.equal(publication.resultsAvailable, 1);
});

test('une arrivée fige la sélection publiée avant le départ', async () => {
  const finished = race({ id: 'finished', number: 'R1C2', result: { winners: '[2,1,3]', predictionSnapshot: null } });
  finished.predictions = [{
    createdAt: new Date('2026-09-24T11:00:00Z'),
    topPicks: JSON.stringify([5, 4, 3, 2, 1].map((number, index) => ({ number, name: `Cheval ${number}`, rank: index + 1 }))),
  }];
  const publication = await buildDailyPublication({
    country: 'bf',
    date: '2026-09-24',
    nationalPick: null,
    ecdPicks: [{ externalId: 'finished', priority: 1 }],
    racesById: new Map([['finished', finished]]),
    resolvePrediction: resolver,
  });

  assert.deepEqual(publication.ecd[0].selection.map((pick) => pick.number), [5, 4, 3, 2, 1]);
});

test('un seul tableau couvre toutes les courses sans doublonner la nationale ECD', async () => {
  const hybrid = race({ id: 'hybrid', number: 'R1C1' });
  const other = race({ id: 'other', number: 'R2C1' });
  const publication = await buildDailyPublication({ country: 'bf', date: '2026-09-24',
    nationalPick: { externalId: 'hybrid', betType: 'Quarté' }, ecdPicks: [{ externalId: 'hybrid' }],
    racesById: new Map([['hybrid', hybrid], ['other', other]]), resolvePrediction: resolver });
  assert.equal(publication.rows.length, 2);
  assert.deepEqual(publication.rows.find(row => row.race.id === 'hybrid').contexts, ['Nationale', 'ECD']);
  assert.deepEqual(publication.rows.find(row => row.race.id === 'other').contexts, []);
});

test('aucun pronostic reconstruit après le départ même avant publication du résultat', async () => {
  const old = race({ id: 'old', number: 'R1C1' });
  old.predictions = [{ createdAt: new Date('2026-09-24T23:00:00Z'), topPicks: '[{"number":1}]' }];
  const publication = await buildDailyPublication({ country: 'bf', date: '2026-09-24', nationalPick: null, ecdPicks: [], racesById: new Map([['old', old]]), resolvePrediction: async () => { throw new Error('Ne pas recalculer après départ'); } });
  assert.deepEqual(publication.rows[0].selection, []);
  assert.equal(publication.rows[0].predictionStatus, 'not-archived');
});
