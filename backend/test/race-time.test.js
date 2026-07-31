const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parisStartIso,
  gmtTimeLabel,
} = require('../src/services/raceTime');

test('convertit une heure PMU d’été de Paris vers GMT+0', () => {
  assert.equal(parisStartIso('2026-07-31', '15h30'), '2026-07-31T13:30:00.000Z');
  assert.equal(gmtTimeLabel('2026-07-31', '15h30'), '13h30 GMT+0');
});

test('convertit une heure PMU d’hiver de Paris vers GMT+0', () => {
  assert.equal(parisStartIso('2026-01-15', '15:30'), '2026-01-15T14:30:00.000Z');
  assert.equal(gmtTimeLabel('2026-01-15', '15:30'), '14h30 GMT+0');
});

test('ne fabrique pas une heure invalide', () => {
  assert.equal(parisStartIso('2026-07-31', ''), null);
  assert.equal(gmtTimeLabel('2026-07-31', ''), '');
});
