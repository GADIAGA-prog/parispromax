'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  arrivalsCompatible,
  mergeCompatibleArrival,
  serializableTransaction,
} = require('../src/services/officialResultState');

test('une arrivee officielle courte ne tronque jamais les places deja connues', () => {
  assert.deepEqual(
    mergeCompatibleArrival([6, 1, 4, 2, 9], [6, 1, 4]),
    { arrival: [6, 1, 4, 2, 9], compatible: true, changed: false }
  );
  assert.deepEqual(
    mergeCompatibleArrival([6, 1, 4], [6, 1, 4, 2, 9]),
    { arrival: [6, 1, 4, 2, 9], compatible: true, changed: true }
  );
});

test('deux arrivees contradictoires ne sont jamais concatenees artificiellement', () => {
  assert.equal(arrivalsCompatible([6, 1, 4], [6, 2, 7]), false);
  assert.deepEqual(
    mergeCompatibleArrival([6, 1, 4, 2, 9], [6, 2, 7]),
    { arrival: [6, 1, 4, 2, 9], compatible: false, changed: false }
  );
});

test('une collision serialisable relit et rejoue toute la fusion', async () => {
  let attempts = 0;
  const options = [];
  const db = {
    $transaction: async (operation, transactionOptions) => {
      attempts += 1;
      options.push(transactionOptions);
      if (attempts === 1) {
        const error = new Error('write conflict');
        error.code = 'P2034';
        throw error;
      }
      return operation({ committedArrival: [6, 1, 4, 2, 9] });
    },
  };

  const result = await serializableTransaction(
    db,
    async (tx) => mergeCompatibleArrival(tx.committedArrival, [6, 1, 4]).arrival
  );
  assert.equal(attempts, 2);
  assert.deepEqual(options, [
    { isolationLevel: 'Serializable' },
    { isolationLevel: 'Serializable' },
  ]);
  assert.deepEqual(result, [6, 1, 4, 2, 9]);
});

test('une erreur metier non concurrente nest jamais masquee ni rejouee', async () => {
  let attempts = 0;
  const db = {
    $transaction: async () => {
      attempts += 1;
      throw new Error('rapport incompatible');
    },
  };
  await assert.rejects(
    serializableTransaction(db, async () => null),
    /rapport incompatible/
  );
  assert.equal(attempts, 1);
});
