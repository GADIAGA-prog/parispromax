'use strict';

const {
  combinationCount,
  grandCarnetCost,
} = require('./burkinaGameRules');

function horseKey(horse) {
  return String(horse?.number ?? '').trim();
}

function compactHorse(horse) {
  return {
    number: horse.number,
    name: String(horse.name || `N° ${horse.number}`).trim(),
  };
}

function normalizeCandidates(candidates, nonPartants = []) {
  const excluded = new Set((nonPartants || []).map((number) => String(number)));
  const seen = new Set();
  const result = [];

  for (const horse of candidates || []) {
    const key = horseKey(horse);
    if (!key || horse?.nonPartant || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(compactHorse(horse));
  }
  return result;
}

function listCombinations(items, places) {
  const result = [];
  const selection = [];

  function visit(start) {
    if (selection.length === places) {
      result.push(selection.map((item) => item.number));
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      selection.push(items[index]);
      visit(index + 1);
      selection.pop();
    }
  }

  if (Number.isInteger(places) && places > 0 && items.length >= places) visit(0);
  return result;
}

function couple(id, label, positions, ranking) {
  const horses = positions
    .map((position) => ranking[position - 1])
    .filter(Boolean);
  if (horses.length !== 2) return null;
  return { id, label, positions, horses };
}

function buildNationalBetProposal(game, candidates, { nonPartants = [], source = 'analysis' } = {}) {
  const podium = Number(game?.podium);
  const requestedSize = Number(game?.recommendedSelectionSize || podium + 2);
  if (!Number.isInteger(podium) || podium < 2) return null;

  const ranking = normalizeCandidates(candidates, nonPartants);
  if (ranking.length < Math.max(3, podium)) return null;

  const selectionSize = Math.min(ranking.length, Math.max(podium, requestedSize));
  const grandCarnetHorses = ranking.slice(0, selectionSize);
  const combinations = listCombinations(grandCarnetHorses, podium);
  const stake = Number(game?.stake);

  return {
    source,
    ranking: ranking.slice(0, Math.max(3, selectionSize)),
    couples: (game?.couples || []).length ? [
      couple('winner', 'Couplé gagnant', [1, 2], ranking),
      couple('placed-a', 'Couplé placé A', [1, 2], ranking),
      couple('placed-b', 'Couplé placé B', [1, 3], ranking),
      couple('placed-c', 'Couplé placé C', [2, 3], ranking),
    ].filter(Boolean) : [],
    podiumSelection: ranking.slice(0, podium),
    grandCarnet: {
      podium,
      horses: grandCarnetHorses,
      selectedHorses: grandCarnetHorses.length,
      combinationsCount: combinationCount(grandCarnetHorses.length, podium),
      combinations,
      stake: Number.isFinite(stake) && stake > 0 ? stake : null,
      cost: Number.isFinite(stake) && stake > 0
        ? grandCarnetCost(grandCarnetHorses.length, podium, stake)
        : null,
    },
  };
}

module.exports = {
  normalizeCandidates,
  listCombinations,
  buildNationalBetProposal,
};
