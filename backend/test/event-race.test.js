const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/jobs/ingest');

function race(id, { prize, runners, isQuinte = false }) {
  return {
    id,
    prize,
    isQuinte,
    horses: Array.from({ length: runners }, (_, index) => ({ number: index + 1 })),
  };
}

test('the explicit PMU Quinte is selected before a richer ordinary race', () => {
  const quinte = race('pmu-quinte', { prize: 50000, runners: 15, isQuinte: true });
  const ordinary = race('pmu-ordinary', { prize: 200000, runners: 18 });
  const selected = _test.detectEventRace({
    racetracks: [{ races: [ordinary, quinte] }],
  });

  assert.equal(selected.id, 'pmu-quinte');
});

test('allocation and runners remain the fallback without an explicit Quinte', () => {
  const selected = _test.detectEventRace({
    racetracks: [{ races: [
      race('small', { prize: 10000, runners: 12 }),
      race('event', { prize: 80000, runners: 14 }),
    ] }],
  });

  assert.equal(selected.id, 'event');
});
