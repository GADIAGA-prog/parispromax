'use strict';

const { buildNationalBetProposal } = require('./nationalBetProposal');

function evaluateGrandCarnet(game, candidates, winners, { officialGain = null } = {}) {
  const proposal = buildNationalBetProposal(game, candidates || []);
  const ticket = proposal?.grandCarnet;
  const podium = Number(game?.podium);
  const arrival = (winners || []).slice(0, podium).map(Number).filter(Number.isFinite);
  if (!ticket || arrival.length !== podium) return null;

  const selected = ticket.horses.map((horse) => Number(horse.number));
  const selectedSet = new Set(selected);
  const matchedHorses = arrival.filter((number) => selectedSet.has(number));
  const isWinning = matchedHorses.length === podium;
  const confirmedGain = Number(officialGain);
  const hasConfirmedGain = isWinning
    && officialGain != null
    && Number.isFinite(confirmedGain)
    && confirmedGain >= 0;

  return {
    label: ticket.label,
    selection: selected,
    arrival,
    matchedHorses: matchedHorses.length,
    combinationsCount: ticket.combinationsCount,
    winningCombinations: isWinning ? 1 : 0,
    unitStake: ticket.stake,
    totalStake: ticket.cost,
    currency: game.currency || 'FCFA',
    isWinning,
    gain: hasConfirmedGain ? confirmedGain : (isWinning ? null : 0),
    gainStatus: hasConfirmedGain
      ? 'confirmed'
      : (isWinning ? 'pending-official-report' : 'not-winning'),
  };
}

module.exports = { evaluateGrandCarnet };
