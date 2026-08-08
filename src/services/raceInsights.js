import { BADGES } from './aiEngine';
import { countActiveRunners } from './raceContext';
const { ecdPredictionFormat } = require('../../shared/ecdRules');

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function betText(race) {
  return `${race?.isQuinte ? 'quinte ' : ''}${race?.betType || ''} ${JSON.stringify(race?.bets || [])} ${race?.name || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function detectBetFormat(race, { game = null, mode = null } = {}) {
  if (mode === 'national' && game && Number(game.podium) > 0) {
    return { label: game.label || 'Course nationale', places: Number(game.podium) };
  }
  if (mode === 'ecd' && race?.ecdProfile?.verified === false) {
    return { label: 'Format ECD indisponible', places: 0, available: false };
  }
  if (mode === 'ecd' || (!mode && race?.ecd)) {
    const ecd = ecdPredictionFormat(countActiveRunners(race));
    return { label: ecd.label, places: ecd.podium };
  }
  if (!mode && game && Number(game.podium) > 0) {
    return { label: game.label || 'Course nationale', places: Number(game.podium) };
  }
  const text = betText(race);
  if (text.includes('quinte')) return { label: 'Quinté', places: 5 };
  if (text.includes('quarte')) return { label: 'Quarté', places: 4 };
  if (text.includes('tierce')) return { label: 'Tiercé', places: 3 };
  if (text.includes('trio')) return { label: 'Trio', places: 3 };
  if (text.includes('couple')) return { label: 'Couplé', places: 2 };
  if (text.includes('simple')) return { label: 'Simple', places: 1 };
  return { label: 'Podium', places: 3 };
}

function hasBadge(horse, key) {
  return horse.badges?.some((badge) => badge.key === key);
}

function confidenceFor(horses) {
  if (!horses.length) return { stars: 1, label: 'Données insuffisantes', reasons: [] };
  const first = horses[0];
  const second = horses[1] || first;
  const third = horses[2] || second;
  const gap = number(first.aiScore) - number(third.aiScore);
  const podiumGap = number(first.probaPodium) - number(third.probaPodium);
  const completeness = horses.reduce((sum, horse) => {
    const known = [horse.odds, horse.form, horse.jockey, horse.trainer].filter(Boolean).length;
    return sum + known / 4;
  }, 0) / horses.length;
  const marketLeader = [...horses]
    .filter((horse) => number(horse.odds) > 1)
    .sort((a, b) => number(a.odds, 999) - number(b.odds, 999))[0];
  const agreement = marketLeader && marketLeader.number === first.number;

  let points = 1;
  if (gap >= 5) points += 1;
  if (gap >= 10 || podiumGap >= 0.12) points += 1;
  if (completeness >= 0.65) points += 1;
  if (agreement) points += 1;
  const stars = Math.max(1, Math.min(5, points));
  const reasons = [];
  reasons.push(gap >= 8 ? 'favoris nettement différenciés' : 'course assez ouverte');
  reasons.push(completeness >= 0.65 ? 'données solides' : 'données encore partielles');
  if (marketLeader) reasons.push(agreement ? 'forme et marché concordants' : 'écart entre forme et marché');
  const label = stars >= 4 ? 'Course lisible' : stars === 3 ? 'Confiance mesurée' : 'Risque de surprise';
  return { stars, label, reasons };
}

function tipReasons(horse) {
  const reasons = [];
  if (horse.backendValueBet || hasBadge(horse, BADGES.VALUE.key)) reasons.push('profil intéressant selon les données');
  if (horse.deferrage) reasons.push(`configuration ${horse.deferrage}`);
  if (number(horse.coteOpen) > number(horse.odds) * 1.15) reasons.push('cote en baisse');
  if (number(horse.odds) >= 6 && number(horse.probaPodium) >= 0.22) reasons.push('podium supérieur à sa popularité');
  if (hasBadge(horse, BADGES.CHRONO.key)) reasons.push('meilleur chrono du lot');
  return reasons;
}

export function buildRaceInsights(race, options = {}) {
  const raceFormat = detectBetFormat(race, options);
  const format = {
    label: raceFormat.available === false ? raceFormat.label : `${raceFormat.label} + 2`,
    places: raceFormat.places,
    raceLabel: raceFormat.label,
  };
  const sorted = [...(race?.horses || [])]
    .filter((horse) => horse && horse.nonPartant !== true)
    .sort((a, b) => number(a.rank, 999) - number(b.rank, 999) || number(b.aiScore) - number(a.aiScore));
  if (raceFormat.available === false) {
    return {
      format,
      selectionSize: 0,
      confidence: confidenceFor(sorted),
      bases: [],
      couple: [],
      chances: [],
      outsiders: [],
      tocards: [],
      tocard: null,
      regret: null,
      selected: [],
      tips: [],
    };
  }
  const selectionSize = Math.min(sorted.length, raceFormat.places + 2);
  const confidence = confidenceFor(sorted);
  // Une course possede un classement canonique unique. Les vues ECD et
  // nationale n'en prennent que des prefixes de longueurs differentes.
  const selected = sorted.slice(0, selectionSize);
  const bases = selected.slice(0, 1);
  const couple = selected.slice(0, 2);
  const remaining = selected.slice(2);
  const tocard = remaining
    .filter((horse) => number(horse.odds) >= 15 || horse.backendValueBet || hasBadge(horse, BADGES.VALUE.key))
    .filter((horse) => horse.probaPodium == null || number(horse.probaPodium) >= 0.1)
    .sort((a, b) => number(b.probaPodium) - number(a.probaPodium) || number(b.aiScore) - number(a.aiScore))[0];
  const tocards = tocard ? [tocard] : [];
  const regret = [...remaining].reverse().find((horse) => horse.number !== tocard?.number) || null;
  const chances = remaining.filter(
    (horse) => horse.number !== tocard?.number && horse.number !== regret?.number
  );

  const tips = selected
    .map((horse) => ({ horse, reasons: tipReasons(horse) }))
    .filter((tip) => tip.reasons.length >= 2)
    .sort((a, b) => tipReasons(b.horse).length - tipReasons(a.horse).length || number(b.horse.aiScore) - number(a.horse.aiScore))
    .slice(0, 3);

  return {
    format,
    selectionSize,
    confidence,
    bases,
    couple,
    chances,
    outsiders: tocards,
    tocards,
    tocard: tocards[0] || null,
    regret,
    selected,
    tips,
  };
}

export function combinations(n, k) {
  if (k < 0 || n < k) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

export default { buildRaceInsights, detectBetFormat, combinations };
