'use strict';

const { buildNationalBetProposal } = require('./nationalBetProposal');

function runnerNumbers(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const number = Number(value?.number ?? value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) return [];
    seen.add(number);
    return [number];
  });
}

function sameOrder(left, right) {
  const a = runnerNumbers(left);
  const b = runnerNumbers(right);
  return a.length === b.length && a.every((number, index) => number === b[index]);
}

function sameSet(left, right) {
  const a = runnerNumbers(left).sort((x, y) => x - y);
  const b = runnerNumbers(right).sort((x, y) => x - y);
  return a.length === b.length && a.every((number, index) => number === b[index]);
}

function payoutKind(value) {
  const explicit = String(value?.kind || '').trim().toLowerCase();
  if (explicit) return explicit;
  const label = String(value?.bet || value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (label.includes('desordre')) return 'disorder';
  if (label.includes('ordre')) return 'order';
  if (label.includes('bonus')) return 'bonus';
  return null;
}

function officialArrivals(officialReport, fallbackArrival, podium) {
  const values = Array.isArray(officialReport?.arrivals) && officialReport.arrivals.length
    ? officialReport.arrivals
    : [fallbackArrival];
  return values
    .map((arrival) => runnerNumbers(arrival).slice(0, podium))
    .filter((arrival) => arrival.length === podium)
    .filter((arrival, index, all) => all.findIndex(
      (candidate) => candidate.join('-') === arrival.join('-')
    ) === index);
}

function ticketOutcome(combinationValue, arrivals, podium) {
  const combination = runnerNumbers(combinationValue);
  if (combination.length !== podium) return null;
  if (arrivals.some((arrival) => sameOrder(combination, arrival))) return 'order';
  if (arrivals.some((arrival) => sameSet(combination, arrival))) return 'disorder';
  if (podium === 5 && arrivals.some((arrival) => {
    const selected = new Set(combination);
    return arrival.slice(0, 4).every((number) => selected.has(number))
      && !selected.has(arrival[4]);
  })) return 'bonus';
  return null;
}

function reportDetails(officialReport) {
  if (!officialReport) return { status: null, rows: [], operator: null, sourceUrl: null };
  if (Array.isArray(officialReport)) {
    return { status: 'complete', rows: officialReport, operator: null, sourceUrl: null };
  }
  return {
    status: officialReport.status || null,
    rows: officialReport.payouts || officialReport.rows || [],
    operator: officialReport.operator || null,
    sourceUrl: officialReport.sourceUrl || null,
  };
}

function evaluateGrandCarnet(
  game,
  candidates,
  winners,
  { officialGain = null, officialReport = null } = {}
) {
  const proposal = buildNationalBetProposal(game, candidates || []);
  const ticket = proposal?.grandCarnet;
  const podium = Number(game?.podium);
  const arrival = runnerNumbers(winners).slice(0, podium);
  if (!ticket || arrival.length !== podium) return null;

  const report = reportDetails(officialReport);
  const arrivals = officialArrivals(officialReport, arrival, podium);
  const selection = ticket.horses.map((horse) => Number(horse.number));
  const selectedSet = new Set(selection);
  const matchedHorses = Math.max(...arrivals.map(
    (sequence) => sequence.filter((number) => selectedSet.has(number)).length
  ));
  const winningTickets = (ticket.combinations || []).flatMap((combination) => {
    const outcome = ticketOutcome(combination, arrivals, podium);
    return outcome ? [{ numbers: runnerNumbers(combination), outcome }] : [];
  });
  const isWinning = winningTickets.length > 0;

  let gain = isWinning ? null : 0;
  let gainStatus = isWinning ? 'pending-official-report' : 'not-winning';
  let settledTickets = winningTickets;

  // Compatibility for a caller that already owns a single verified amount.
  const scalarGain = Number(officialGain);
  if (
    isWinning
    && officialGain != null
    && Number.isFinite(scalarGain)
    && scalarGain >= 0
  ) {
    gain = scalarGain;
    gainStatus = 'confirmed';
    settledTickets = winningTickets.map((entry, index) => ({
      ...entry,
      gain: index === 0 ? scalarGain : 0,
    }));
  } else if (isWinning && ['partial', 'report-partial'].includes(report.status)) {
    gainStatus = 'report-partial';
  } else if (isWinning && report.status === 'complete') {
    let total = 0;
    let indeterminate = false;
    let missing = false;
    settledTickets = winningTickets.map((entry) => {
      const row = report.rows.find((candidate) => payoutKind(candidate) === entry.outcome);
      if (!row) {
        missing = true;
        return { ...entry, gain: null };
      }
      const amount = Number(row.amount);
      const winnerCount = row.winnerCount == null ? null : Number(row.winnerCount);
      const payable = Number.isFinite(amount) && amount > 0 && winnerCount !== 0;
      if (!payable) {
        indeterminate = true;
        return { ...entry, gain: null };
      }
      total += amount;
      return { ...entry, gain: amount };
    });
    if (missing) {
      gainStatus = 'report-partial';
    } else if (indeterminate) {
      gainStatus = 'official-report-indeterminate';
    } else {
      gain = total;
      gainStatus = 'confirmed';
    }
  }

  const winningBreakdown = settledTickets.reduce((summary, entry) => {
    const current = summary[entry.outcome] || { count: 0, gain: 0 };
    current.count += 1;
    current.gain = entry.gain == null || current.gain == null
      ? null
      : current.gain + Number(entry.gain || 0);
    summary[entry.outcome] = current;
    return summary;
  }, {});

  return {
    label: ticket.label,
    selection,
    arrival,
    officialArrivals: arrivals,
    matchedHorses,
    combinationsCount: ticket.combinationsCount,
    winningCombinations: winningTickets.length,
    winningTickets: settledTickets,
    winningBreakdown,
    unitStake: ticket.stake,
    totalStake: ticket.cost,
    currency: game.currency || 'FCFA',
    isWinning,
    gain,
    netGain: gain == null || ticket.cost == null ? null : gain - ticket.cost,
    gainStatus,
    report: {
      status: report.status || (officialGain != null ? 'complete' : 'pending'),
      operator: report.operator,
      sourceUrl: report.sourceUrl,
    },
  };
}

module.exports = {
  evaluateGrandCarnet,
  _test: { runnerNumbers, sameOrder, sameSet, payoutKind, ticketOutcome },
};
