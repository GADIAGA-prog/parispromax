const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countriesForProviderIds,
  publicCountry,
  providerSupportsCountry,
} = require('../src/services/paymentCountries');

function codes(providerIds) {
  return countriesForProviderIds(providerIds).map((country) => country.code);
}

test('YengaPay expose tous ses pays Mobile Money dans le sélecteur', () => {
  assert.deepEqual(codes(['yengapay']), ['bf', 'ci', 'sn', 'tg', 'bj', 'ml', 'ne']);
});

test('la liste fusionne les pays des prestataires actifs sans doublon', () => {
  assert.deepEqual(
    codes(['yengapay', 'feexpay', 'fedapay']),
    ['bf', 'ci', 'sn', 'tg', 'bj', 'ml', 'ne', 'cg', 'gn']
  );
});

test('la réponse publique ne divulgue pas la configuration interne', () => {
  const country = publicCountry(countriesForProviderIds(['yengapay'])[0]);
  assert.equal(country.code, 'bf');
  assert.equal(country.dial, '+226');
  assert.equal(country.nationalLength, 8);
  assert.equal(Object.hasOwn(country, 'providers'), false);
  assert.equal(Object.hasOwn(country, 'keepLeadingZero'), false);
});

test('un prestataire ne peut être proposé que dans un pays qu’il couvre', () => {
  assert.equal(providerSupportsCountry('yengapay', 'ml'), true);
  assert.equal(providerSupportsCountry('feexpay', 'ml'), false);
  assert.equal(providerSupportsCountry('fedapay', 'gn'), true);
});
