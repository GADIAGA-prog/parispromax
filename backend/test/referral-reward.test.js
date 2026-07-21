const test = require('node:test');
const assert = require('node:assert/strict');
const {
  referralRewardDays,
  rewardSponsorForFirstSubscription,
} = require('../src/services/subscription');

test('le parrain reçoit la moitié exacte de la durée achetée', () => {
  assert.equal(referralRewardDays(1), 0.5);
  assert.equal(referralRewardDays(7), 3.5);
  assert.equal(referralRewardDays(30), 15);
  assert.equal(referralRewardDays(90), 45);
  assert.equal(referralRewardDays(365), 182.5);
});

test('une durée invalide ne crée aucune récompense', () => {
  assert.equal(referralRewardDays(0), 0);
  assert.equal(referralRewardDays(null), 0);
  assert.equal(referralRewardDays('invalide'), 0);
});

test('la récompense utilise le premier abonnement, jamais le renouvellement courant', async () => {
  const activations = [];
  const db = {
    referral: {
      findUnique: async () => ({ id: 'ref-1', sponsorId: 'parrain', status: 'pending' }),
      updateMany: async () => ({ count: 1 }),
    },
    payment: {
      // Le paiement courant peut être annuel, mais le premier était hebdomadaire.
      findFirst: async (query) => {
        assert.deepEqual(query.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
        return { id: 'premier-paiement', plan: 'weekly', status: 'success' };
      },
    },
  };

  const result = await rewardSponsorForFirstSubscription(
    'filleul',
    db,
    async (...args) => activations.push(args)
  );

  assert.deepEqual(result, { firstPaymentId: 'premier-paiement', rewardDays: 3.5 });
  assert.equal(activations.length, 1);
  assert.deepEqual(activations[0].slice(0, 3), ['parrain', 3.5, 'referral-bonus']);
});

test('une récompense déjà attribuée ne peut pas être doublée', async () => {
  let activated = false;
  const db = {
    referral: {
      findUnique: async () => ({ id: 'ref-1', sponsorId: 'parrain', status: 'rewarded' }),
    },
    payment: { findFirst: async () => { throw new Error('ne doit pas être appelé'); } },
  };

  const result = await rewardSponsorForFirstSubscription(
    'filleul',
    db,
    async () => { activated = true; }
  );

  assert.equal(result, null);
  assert.equal(activated, false);
});
