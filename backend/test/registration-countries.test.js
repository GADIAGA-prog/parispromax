const test = require('node:test');
const assert = require('node:assert/strict');
const { countryCatalog, countriesForProviderIds } = require('../src/services/paymentCountries');
const {
  normalizeRegistrationCountry,
  registrationCountryCodes,
} = require('../src/services/registrationCountries');
const {
  isUniqueConstraintOn,
  isTransientDatabaseError,
} = require('../src/services/prismaErrors');

test('l’inscription accepte tout le catalogue commercial sans fournisseur de paiement actif', () => {
  assert.deepEqual(countriesForProviderIds([]), []);
  assert.deepEqual(
    registrationCountryCodes(),
    countryCatalog.map((country) => country.code)
  );
  for (const country of countryCatalog) {
    assert.equal(normalizeRegistrationCountry(country.code), country.code);
  }
});

test('le pays d’inscription est normalisé et un pays hors catalogue est refusé', () => {
  assert.equal(normalizeRegistrationCountry(' BF '), 'bf');
  assert.equal(normalizeRegistrationCountry('fr'), null);
  assert.equal(normalizeRegistrationCountry(''), null);
});

test('une collision Prisma P2002 sur le téléphone est reconnue sans masquer les autres contraintes', () => {
  assert.equal(
    isUniqueConstraintOn({ code: 'P2002', meta: { target: ['phone'] } }, 'phone'),
    true
  );
  assert.equal(
    isUniqueConstraintOn({ code: 'P2002', meta: { target: 'User_phone_key' } }, 'phone'),
    true
  );
  assert.equal(
    isUniqueConstraintOn({ code: 'P2002', meta: { target: ['referralCode'] } }, 'phone'),
    false
  );
  assert.equal(isUniqueConstraintOn({ code: 'P2025' }, 'phone'), false);
});

test('les indisponibilités temporaires PostgreSQL sont distinguées des erreurs métier', () => {
  for (const code of ['P1001', 'P1002', 'P1008', 'P1017', 'P2024']) {
    assert.equal(isTransientDatabaseError({ code }), true);
  }
  assert.equal(
    isTransientDatabaseError({ name: 'PrismaClientInitializationError' }),
    true
  );
  assert.equal(isTransientDatabaseError({ code: 'P2002' }), false);
  assert.equal(isTransientDatabaseError(new Error('validation failed')), false);
});
