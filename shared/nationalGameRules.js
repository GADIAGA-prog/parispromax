'use strict';

const countryCatalog = require('./countries.json');
const {
  getBurkinaGame,
  combinationCount,
  grandCarnetCost,
} = require('./burkinaGameRules');

const COUNTRY_NAMES = Object.freeze(
  Object.fromEntries(countryCatalog.map((country) => [country.code, country.name]))
);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferGameFormat(betType) {
  const value = normalize(betType);
  if (value.includes('quinte')) return { label: 'Quinté', podium: 5 };
  if (value.includes('quarte')) return { label: 'Quarté', podium: 4 };
  if (value.includes('tierce')) return { label: 'Tiercé', podium: 3 };
  return null;
}

function buildStrategies(game) {
  const podium = Number(game?.podium);
  const stake = Number(game?.stake);
  if (!Number.isInteger(podium) || podium < 2) return [];

  return [
    { id: 'direct', label: 'Jeu direct', extraHorses: 0, description: 'Une seule combinaison, risque concentré.' },
    { id: 'balanced', label: 'Jeu équilibré', extraHorses: 1, description: 'Un cheval de couverture supplémentaire.' },
    { id: 'coverage', label: 'Couverture intelligente', extraHorses: 2, description: 'Deux compléments pour absorber davantage d’incertitude.' },
  ].map((strategy) => {
    const selectedHorses = podium + strategy.extraHorses;
    const combinations = combinationCount(selectedHorses, podium);
    return {
      ...strategy,
      selectedHorses,
      combinations,
      cost: Number.isFinite(stake) && stake > 0
        ? grandCarnetCost(selectedHorses, podium, stake)
        : null,
    };
  });
}

function enrichGame(game, { country, verified, source }) {
  if (!game) return null;
  const strategies = buildStrategies(game);
  const recommended = strategies.find((strategy) => strategy.id === 'coverage') || null;
  return {
    ...game,
    country,
    countryName: COUNTRY_NAMES[country] || String(country || '').toUpperCase(),
    verified: Boolean(verified),
    source,
    strategies,
    recommendedSelectionSize: recommended?.selectedHorses || game.podium,
    recommendedCombinations: recommended?.combinations || 1,
    recommendedCost: recommended?.cost ?? null,
  };
}

function getNationalGame(countryValue, dateValue, { betType } = {}) {
  const country = String(countryValue || '').trim().toLowerCase();
  if (!country) return null;

  if (country === 'bf') {
    return enrichGame(getBurkinaGame(dateValue), {
      country,
      verified: true,
      source: 'verified-country-calendar',
    });
  }

  const format = inferGameFormat(betType);
  if (!format) return null;
  return enrichGame({
    country,
    date: String(dateValue || ''),
    ...format,
    stake: null,
    currency: 'FCFA',
    schedule: [],
    couples: [],
  }, {
    country,
    verified: false,
    source: 'daily-national-pick',
  });
}

module.exports = {
  COUNTRY_NAMES,
  inferGameFormat,
  buildStrategies,
  getNationalGame,
};
