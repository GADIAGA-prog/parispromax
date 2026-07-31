'use strict';

const BURKINA_SCHEDULE = Object.freeze([
  Object.freeze({
    label: 'Quinté',
    days: 'Dimanche, mercredi et vendredi',
    note: 'Également le dernier mardi du mois',
    podium: 5,
    stake: 300,
  }),
  Object.freeze({
    label: 'Quarté',
    days: 'Lundi, mardi et jeudi',
    note: 'Sauf le dernier mardi du mois',
    podium: 4,
    stake: 200,
  }),
  Object.freeze({
    label: 'Tiercé',
    days: 'Chaque samedi',
    note: 'Les 3 premiers de la course nationale',
    podium: 3,
    stake: 200,
  }),
]);

const BURKINA_COUPLES = Object.freeze([
  Object.freeze({ label: 'Couplé gagnant', positions: [1, 2], description: '1er et 2e à l’arrivée' }),
  Object.freeze({ label: 'Couplé placé A', positions: [1, 2], description: '1er et 2e à l’arrivée' }),
  Object.freeze({ label: 'Couplé placé B', positions: [1, 3], description: '1er et 3e à l’arrivée' }),
  Object.freeze({ label: 'Couplé placé C', positions: [2, 3], description: '2e et 3e à l’arrivée' }),
]);

const BURKINA_COUPLE_STAKE = 500;

function parseIsoDate(dateValue) {
  const value = String(dateValue || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLastTuesday(date) {
  return date.getUTCDay() === 2
    && new Date(date.getTime() + (7 * 24 * 60 * 60 * 1000)).getUTCMonth() !== date.getUTCMonth();
}

function getBurkinaGame(dateValue) {
  const date = parseIsoDate(dateValue);
  if (!date) return null;

  const day = date.getUTCDay();
  const lastTuesday = isLastTuesday(date);
  let label;
  let podium;
  let stake;

  if (day === 6) {
    label = 'Tiercé';
    podium = 3;
    stake = 200;
  } else if (day === 1 || day === 4 || (day === 2 && !lastTuesday)) {
    label = 'Quarté';
    podium = 4;
    stake = 200;
  } else {
    label = 'Quinté';
    podium = 5;
    stake = 300;
  }

  return {
    country: 'bf',
    date: String(dateValue),
    label,
    podium,
    stake,
    coupleStake: BURKINA_COUPLE_STAKE,
    currency: 'FCFA',
    isLastTuesday: lastTuesday,
    schedule: BURKINA_SCHEDULE,
    couples: BURKINA_COUPLES,
  };
}

function combinationCount(selectedHorses, podium) {
  const n = Number(selectedHorses);
  const k = Number(podium);
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < k || k < 0) return 0;
  const smallerSide = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= smallerSide; index += 1) {
    result = (result * (n - smallerSide + index)) / index;
  }
  return Math.round(result);
}

function grandCarnetCost(selectedHorses, podium, stake) {
  return combinationCount(selectedHorses, podium) * Number(stake || 0);
}

module.exports = {
  BURKINA_SCHEDULE,
  BURKINA_COUPLES,
  BURKINA_COUPLE_STAKE,
  getBurkinaGame,
  combinationCount,
  grandCarnetCost,
};
