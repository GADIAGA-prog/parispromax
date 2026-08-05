const test = require('node:test');
const assert = require('node:assert/strict');
const { getEcdProfile, availableVariants } = require('../../shared/ecdRules');
const {
  activeRunnerCount,
  automaticSelection,
  groupSelectedRaces,
} = require('../src/services/ecdProgram');

function race(externalId, track, time, runners, result = null) {
  return {
    externalId,
    track,
    name: `Prix ${externalId}`,
    date: '2026-07-31',
    discipline: 'Plat',
    condition: 'dry',
    distance: '1600m',
    raw: JSON.stringify({
      number: externalId,
      time,
      horses: Array.from({ length: runners }, (_, index) => ({
        number: index + 1,
        name: `Cheval ${index + 1}`,
      })),
    }),
    result,
  };
}

test('les règles ECD burkinabè exposent la mise officielle et les variantes éligibles', () => {
  const profile = getEcdProfile('bf');

  assert.equal(profile.verified, true);
  assert.equal(profile.unitStake, 500);
  assert.deepEqual(
    availableVariants(profile, 7).map((variant) => variant.id),
    ['simple-gagnant', 'simple-place', 'jumele-ordre']
  );
  assert.deepEqual(
    availableVariants(profile, 8).map((variant) => variant.id),
    ['simple-gagnant', 'simple-place', 'jumele', 'trio']
  );
});

test('un programme ECD ne peut être demandé que pour un pays du catalogue', () => {
  assert.equal(getEcdProfile('pays-inconnu'), null);
});

test('les non-partants font basculer le programme ECD de Trio vers Jumelé', () => {
  const profile = getEcdProfile('bf');
  const item = race('SMALL', 'AUTEUIL', '14:00', 8);
  item.nonPartants = '[8]';
  const full = JSON.parse(item.raw);

  assert.equal(activeRunnerCount(item, full), 7);
  const grouped = groupSelectedRaces([item], profile);
  assert.equal(grouped[0].races[0].runners, 7);
  assert.deepEqual(
    grouped[0].races[0].ecd.variants.map((variant) => variant.id),
    ['simple-gagnant', 'simple-place', 'jumele-ordre']
  );
});

test('le repli ECD respecte au maximum deux réunions et cinq courses par réunion', () => {
  const profile = getEcdProfile('bf');
  const races = [
    race('NAT', 'AUTEUIL', '14:00', 16),
    race('A1', 'AUTEUIL', '14:30', 12),
    race('V1', 'VINCENNES', '15:00', 14),
    race('V2', 'VINCENNES', '15:30', 13),
    race('V3', 'VINCENNES', '16:00', 12),
    race('D1', 'DIEPPE', '13:00', 5),
  ];

  const selected = automaticSelection(races, profile, 'NAT');
  const grouped = groupSelectedRaces(selected, profile);

  assert.deepEqual(selected.map((item) => item.externalId), ['V1', 'V2', 'V3', 'A1']);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].races[0].ecd.unitStake, 500);
  assert.equal(grouped[0].races[0].ecd.variants.at(-1).id, 'trio');
});
