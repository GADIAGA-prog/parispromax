import { BADGES } from './aiEngine';

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

export function detectBetFormat(race) {
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
  if (marketLeader) reasons.push(agreement ? 'IA et marché concordants' : 'désaccord IA/marché');
  const label = stars >= 4 ? 'Course lisible' : stars === 3 ? 'Confiance mesurée' : 'Risque de surprise';
  return { stars, label, reasons };
}

function tipReasons(horse) {
  const reasons = [];
  if (horse.backendValueBet || hasBadge(horse, BADGES.VALUE.key)) reasons.push('valeur détectée par l’IA');
  if (horse.deferrage) reasons.push(`configuration ${horse.deferrage}`);
  if (number(horse.coteOpen) > number(horse.odds) * 1.15) reasons.push('cote en baisse');
  if (number(horse.odds) >= 6 && number(horse.probaPodium) >= 0.22) reasons.push('podium supérieur à sa popularité');
  if (hasBadge(horse, BADGES.CHRONO.key)) reasons.push('meilleur chrono du lot');
  return reasons;
}

export function buildRaceInsights(race) {
  const raceFormat = detectBetFormat(race);
  const format = { label: 'Podium + 2', places: 3, raceLabel: raceFormat.label };
  const sorted = [...(race?.horses || [])]
    .filter((horse) => horse && horse.nonPartant !== true)
    .sort((a, b) => number(a.rank, 999) - number(b.rank, 999) || number(b.aiScore) - number(a.aiScore));
  const selectionSize = Math.min(sorted.length, 5);
  const confidence = confidenceFor(sorted);
  const bases = sorted.slice(0, Math.min(1, selectionSize));
  const used = new Set(bases.map((horse) => horse.number));

  // Le couplé associe la base au meilleur cheval restant. La base est répétée
  // dans l'affichage du couplé mais ne compte qu'une fois dans la sélection.
  const couplePartner = sorted.find((horse) => !used.has(horse.number)) || null;
  if (couplePartner) used.add(couplePartner.number);
  const couple = couplePartner ? [...bases, couplePartner] : [...bases];

  const tocard = sorted
    .filter((horse) => !used.has(horse.number))
    .filter((horse) => number(horse.odds) >= 15 || horse.backendValueBet || hasBadge(horse, BADGES.VALUE.key))
    .filter((horse) => horse.probaPodium == null || number(horse.probaPodium) >= 0.08)
    .sort((a, b) => number(b.probaPodium) - number(a.probaPodium) || number(b.aiScore) - number(a.aiScore))[0];

  const fixedCount = bases.length + (couplePartner ? 1 : 0);
  const reserveForTocard = tocard && selectionSize - fixedCount >= 2 ? 1 : 0;
  const reserveForRegret = selectionSize - fixedCount - reserveForTocard >= 1 ? 1 : 0;
  const chanceCount = Math.max(0, selectionSize - fixedCount - reserveForTocard - reserveForRegret);
  const chances = sorted
    .filter((horse) => !used.has(horse.number) && horse.number !== tocard?.number)
    .slice(0, chanceCount);
  chances.forEach((horse) => used.add(horse.number));
  const tocards = reserveForTocard ? [tocard] : [];
  tocards.forEach((horse) => used.add(horse.number));
  let regret = reserveForRegret ? sorted.find((horse) => !used.has(horse.number)) || null : null;

  // La combinaison contient le podium attendu + 2 compléments, dans la limite
  // du nombre réel de partants, sans compter deux fois la base du couplé.
  const selected = [...bases, ...(couplePartner ? [couplePartner] : []), ...chances, ...tocards];
  if (regret && selected.length < selectionSize) selected.push(regret);
  while (selected.length < selectionSize) {
    const next = sorted.find((horse) => !selected.some((item) => item.number === horse.number));
    if (!next) break;
    selected.push(next);
  }
  if (!regret && selected.length) regret = selected[selected.length - 1];

  const tips = sorted
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
