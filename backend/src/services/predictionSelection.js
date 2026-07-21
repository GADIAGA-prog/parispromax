function parse(json, fallback = {}) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function predictionFormat(race) {
  const full = parse(race?.raw, {});
  const text = `${full?.isQuinte ? 'quinte ' : ''}${JSON.stringify(full?.bets || [])} ${race?.name || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (text.includes('quinte')) return { label: 'Quinté', places: 5 };
  if (text.includes('quarte')) return { label: 'Quarté', places: 4 };
  if (text.includes('tierce')) return { label: 'Tiercé', places: 3 };
  if (text.includes('trio')) return { label: 'Trio', places: 3 };
  if (text.includes('couple')) return { label: 'Couplé', places: 2 };
  if (text.includes('simple')) return { label: 'Simple', places: 1 };
  return { label: 'Podium', places: 3 };
}

// Pronostic publié : nombre de chevaux à l'arrivée + 2. Le couplé répète la
// base dans son affichage, mais la sélection ne compte chaque cheval qu'une fois.
function groupPicks(picks, race, placesOverride = null) {
  const sorted = (picks || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const detected = predictionFormat(race);
  const format = Number(placesOverride) > 0
    ? { ...detected, places: Number(placesOverride) }
    : detected;
  const selectionSize = Math.min(sorted.length, format.places + 2);
  const bases = sorted.slice(0, Math.min(1, selectionSize));
  const used = new Set(bases.map((p) => p.number));
  const couplePartner = sorted.find((p) => !used.has(p.number)) || null;
  if (couplePartner) used.add(couplePartner.number);
  const couple = couplePartner ? [...bases, couplePartner] : [...bases];

  const tocard = sorted
    .filter((p) => !used.has(p.number))
    .filter((p) => Number(p.odds) >= 15 || p.valueBet)
    .filter((p) => p.probaPodium == null || p.probaPodium >= 0.1)
    .sort((a, b) => (b.probaPodium || 0) - (a.probaPodium || 0) || (b.aiScore || 0) - (a.aiScore || 0))[0] || null;

  const fixedCount = bases.length + (couplePartner ? 1 : 0);
  const reserveForTocard = tocard && selectionSize - fixedCount >= 2 ? 1 : 0;
  const reserveForRegret = selectionSize - fixedCount - reserveForTocard >= 1 ? 1 : 0;
  const chanceCount = Math.max(0, selectionSize - fixedCount - reserveForTocard - reserveForRegret);
  const chances = sorted
    .filter((p) => !used.has(p.number) && p.number !== tocard?.number)
    .slice(0, chanceCount);
  chances.forEach((p) => used.add(p.number));
  const tocards = reserveForTocard ? [tocard] : [];
  tocards.forEach((p) => used.add(p.number));
  const regret = reserveForRegret ? sorted.find((p) => !used.has(p.number)) || null : null;
  const selected = [...bases, ...(couplePartner ? [couplePartner] : []), ...chances, ...tocards];
  if (regret && selected.length < selectionSize) selected.push(regret);
  while (selected.length < selectionSize) {
    const next = sorted.find((p) => !selected.some((item) => item.number === p.number));
    if (!next) break;
    selected.push(next);
  }

  return {
    format,
    selectionSize,
    bases,
    couple,
    chances,
    outsiders: tocards,
    tocards,
    tocard: tocards[0] || null,
    regret,
    selected,
  };
}

function buildPredictionSnapshot(picks, race, placesOverride = null) {
  const groups = groupPicks(picks, race, placesOverride);
  return { topPicks: groups.selected, groups };
}

module.exports = { predictionFormat, groupPicks, buildPredictionSnapshot };
