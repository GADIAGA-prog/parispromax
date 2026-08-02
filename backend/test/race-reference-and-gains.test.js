'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRaceReference } = require('../../shared/raceReference');
const { getNationalGame } = require('../../shared/nationalGameRules');
const { evaluateGrandCarnet } = require('../../shared/grandCarnetOutcome');

const candidates = [4, 8, 2, 11, 6, 9].map((number) => ({
  number,
  name: `Cheval ${number}`,
}));

test('normalise la référence réunion/course au format R1C1', () => {
  assert.equal(formatRaceReference({ number: 'R2-C3' }), 'R2C3');
  assert.equal(formatRaceReference({ id: 'pmu-2026-08-02-R4-C7', number: 'C7' }), 'R4C7');
  assert.equal(
    formatRaceReference({ number: 'R2' }, { meetingNumber: 1, courseNumber: 2 }),
    'R1C2'
  );
});

test('calcule le bilan du Grand Carnet gagnant sans inventer le rapport officiel', () => {
  const game = getNationalGame('bf', '2026-08-01');
  const outcome = evaluateGrandCarnet(game, candidates, [8, 4, 2, 7, 1]);

  assert.equal(game.label, 'Tiercé');
  assert.equal(outcome.isWinning, true);
  assert.equal(outcome.winningCombinations, 1);
  assert.equal(outcome.combinationsCount, 10);
  assert.equal(outcome.totalStake, 2000);
  assert.equal(outcome.gain, null);
  assert.equal(outcome.gainStatus, 'pending-official-report');
});

test('affiche un gain nul lorsque le pronostic Grand Carnet est perdant', () => {
  const game = getNationalGame('bf', '2026-08-01');
  const outcome = evaluateGrandCarnet(game, candidates, [8, 4, 15]);

  assert.equal(outcome.isWinning, false);
  assert.equal(outcome.winningCombinations, 0);
  assert.equal(outcome.gain, 0);
  assert.equal(outcome.gainStatus, 'not-winning');
});
