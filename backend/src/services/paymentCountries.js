const countryCatalog = require('../../../shared/countries.json');

function countriesForProviderIds(providerIds) {
  const enabled = new Set((providerIds || []).map((id) => String(id).toLowerCase()));
  return countryCatalog.filter((country) =>
    country.providers.some((provider) => enabled.has(provider))
  );
}

function publicCountry(country) {
  const { providers, keepLeadingZero, ...safe } = country;
  return safe;
}

function providerIdsForCountry(code) {
  const country = countryCatalog.find((item) => item.code === String(code || '').toLowerCase());
  return country ? [...country.providers] : [];
}

function providerSupportsCountry(providerId, countryCode) {
  return providerIdsForCountry(countryCode).includes(String(providerId || '').toLowerCase());
}

module.exports = {
  countryCatalog,
  countriesForProviderIds,
  publicCountry,
  providerIdsForCountry,
  providerSupportsCountry,
};
