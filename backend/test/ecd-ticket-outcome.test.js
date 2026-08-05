const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateEcdTickets,
  payoutRowsForCountry,
  proposedTickets,
  validateOfficialPayouts,
} = require('../../shared/ecdTicketOutcome');

const prediction = [
  { rank: 1, number: 8 },
  { rank: 2, number: 2 },
  { rank: 3, number: 7 },
];

const officialPayouts = [
  { bet: 'Gagnant', numbers: '8', amount: 0, winnerCount: 0 },
  { bet: 'Placé', numbers: '8', amount: 550, winnerCount: 9 },
  { bet: 'Placé', numbers: '2', amount: 550, winnerCount: 2 },
  { bet: 'Placé', numbers: '7', amount: 550, winnerCount: 5 },
  { bet: 'Jumelé ordre', numbers: '8 - 2', amount: 0, winnerCount: 0 },
  { bet: 'Jumelé gagnant', numbers: '8 - 2', amount: 26850, winnerCount: 4 },
  { bet: 'Jumelé placé', numbers: '2 - 8', amount: 4950, winnerCount: 49 },
  { bet: 'Jumelé placé', numbers: '7 - 8', amount: 1550, winnerCount: 202 },
  { bet: 'Jumelé placé', numbers: '2 - 7', amount: 4950, winnerCount: 49 },
  { bet: 'Trio', numbers: '7 - 8 - 2', amount: 27350, winnerCount: 20 },
];

test('construit les 9 tickets commercialisés à partir des trois premiers choix', () => {
  const tickets = proposedTickets(prediction);

  assert.equal(tickets.length, 9);
  assert.deepEqual(tickets.map((ticket) => ticket.kind), [
    'win', 'place', 'place', 'place',
    'jum-win', 'jum-place', 'jum-place', 'jum-place', 'trio',
  ]);
});

test('un petit champ ECD exclut les Jumelés gagnant et placé non commercialisés', () => {
  const tickets = proposedTickets(prediction, 2);

  assert.equal(tickets.length, 4);
  assert.deepEqual(tickets.map((ticket) => ticket.kind), [
    'win', 'place', 'place', 'jum-order',
  ]);
  assert.equal(tickets.some((ticket) => ticket.kind === 'trio'), false);
});

test('calcule les tickets gagnants et le gain théorique depuis les rapports officiels', () => {
  const payablePayouts = officialPayouts.map((row) => (
    row.bet === 'Gagnant' ? { ...row, amount: 1000, winnerCount: 1 } : row
  ));
  const outcome = evaluateEcdTickets({
    payouts: payablePayouts,
    predictions: prediction,
    officialArrival: [8, 2, 7],
    unitStake: 500,
    currency: 'FCFA',
  });

  assert.equal(outcome.status, 'settled');
  assert.equal(outcome.ticketsCount, 9);
  assert.equal(outcome.coveredCount, 9);
  assert.equal(outcome.winningCount, 9);
  assert.equal(outcome.payableCount, 9);
  assert.equal(outcome.totalStake, 4500);
  assert.equal(outcome.totalReturn, 68300);
  assert.equal(outcome.netReturn, 63800);
  assert.equal(outcome.winningTickets.find((ticket) => ticket.kind === 'trio').returnAmount, 27350);
});

test('laisse le retour indéterminable quand la bonne sélection a un rapport officiel nul', () => {
  const outcome = evaluateEcdTickets({
    payouts: officialPayouts,
    predictions: prediction,
    officialArrival: [8, 2, 7],
    unitStake: 500,
  });

  assert.equal(outcome.status, 'settled-indeterminate');
  assert.equal(outcome.winningCount, 9);
  assert.equal(outcome.payableCount, 8);
  assert.equal(outcome.indeterminateCount, 1);
  assert.equal(outcome.totalReturn, null);
  assert.equal(outcome.netReturn, null);
});

test('un rapport partiel ne devient jamais un bilan final', () => {
  const partial = officialPayouts.filter((row) => row.bet !== 'Trio');
  assert.equal(validateOfficialPayouts({
    payouts: partial,
    arrival: [8, 2, 7],
    podiumSize: 3,
  }).status, 'partial');

  const outcome = evaluateEcdTickets({
    payouts: partial,
    predictions: prediction,
    officialArrival: [8, 2, 7],
    unitStake: 500,
  });
  assert.equal(outcome.status, 'reports-partial');
  assert.equal(outcome.totalReturn, null);
});

test('les rapports historiques LONAB ne fuient pas vers un autre pays', () => {
  assert.equal(payoutRowsForCountry(officialPayouts, 'bf').length, 10);
  assert.equal(payoutRowsForCountry(officialPayouts, 'ci').length, 0);
  const tagged = [{ ...officialPayouts[0], country: 'ci', operator: 'LONACI' }];
  assert.equal(payoutRowsForCountry(tagged, 'ci').length, 1);
  assert.equal(payoutRowsForCountry(tagged, 'bf').length, 0);
});

test('laisse les gains en attente tant que les rapports officiels ne sont pas publiés', () => {
  const outcome = evaluateEcdTickets({ predictions: prediction, unitStake: 500 });

  assert.equal(outcome.status, 'reports-pending');
  assert.equal(outcome.ticketsCount, 9);
  assert.equal(outcome.totalStake, 4500);
  assert.equal(outcome.totalReturn, null);
  assert.equal(outcome.netReturn, null);
});

test('n’invente pas de mise pour un pays dont la règle n’est pas vérifiée', () => {
  const payablePayouts = officialPayouts.map((row) => (
    row.bet === 'Gagnant' ? { ...row, amount: 1000, winnerCount: 1 } : row
  ));
  const outcome = evaluateEcdTickets({
    payouts: payablePayouts,
    predictions: prediction,
    officialArrival: [8, 2, 7],
    unitStake: null,
  });

  assert.equal(outcome.totalStake, null);
  assert.equal(outcome.totalReturn, 68300);
  assert.equal(outcome.netReturn, null);
});
