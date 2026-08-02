const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateEcdTickets,
  proposedTickets,
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

test('construit les 10 tickets illustratifs à partir des trois premiers choix', () => {
  const tickets = proposedTickets(prediction);

  assert.equal(tickets.length, 10);
  assert.deepEqual(tickets.map((ticket) => ticket.kind), [
    'win', 'place', 'place', 'place', 'jum-order',
    'jum-win', 'jum-place', 'jum-place', 'jum-place', 'trio',
  ]);
});

test('calcule les tickets gagnants et le gain théorique depuis les rapports officiels', () => {
  const outcome = evaluateEcdTickets({
    payouts: officialPayouts,
    predictions: prediction,
    unitStake: 500,
    currency: 'FCFA',
  });

  assert.equal(outcome.status, 'settled');
  assert.equal(outcome.ticketsCount, 10);
  assert.equal(outcome.coveredCount, 10);
  assert.equal(outcome.winningCount, 8);
  assert.equal(outcome.totalStake, 5000);
  assert.equal(outcome.totalReturn, 67300);
  assert.equal(outcome.netReturn, 62300);
  assert.equal(outcome.winningTickets.find((ticket) => ticket.kind === 'trio').returnAmount, 27350);
});

test('laisse les gains en attente tant que les rapports officiels ne sont pas publiés', () => {
  const outcome = evaluateEcdTickets({ predictions: prediction, unitStake: 500 });

  assert.equal(outcome.status, 'reports-pending');
  assert.equal(outcome.ticketsCount, 10);
  assert.equal(outcome.totalStake, 5000);
  assert.equal(outcome.totalReturn, null);
  assert.equal(outcome.netReturn, null);
});

test('n’invente pas de mise pour un pays dont la règle n’est pas vérifiée', () => {
  const outcome = evaluateEcdTickets({
    payouts: officialPayouts,
    predictions: prediction,
    unitStake: null,
  });

  assert.equal(outcome.totalStake, null);
  assert.equal(outcome.totalReturn, 67300);
  assert.equal(outcome.netReturn, null);
});
