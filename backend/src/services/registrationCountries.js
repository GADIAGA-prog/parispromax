const { countryCatalog } = require('./paymentCountries');

// The shared catalogue is the commercial coverage of ParisPromax. Account
// creation must not depend on whether a payment provider happens to be
// configured or temporarily available: payment eligibility is checked only
// when the member starts a payment.
const commercialCountryCodes = new Set(
  countryCatalog.map((country) => String(country.code || '').trim().toLowerCase())
);

function normalizeRegistrationCountry(raw) {
  const code = String(raw || '').trim().toLowerCase();
  return commercialCountryCodes.has(code) ? code : null;
}

function registrationCountryCodes() {
  return [...commercialCountryCodes];
}

module.exports = {
  normalizeRegistrationCountry,
  registrationCountryCodes,
};
