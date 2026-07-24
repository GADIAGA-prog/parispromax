const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sha256,
  genRecoveryCode,
  normalizeRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
  normalizeRecoveryAnswer,
  hashRecoveryAnswer,
  verifyRecoveryAnswer,
} = require('../src/security');

test('les nouveaux codes de récupération ont 12 caractères et les anciens restent acceptés', () => {
  const code = genRecoveryCode();
  assert.match(code, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
  assert.equal(normalizeRecoveryCode(code.replaceAll('-', '').toLowerCase()), code);
  assert.equal(normalizeRecoveryCode('ABCD2345'), 'ABCD-2345');
});

test('les nouveaux codes de récupération sont protégés par scrypt', () => {
  const stored = hashRecoveryCode('ABCD-2345-EFGH');
  assert.match(stored, /^scrypt\$/);
  assert.equal(verifyRecoveryCode('abcd 2345 efgh', stored), true);
  assert.equal(verifyRecoveryCode('ABCD-2345-EFGJ', stored), false);
});

test('les anciens condensats SHA-256 restent utilisables pendant la migration', () => {
  const legacy = sha256('ABCD-2345');
  assert.equal(verifyRecoveryCode('ABCD2345', legacy), true);
  assert.equal(verifyRecoveryCode('ZZZZ-9999', legacy), false);
});

test('les réponses secrètes tolèrent accents, casse et ponctuation sans être stockées en clair', () => {
  assert.equal(normalizeRecoveryAnswer('  École Saint-Joseph!  '), 'ecole saint joseph');
  const stored = hashRecoveryAnswer('École Saint-Joseph');
  assert.doesNotMatch(stored, /ecole|saint|joseph/i);
  assert.equal(verifyRecoveryAnswer('ecole  saint joseph!', stored), true);
  assert.equal(verifyRecoveryAnswer('une autre école', stored), false);
});
