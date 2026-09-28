const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('le modèle reçoit seulement les partants actifs même si les anciens Runner restent en base', async () => {
  const mod = { exports: {} };
  const runners = [1, 2, 3, 4].map(number => ({ number, name: `Cheval ${number}` }));
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/iaClient'), 'utf8'), {
    require: (name) => name === '../db' ? { runner: { findMany: async () => runners } } : {},
    module: mod, process: { env: {} }, console,
  });
  const payload = await mod.exports.buildPayload({ id: 'race', externalId: 'R1C1', distance: '2400m',
    raw: JSON.stringify({ horses: [{ number: 1 }, { number: 2 }, { number: 3 }] }), nonPartants: '[2]' });
  assert.deepEqual(Array.from(payload.runners, runner => runner.number), [1, 3]);
  assert.equal(mod.exports.redis, null);
});
