'use strict';

const countryCatalog = require('./countries.json');

const COUNTRY_NAMES = Object.freeze(
  Object.fromEntries(countryCatalog.map((country) => [country.code, country.name]))
);

const ECD_TRIO_MIN_RUNNERS = 8;

const BURKINA_VARIANTS = Object.freeze([
  Object.freeze({
    id: 'simple-gagnant',
    label: 'Simple gagnant',
    selectionSize: 1,
    description: 'Le cheval doit terminer premier.',
  }),
  Object.freeze({
    id: 'simple-place',
    label: 'Simple placé',
    selectionSize: 1,
    description: 'Le cheval doit terminer dans les trois premiers.',
  }),
  Object.freeze({
    id: 'jumele',
    label: 'Jumelé',
    selectionSize: 2,
    minimumRunners: ECD_TRIO_MIN_RUNNERS,
    description: 'Trouver deux chevaux de l’arrivée selon la formule choisie.',
  }),
  Object.freeze({
    id: 'jumele-ordre',
    label: 'Jumelé ordre',
    selectionSize: 2,
    minimumRunners: 4,
    maximumRunners: ECD_TRIO_MIN_RUNNERS - 1,
    description: 'Trouver les deux premiers chevaux dans l’ordre.',
  }),
  Object.freeze({
    id: 'trio',
    label: 'Trio',
    selectionSize: 3,
    minimumRunners: ECD_TRIO_MIN_RUNNERS,
    description: 'Trouver les trois premiers, quel que soit l’ordre.',
  }),
]);

// Regle ECD LONAB : a partir de 8 partants le podium est un Trio. De 4 a 7,
// il devient un Jumele ordre. Le repli a 3 pour un nombre inconnu evite de presenter
// artificiellement une course comme un petit champ avant son chargement complet.
function ecdPodiumSize(runnersValue) {
  const runners = Number(runnersValue);
  if (!Number.isFinite(runners) || runners <= 0) return 3;
  return runners < ECD_TRIO_MIN_RUNNERS ? 2 : 3;
}

function ecdPredictionFormat(runnersValue) {
  const podium = ecdPodiumSize(runnersValue);
  return {
    label: podium === 2 ? 'Jumelé ordre' : 'Trio',
    podium,
    selectionSize: podium + 2,
    minimumRunnersForTrio: ECD_TRIO_MIN_RUNNERS,
  };
}

function getEcdProfile(countryValue) {
  const country = String(countryValue || '').trim().toLowerCase();
  if (!country || !COUNTRY_NAMES[country]) return null;

  if (country === 'bf') {
    return {
      country,
      countryName: COUNTRY_NAMES[country],
      label: 'ECD · Espaces Courses en Direct',
      shortLabel: 'ECD',
      verified: true,
      source: 'lonab-official-rules',
      unitStake: 500,
      currency: 'FCFA',
      variants: BURKINA_VARIANTS,
      maxMeetings: 2,
      maxRacesPerMeeting: 5,
    };
  }

  return {
    country,
    countryName: COUNTRY_NAMES[country] || country.toUpperCase(),
    label: 'ECD · Courses en direct',
    shortLabel: 'ECD',
    verified: false,
    source: 'country-program',
    unitStake: null,
    currency: 'FCFA',
    variants: [],
    maxMeetings: 2,
    maxRacesPerMeeting: 5,
  };
}

function availableVariants(profile, runnersValue) {
  const runners = Number(runnersValue);
  return (profile?.variants || []).filter(
    (variant) => (!variant.minimumRunners || runners >= variant.minimumRunners)
      && (!variant.maximumRunners || runners <= variant.maximumRunners)
  );
}

module.exports = {
  ECD_TRIO_MIN_RUNNERS,
  BURKINA_VARIANTS,
  ecdPodiumSize,
  ecdPredictionFormat,
  getEcdProfile,
  availableVariants,
};
