const test = require('node:test');
const assert = require('node:assert/strict');
const { internationalPhone } = require('../src/services/phone');

test('normalise les formats burkinabè vers une seule identité E.164', () => {
  for (const input of ['76 25 15 70', '076251570', '22676251570', '+226 76 25 15 70', '0022676251570']) {
    assert.equal(internationalPhone(input, 'bf'), '+22676251570');
  }
});

test('préserve les zéros nationaux requis par certains catalogues', () => {
  assert.equal(internationalPhone('07 12 34 56 78', 'ci'), '+2250712345678');
  assert.equal(internationalPhone('2250712345678', 'ci'), '+2250712345678');
});

test('rejette une longueur nationale invalide quand le pays est connu', () => {
  assert.equal(internationalPhone('123', 'bf'), null);
  assert.equal(internationalPhone('', 'bf'), null);
});

test("reconnaît un indicatif international exact même sans pays", () => {
  assert.equal(internationalPhone('22676251570'), '+22676251570');
  assert.equal(internationalPhone('+22676251570'), '+22676251570');
  assert.equal(internationalPhone('0022676251570'), '+22676251570');
});
