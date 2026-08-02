'use strict';

function normalizeBet(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function betKind(value) {
  const bet = normalizeBet(value);
  if (bet.includes('trio')) return 'trio';
  if (bet.includes('ordre')) return 'jum-order';
  if (bet.includes('jum') && bet.includes('place')) return 'jum-place';
  if (bet.includes('jum')) return 'jum-win';
  if (bet.includes('place')) return 'place';
  return 'win';
}

function numbers(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  return String(value || '').match(/\d+/g)?.map(Number) || [];
}

function predictionNumbers(predictions) {
  return (predictions || [])
    .slice()
    .sort((a, b) => Number(a?.rank || 999) - Number(b?.rank || 999))
    .map((pick) => Number(typeof pick === 'object' ? pick.number : pick))
    .filter(Number.isFinite);
}

function sameNumbers(kind, leftValue, rightValue) {
  const left = numbers(leftValue);
  const right = numbers(rightValue);
  if (left.length !== right.length || !left.length) return false;
  if (kind === 'jum-order' || kind === 'win' || kind === 'place') {
    return left.every((number, index) => number === right[index]);
  }
  return left.slice().sort((a, b) => a - b).every(
    (number, index) => number === right.slice().sort((a, b) => a - b)[index]
  );
}

function proposedTickets(predictions) {
  const [first, second, third] = predictionNumbers(predictions);
  if (!first) return [];
  const tickets = [{ kind: 'win', bet: 'Gagnant', numbers: [first] }];
  [first, second, third].filter(Number.isFinite).forEach((number) => {
    tickets.push({ kind: 'place', bet: 'Placé', numbers: [number] });
  });
  if (Number.isFinite(second)) {
    tickets.push({ kind: 'jum-order', bet: 'Jumelé ordre', numbers: [first, second] });
    tickets.push({ kind: 'jum-win', bet: 'Jumelé gagnant', numbers: [first, second] });
  }
  if (Number.isFinite(second) && Number.isFinite(third)) {
    tickets.push({ kind: 'jum-place', bet: 'Jumelé placé', numbers: [first, second] });
    tickets.push({ kind: 'jum-place', bet: 'Jumelé placé', numbers: [first, third] });
    tickets.push({ kind: 'jum-place', bet: 'Jumelé placé', numbers: [second, third] });
    tickets.push({ kind: 'trio', bet: 'Trio', numbers: [first, second, third] });
  }
  return tickets;
}

function evaluateEcdTickets({ payouts = [], predictions = [], unitStake = 500, currency = 'FCFA' } = {}) {
  const tickets = proposedTickets(predictions);
  const reportsAvailable = Array.isArray(payouts) && payouts.length > 0;
  const stake = Number(unitStake) > 0 ? Number(unitStake) : null;
  const evaluated = tickets.map((ticket, index) => {
    const official = reportsAvailable
      ? payouts.find((row) => {
          const kind = betKind(row.bet);
          return kind === ticket.kind && sameNumbers(kind, ticket.numbers, row.numbers);
        })
      : null;
    const amount = official ? Number(official.amount || 0) : 0;
    return {
      id: `${ticket.kind}-${ticket.numbers.join('-')}-${index}`,
      kind: ticket.kind,
      bet: ticket.bet,
      numbers: ticket.numbers,
      stake,
      covered: Boolean(official),
      winning: Boolean(official) && amount > 0,
      returnAmount: official ? amount : 0,
      winnerCount: official ? Number(official.winnerCount || 0) : null,
    };
  });
  const coveredTickets = evaluated.filter((ticket) => ticket.covered);
  const winningTickets = evaluated.filter((ticket) => ticket.winning);
  const totalStake = stake == null ? null : tickets.length * stake;
  const totalReturn = reportsAvailable
    ? evaluated.reduce((sum, ticket) => sum + ticket.returnAmount, 0)
    : null;
  return {
    status: !tickets.length ? 'prediction-unavailable' : reportsAvailable ? 'settled' : 'reports-pending',
    currency,
    unitStake: stake,
    ticketsCount: tickets.length,
    coveredCount: coveredTickets.length,
    winningCount: winningTickets.length,
    totalStake,
    totalReturn,
    netReturn: totalReturn == null || totalStake == null ? null : totalReturn - totalStake,
    tickets: evaluated,
    winningTickets,
  };
}

module.exports = {
  normalizeBet,
  betKind,
  numbers,
  predictionNumbers,
  sameNumbers,
  proposedTickets,
  evaluateEcdTickets,
};
