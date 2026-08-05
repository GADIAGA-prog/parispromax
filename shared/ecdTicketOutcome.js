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

function uniqueNumbers(values) {
  const seen = new Set();
  return numbers(values).filter((number) => {
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) return false;
    seen.add(number);
    return true;
  });
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

// Historical rows written before payout provenance was introduced all came
// from the LONAB source. They are therefore valid for Burkina Faso only.
function payoutRowsForCountry(payouts, countryValue, legacyCountry = 'bf', contextValue = null) {
  const country = String(countryValue || '').trim().toLowerCase();
  const context = String(contextValue || '').trim().toLowerCase();
  if (!country) return [];
  return (Array.isArray(payouts) ? payouts : []).filter((row) => {
    const rowCountry = String(row?.country || legacyCountry).trim().toLowerCase();
    // Historical untagged payout rows all came from the ECD LONAB importer.
    // Explicit national rows may coexist on a hybrid race and must never enter
    // an ECD ticket calculation.
    const rowContext = String(row?.context || 'ecd').trim().toLowerCase();
    return rowCountry === country && (!context || rowContext === context);
  });
}

// The PDF has six useful report rows for a two-runner podium and ten for a
// three-runner podium. Some non-commercial columns remain present at zero;
// they are still required here to prove that parsing is complete.
function expectedOfficialRows(arrivalValue, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const [first, second, third] = uniqueNumbers(arrivalValue).slice(0, podium);
  if (!first || !second || (podium === 3 && !third)) return [];
  const expected = [
    { kind: 'win', numbers: [first] },
    { kind: 'place', numbers: [first] },
    { kind: 'place', numbers: [second] },
    { kind: 'jum-order', numbers: [first, second] },
    { kind: 'jum-win', numbers: [first, second] },
    { kind: 'jum-place', numbers: [first, second] },
  ];
  if (podium === 3) {
    expected.splice(3, 0, { kind: 'place', numbers: [third] });
    expected.push(
      { kind: 'jum-place', numbers: [first, third] },
      { kind: 'jum-place', numbers: [second, third] },
      { kind: 'trio', numbers: [first, second, third] }
    );
  }
  return expected;
}

function validateOfficialPayouts({ payouts = [], arrival = [], podiumSize = 3 } = {}) {
  const rows = Array.isArray(payouts) ? payouts : [];
  if (!rows.length) return { status: 'pending', rows, missing: [], expectedRows: 0 };
  const expected = expectedOfficialRows(arrival, podiumSize);
  if (!expected.length) {
    return { status: 'arrival-incomplete', rows, missing: [], expectedRows: 0 };
  }
  const missing = expected.filter((ticket) => !rows.some((row) => {
    const kind = betKind(row?.bet);
    return kind === ticket.kind && sameNumbers(kind, ticket.numbers, row?.numbers);
  }));
  return {
    status: missing.length ? 'partial' : 'complete',
    rows,
    missing,
    expectedRows: expected.length,
  };
}

function playablePayoutRows(payouts, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const allowed = podium === 2
    ? new Set(['win', 'place', 'jum-order'])
    : new Set(['win', 'place', 'jum-win', 'jum-place', 'trio']);
  return (Array.isArray(payouts) ? payouts : []).filter((row) => allowed.has(betKind(row?.bet)));
}

function proposedTickets(predictions, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const [first, second, third] = predictionNumbers(predictions).slice(0, podium);
  if (!first) return [];
  const tickets = [{ kind: 'win', bet: 'Gagnant', numbers: [first] }];
  [first, second, third].filter(Number.isFinite).forEach((number) => {
    tickets.push({ kind: 'place', bet: 'Placé', numbers: [number] });
  });
  if (Number.isFinite(second)) {
    if (podium === 2) {
      tickets.push({ kind: 'jum-order', bet: 'Jumelé ordre', numbers: [first, second] });
    } else {
      tickets.push({ kind: 'jum-win', bet: 'Jumelé gagnant', numbers: [first, second] });
      tickets.push({ kind: 'jum-place', bet: 'Jumelé placé', numbers: [first, second] });
    }
  }
  if (Number.isFinite(second) && Number.isFinite(third)) {
    tickets.push({ kind: 'jum-place', bet: 'Jumelé placé', numbers: [first, third] });
    tickets.push({ kind: 'jum-place', bet: 'Jumelé placé', numbers: [second, third] });
    tickets.push({ kind: 'trio', bet: 'Trio', numbers: [first, second, third] });
  }
  return tickets;
}

function evaluateEcdTickets({
  payouts = [],
  predictions = [],
  podiumSize = 3,
  officialArrival = [],
  reportStatus = null,
  unitStake = 500,
  currency = 'FCFA',
} = {}) {
  const tickets = proposedTickets(predictions, podiumSize);
  const validation = reportStatus
    ? { status: reportStatus }
    : validateOfficialPayouts({ payouts, arrival: officialArrival, podiumSize });
  const reportsAvailable = validation.status === 'complete';
  const stake = Number(unitStake) > 0 ? Number(unitStake) : null;
  const evaluated = tickets.map((ticket, index) => {
    const official = reportsAvailable
      ? payouts.find((row) => {
          const kind = betKind(row.bet);
          return kind === ticket.kind && sameNumbers(kind, ticket.numbers, row.numbers);
        })
      : null;
    const amount = official ? Number(official.amount || 0) : 0;
    const selectionCorrect = Boolean(official);
    const reportPayable = selectionCorrect && amount > 0;
    const reportIndeterminate = selectionCorrect && !reportPayable;
    return {
      id: `${ticket.kind}-${ticket.numbers.join('-')}-${index}`,
      kind: ticket.kind,
      bet: ticket.bet,
      numbers: ticket.numbers,
      stake,
      covered: selectionCorrect,
      selectionCorrect,
      reportPayable,
      reportIndeterminate,
      winning: selectionCorrect,
      returnAmount: reportIndeterminate ? null : selectionCorrect ? amount : 0,
      winnerCount: official ? Number(official.winnerCount || 0) : null,
    };
  });
  const coveredTickets = evaluated.filter((ticket) => ticket.covered);
  const winningTickets = evaluated.filter((ticket) => ticket.winning);
  const payableTickets = evaluated.filter((ticket) => ticket.reportPayable);
  const indeterminateTickets = evaluated.filter((ticket) => ticket.reportIndeterminate);
  const totalStake = stake == null ? null : tickets.length * stake;
  const totalReturn = reportsAvailable && !indeterminateTickets.length
    ? evaluated.reduce((sum, ticket) => sum + Number(ticket.returnAmount || 0), 0)
    : null;
  const status = !tickets.length
    ? 'prediction-unavailable'
    : reportsAvailable
      ? indeterminateTickets.length ? 'settled-indeterminate' : 'settled'
      : validation.status === 'partial' || validation.status === 'arrival-incomplete'
        ? 'reports-partial'
        : 'reports-pending';
  return {
    status,
    reportStatus: validation.status,
    currency,
    podiumSize: Math.max(2, Math.min(3, Number(podiumSize) || 3)),
    unitStake: stake,
    ticketsCount: tickets.length,
    coveredCount: coveredTickets.length,
    winningCount: winningTickets.length,
    payableCount: payableTickets.length,
    indeterminateCount: indeterminateTickets.length,
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
  uniqueNumbers,
  sameNumbers,
  payoutRowsForCountry,
  expectedOfficialRows,
  validateOfficialPayouts,
  playablePayoutRows,
  proposedTickets,
  evaluateEcdTickets,
};
