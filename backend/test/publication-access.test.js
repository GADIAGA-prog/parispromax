const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('le tableau exige une authentification puis un abonnement actif avant de lire les courses', async () => {
  let handlers;
  let reads = 0;
  const requireAuth = () => {};
  const stubs = {
    express: { Router: () => ({ get(_path, ...args) { handlers = args; } }) },
    '../auth': { requireAuth },
    '../db': { user: { findUnique() { reads++; throw new Error('Lecture interdite'); } } },
    '../services/subscription': { getAccess: async () => ({ hasAccess: false, hasPaid: false }) },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/publications'), 'utf8'), {
    require: (name) => stubs[name] || {}, module: { exports: {} }, console,
  });
  assert.equal(handlers[0], requireAuth);
  let status, body;
  await handlers[1]({ userId: 'expired', query: {} }, {
    status(value) { status = value; return this; }, json(value) { body = value; },
  });
  assert.equal(status, 403);
  assert.equal(body.locked, true);
  assert.equal(body.rows, undefined);
  assert.equal(reads, 0);
});
