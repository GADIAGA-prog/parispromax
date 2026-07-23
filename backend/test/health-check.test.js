const test = require('node:test');
const assert = require('node:assert/strict');
const { livenessCheck, readinessCheck } = require('../src/services/healthCheck');

const fixedTime = new Date('2026-07-23T12:00:00.000Z');

function makeConfig(overrides = {}) {
  return {
    payments: { provider: 'yengapay' },
    yengapay: { mode: 'live' },
    allowMock: false,
    ...overrides,
  };
}

test('le liveness reste local et répond sans dépendance externe', () => {
  const result = livenessCheck({
    revision: 'abcdef123456',
    now: () => fixedTime,
  });

  assert.deepEqual(result, {
    statusCode: 200,
    body: {
      ok: true,
      service: 'parispromax-backend',
      revision: 'abcdef1',
      time: fixedTime.toISOString(),
    },
  });
});

test('le readiness reste prêt si PostgreSQL fonctionne et le paiement est non configuré', async () => {
  const result = await readinessCheck({
    prisma: { $queryRaw: async () => 1 },
    config: makeConfig(),
    getProvider: () => ({ isConfigured: () => false }),
    revision: 'abcdef123456',
    now: () => fixedTime,
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    ok: true,
    service: 'parispromax-backend',
    revision: 'abcdef1',
    database: 'up',
    paymentProvider: 'yengapay',
    paymentMode: 'live',
    payments: 'unavailable',
    time: fixedTime.toISOString(),
  });
});

test('le readiness reste indisponible si PostgreSQL ne répond pas', async () => {
  const result = await readinessCheck({
    prisma: {
      $queryRaw: async () => {
        throw new Error('database unavailable');
      },
    },
    config: makeConfig({ allowMock: true }),
    getProvider: () => ({ isConfigured: () => false }),
    now: () => fixedTime,
  });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {
    ok: false,
    service: 'parispromax-backend',
    database: 'down',
    time: fixedTime.toISOString(),
  });
});
