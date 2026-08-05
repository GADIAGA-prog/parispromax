const { parisStartIso } = require('./raceTime');

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

// Pronostic publié : le nombre de places du jeu + 2 compléments.
// Tiercé = 5 chevaux, Quarté = 6 chevaux, Quinté = 7 chevaux.
function groupPicks(picks, race, placesOverride = null) {
  const sorted = (picks || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const raceFormat = predictionFormat(race);
  const places = Number.isInteger(Number(placesOverride)) && Number(placesOverride) > 0
    ? Number(placesOverride)
    : raceFormat.places;
  const format = { label: 'Podium + 2', places, raceLabel: raceFormat.label };
  const selectionSize = Math.min(sorted.length, places + 2);
  // ECD et nationale partagent le meme classement canonique. Seule la
  // longueur du prefixe publie varie selon le jeu.
  const selected = sorted.slice(0, selectionSize);
  const bases = selected.slice(0, 1);
  const couple = selected.slice(0, 2);
  const remaining = selected.slice(2);
  const tocard = remaining
    .filter((p) => Number(p.odds) >= 15 || p.valueBet)
    .filter((p) => p.probaPodium == null || p.probaPodium >= 0.1)
    .sort((a, b) => (b.probaPodium || 0) - (a.probaPodium || 0) || (b.aiScore || 0) - (a.aiScore || 0))[0] || null;
  const tocards = tocard ? [tocard] : [];
  const regret = [...remaining].reverse().find((p) => p.number !== tocard?.number) || null;
  const chances = remaining.filter(
    (p) => p.number !== tocard?.number && p.number !== regret?.number
  );

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
  const ranking = (picks || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const first = ranking[0] || {};
  return {
    ranking,
    topPicks: groups.selected,
    groups,
    predictionMeta: {
      source: first.predictionSource || 'legacy-unversioned',
      modelVersion: first.modelVersion || 'legacy-unversioned',
    },
  };
}

function preRacePredictionPicks(race) {
  const full = parse(race?.raw, {});
  const startMs = Date.parse(parisStartIso(race?.date, full?.time) || '');
  if (!Number.isFinite(startMs)) return [];
  const eligible = (race?.predictions || [])
    .filter((prediction) => {
      const createdMs = new Date(prediction?.createdAt).getTime();
      return Number.isFinite(createdMs) && createdMs <= startMs;
    })
    .sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ));
  for (const prediction of eligible) {
    const picks = parse(prediction?.topPicks, []);
    if (Array.isArray(picks) && picks.length) return picks;
  }
  return [];
}

module.exports = {
  predictionFormat,
  preRacePredictionPicks,
  groupPicks,
  buildPredictionSnapshot,
};
