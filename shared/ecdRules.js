'use strict';

const countryCatalog = require('./countries.json');

const COUNTRY_NAMES = Object.freeze(
  Object.fromEntries(countryCatalog.map((country) => [country.code, country.name]))
);

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
    description: 'Trouver deux chevaux de l’arrivée selon la formule choisie.',
  }),
  Object.freeze({
    id: 'trio',
    label: 'Trio',
    selectionSize: 3,
    minimumRunners: 8,
    description: 'Trouver les trois premiers, quel que soit l’ordre.',
  }),
]);

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
    (variant) => !variant.minimumRunners || runners >= variant.minimumRunners
  );
}

module.exports = {
  BURKINA_VARIANTS,
  getEcdProfile,
  availableVariants,
};
