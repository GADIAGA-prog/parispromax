const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateContactSubmission,
  validateReviewSubmission,
} = require('../src/services/feedback');

test('valide et nettoie un message de contact', () => {
  const result = validateContactSubmission({
    name: '  Awa   Traoré ',
    contact: 'awa@example.com',
    subject: 'payment',
    message: 'Bonjour, je souhaite vérifier mon paiement.',
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.name, 'Awa Traoré');
  assert.equal(result.data.subject, 'payment');
});

test('refuse un sujet de contact inconnu et un message trop court', () => {
  assert.equal(validateContactSubmission({ name: 'Awa', contact: '+22670000000', subject: 'hack', message: 'Bonjour test' }).ok, false);
  assert.equal(validateContactSubmission({ name: 'Awa', contact: '+22670000000', subject: 'general', message: 'Court' }).ok, false);
});

test('accepte une appréciation anonyme entre une et cinq étoiles', () => {
  const result = validateReviewSubmission({ rating: 5, comment: 'Service très clair.' });
  assert.equal(result.ok, true);
  assert.equal(result.data.name, null);
  assert.equal(result.data.rating, 5);
});

test('refuse une note hors limites', () => {
  assert.equal(validateReviewSubmission({ rating: 0, comment: 'Avis' }).ok, false);
  assert.equal(validateReviewSubmission({ rating: 6, comment: 'Avis' }).ok, false);
  assert.equal(validateReviewSubmission({ rating: 4.5, comment: 'Avis' }).ok, false);
});
