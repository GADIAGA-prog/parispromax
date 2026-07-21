const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.DATABASE_URL = 'file:./test.db';
process.env.NODE_ENV = 'test';
const yengapay = require('../src/services/yengapay');

test('les cinq opérateurs Burkina sont exposés avec le bon parcours OTP', () => {
  assert.deepEqual(yengapay.operatorsForCountry('bf'), [
    'ORANGE',
    'MOOV',
    'TELECEL',
    'CORISM',
    'SANKM',
  ]);

  assert.equal(yengapay.requiresOtp('bf', 'ORANGE'), true);
  assert.equal(yengapay.requiresOtp('bf', 'TELECEL'), true);
  assert.equal(yengapay.requiresOtpRequest('MOOV'), false);
  assert.equal(yengapay.requiresOtpRequest('CORISM'), true);
  assert.equal(yengapay.requiresOtpRequest('SANKM'), true);
  assert.equal(yengapay.requiresOtpRequest('ORANGE'), false);
  assert.equal(yengapay.requiresOtpRequest('TELECEL'), false);
});

test('les canaux YengaPay documentés en Côte d’Ivoire sont proposés', () => {
  assert.deepEqual(yengapay.operatorsForCountry('ci'), ['ORANGE', 'MOOV', 'MTN']);
  assert.equal(yengapay.requiresOtp('ci', 'ORANGE'), true);
  assert.equal(yengapay.requiresOtp('ci', 'MOOV'), false);
  assert.equal(yengapay.requiresOtp('ci', 'MTN'), false);
});

test('l’opérateur sélectionné doit être présent dans le PaymentIntent', () => {
  const intent = {
    availableOperators: [
      { code: 'MOOV', countryCode: 'BF', flow: 'TWO_STEP' },
      { code: 'ORANGE', countryCode: 'BF', flow: 'ONE_STEP' },
    ],
  };

  assert.equal(yengapay.availableOperator(intent, 'bf', 'MOOV').flow, 'TWO_STEP');
  assert.equal(yengapay.availableOperator(intent, 'bf', 'TELECEL'), null);
  assert.equal(yengapay.availableOperator(intent, 'ci', 'MOOV'), null);

  const mtnIntent = {
    availableOperators: [{ code: 'MTN_MOMO_CI', countryCode: 'CI', flow: 'TWO_STEP' }],
  };
  assert.equal(yengapay.availableOperator(mtnIntent, 'ci', 'MTN').flow, 'TWO_STEP');
});

test('les statuts terminaux YengaPay sont normalisés', () => {
  assert.equal(yengapay.mapStatus('DONE'), 'success');
  assert.equal(yengapay.mapStatus('COMPLETED'), 'success');
  assert.equal(yengapay.mapStatus('FAILED'), 'failed');
  assert.equal(yengapay.mapStatus('PENDING'), 'pending');
});

test('le webhook vérifie le HMAC x-webhook-hash officiel', () => {
  const body = { paymentStatus: 'DONE', paymentIntentId: 'pi-123' };
  const secret = 'secret-test';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');

  assert.equal(yengapay.verifyWebhookHash(body, signature, secret), true);
  assert.equal(yengapay.verifyWebhookHash(body, `sha256=${signature}`, secret), true);
  assert.equal(yengapay.verifyWebhookHash(body, 'signature-invalide', secret), false);
});

test('les numéros sont normalisés au format international YengaPay', () => {
  assert.equal(yengapay.normalizePhone('70 12 34 56', 'bf'), '+22670123456');
  assert.equal(yengapay.normalizePhone('+225 07 01 02 03 04', 'ci'), '+2250701020304');
});
