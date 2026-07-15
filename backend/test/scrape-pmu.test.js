const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/jobs/scrapePmu');

test('PMU date is converted to the endpoint format', () => {
  assert.equal(_test.formatDate('2026-07-15'), '15072026');
  assert.throws(() => _test.formatDate('15/07/2026'), /invalide/);
});

test('PMU participant is normalized for the prediction engine', () => {
  const horse = _test.normalizeParticipant({
    numPmu: 7,
    nom: 'CHEVAL TEST',
    driver: { prenom: 'Jean', nom: 'Dupont' },
    entraineur: 'Marie Martin',
    musique: '1a2a4a',
    gainsParticipant: { gainsCarriere: 125000 },
    dernierRapportDirect: { rapport: 3.4 },
    dernierRapportReference: { rapport: 4.1 },
    deferre: 'DEFERRE_4',
  });

  assert.equal(horse.number, 7);
  assert.equal(horse.name, 'CHEVAL TEST');
  assert.equal(horse.jockey, 'Jean Dupont');
  assert.equal(horse.trainer, 'Marie Martin');
  assert.equal(horse.odds, 3.4);
  assert.equal(horse.coteOpen, 4.1);
  assert.equal(horse.gains, 125000);
  assert.equal(horse.deferrage, 'D4');
  assert.equal(horse.musiqueParsed.derniere_performance, 1);
});

test('PMU race excludes non-runners and keeps a stable external id', () => {
  const race = _test.normalizeRace('2026-07-15', 1, {
    numOrdre: 3,
    libelle: 'Prix de Paris',
    heureDepart: Date.parse('2026-07-15T12:30:00Z'),
    montantPrix: 50000,
    specialite: 'TROT_ATTELE',
    typeDepart: 'AUTOSTART',
    distance: 2700,
  }, [
    { numPmu: 1, nom: 'PARTANT', musique: '1a' },
    { numPmu: 2, nom: 'ABSENT', statut: 'NON_PARTANT', musique: '2a' },
  ]);

  assert.equal(race.id, 'pmu-2026-07-15-R1-C3');
  assert.equal(race.number, 'C3');
  assert.equal(race.distance, '2700m');
  assert.equal(race.autostart, true);
  assert.equal(race.runners, 1);
  assert.deepEqual(race.horses.map((horse) => horse.number), [1]);
});

test('PMU finishing positions are parsed from scalar or array values', () => {
  assert.equal(_test.finishPosition('1er'), 1);
  assert.equal(_test.finishPosition(['03']), 3);
  assert.equal(_test.finishPosition(null), null);
});
