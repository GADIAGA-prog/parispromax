const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBirthDate,
  validateRegistrationProfile,
  questionLabel,
} = require('../src/services/accountRecovery');

const now = new Date('2026-07-21T00:00:00.000Z');

test('valide un profil majeur et une question autorisée', () => {
  const result = validateRegistrationProfile({
    firstName: '  Awa  ',
    lastName: 'Ouédraogo',
    birthDate: '1990-02-28',
    birthPlace: 'Ouagadougou',
    recoveryQuestion: 'first_school',
    recoveryAnswer: 'École Centre',
  }, now);
  assert.equal(result.ok, true);
  assert.equal(result.data.firstName, 'Awa');
  assert.equal(result.data.recoveryAnswer, 'ecole centre');
  assert.match(questionLabel(result.data.recoveryQuestion), /première école/);
});

test('refuse un mineur et une date impossible', () => {
  const minor = validateRegistrationProfile({
    firstName: 'Awa',
    lastName: 'Test',
    birthDate: '2010-01-01',
    birthPlace: 'Ouagadougou',
    recoveryQuestion: 'first_school',
    recoveryAnswer: 'Centre',
  }, now);
  assert.equal(minor.ok, false);
  assert.match(minor.error, /majeures/);
  assert.equal(normalizeBirthDate('2026-02-30'), null);
});
