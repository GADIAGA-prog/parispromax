const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getBurkinaGame,
  combinationCount,
  grandCarnetCost,
} = require('../../shared/burkinaGameRules');
const {
  getNationalGame,
  inferGameFormat,
} = require('../../shared/nationalGameRules');
const {
  buildNationalBetProposal,
  listCombinations,
} = require('../../shared/nationalBetProposal');

test('applique le calendrier hebdomadaire du Burkina Faso', () => {
  assert.deepEqual(
    ['2026-07-26', '2026-07-29', '2026-07-31'].map((date) => getBurkinaGame(date).label),
    ['Quinté', 'Quinté', 'Quinté']
  );
  assert.deepEqual(
    ['2026-07-27', '2026-07-21', '2026-07-30'].map((date) => getBurkinaGame(date).label),
    ['Quarté', 'Quarté', 'Quarté']
  );
  assert.equal(getBurkinaGame('2026-08-01').label, 'Tiercé');
});

test('le dernier mardi du mois est un Quinté à 300 FCFA', () => {
  const game = getBurkinaGame('2026-06-30');

  assert.equal(game.isLastTuesday, true);
  assert.equal(game.label, 'Quinté');
  assert.equal(game.podium, 5);
  assert.equal(game.stake, 300);
});

test('calcule les combinaisons et le coût du grand carnet', () => {
  assert.equal(combinationCount(7, 5), 21);
  assert.equal(grandCarnetCost(7, 5, 300), 6300);
  assert.equal(combinationCount(6, 4), 15);
  assert.equal(grandCarnetCost(6, 4, 200), 3000);
  assert.equal(combinationCount(2, 3), 0);
});

test('construit une couverture intelligente adaptée au jeu burkinabè du jour', () => {
  const game = getNationalGame('bf', '2026-07-31');

  assert.equal(game.label, 'Quinté');
  assert.equal(game.verified, true);
  assert.equal(game.recommendedSelectionSize, 7);
  assert.equal(game.recommendedCombinations, 21);
  assert.equal(game.recommendedCost, 6300);
});

test('raisonne sur le format officiel du jour sans inventer la mise des autres pays', () => {
  const game = getNationalGame('ci', '2026-07-31', { betType: 'Quarté' });

  assert.deepEqual(inferGameFormat('Tiercé national'), { label: 'Tiercé', podium: 3 });
  assert.equal(game.countryName, "Côte d'Ivoire");
  assert.equal(game.podium, 4);
  assert.equal(game.recommendedSelectionSize, 6);
  assert.equal(game.recommendedCombinations, 15);
  assert.equal(game.recommendedCost, null);
  assert.equal(game.verified, false);
});

test('propose les couplés et toutes les combinaisons du Grand Carnet national', () => {
  const game = getNationalGame('bf', '2026-07-30');
  const candidates = [
    { number: 4, name: 'Alpha' },
    { number: 8, name: 'Bravo' },
    { number: 2, name: 'Charlie' },
    { number: 11, name: 'Delta' },
    { number: 6, name: 'Echo' },
    { number: 9, name: 'Foxtrot' },
  ];
  const proposal = buildNationalBetProposal(game, candidates, { nonPartants: [11] });

  assert.deepEqual(
    proposal.couples.map((ticket) => [ticket.id, ticket.horses.map((horse) => horse.number)]),
    [
      ['winner', [4, 8]],
      ['placed-a', [4, 8]],
      ['placed-b', [4, 2]],
      ['placed-c', [8, 2]],
    ]
  );
  assert.deepEqual(proposal.grandCarnet.horses.map((horse) => horse.number), [4, 8, 2, 6, 9]);
  assert.equal(proposal.grandCarnet.combinationsCount, 5);
  assert.equal(proposal.grandCarnet.combinations.length, 5);
  assert.equal(proposal.grandCarnet.cost, 1000);
  assert.equal(listCombinations(candidates.slice(0, 6), 4).length, 15);
});
