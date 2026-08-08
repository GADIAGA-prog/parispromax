const test = require('node:test');
const assert = require('node:assert/strict');
const {
  triggerOfficialEcdCatchup,
  _test,
} = require('../src/services/officialCatchup');

test('deduplique un rattrapage officiel en cours puis applique un delai de repos', async () => {
  _test.resetForTests();
  let calls = 0;
  let release;
  const syncFn = async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return { ok: true };
  };

  const first = triggerOfficialEcdCatchup({
    country: 'BF',
    dates: ['2026-08-03', '2026-08-02', '2026-08-03'],
    syncFn,
    now: () => 1000,
  });
  const duplicate = triggerOfficialEcdCatchup({
    country: 'bf',
    dates: ['2026-08-02', '2026-08-03'],
    syncFn,
    now: () => 1000,
  });

  assert.equal(first.started, true);
  assert.equal(duplicate.reason, 'already-running');
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await first.task;

  const cooledDown = triggerOfficialEcdCatchup({
    country: 'bf',
    dates: ['2026-08-02', '2026-08-03'],
    syncFn,
    now: () => 2000,
  });
  assert.equal(cooledDown.reason, 'cooldown');
  assert.equal(calls, 1);
});

test('ignore une demande sans date officielle valide', () => {
  _test.resetForTests();
  const result = triggerOfficialEcdCatchup({ country: 'bf', dates: ['demain'] });
  assert.equal(result.reason, 'nothing-to-sync');
});

test('deux ensembles qui se chevauchent ne resynchronisent que la nouvelle date', async () => {
  _test.resetForTests();
  const calls = [];
  let release;
  const syncFn = async ({ dates }) => {
    calls.push(dates);
    if (dates.includes('2026-08-02')) await new Promise((resolve) => { release = resolve; });
    return [];
  };
  const first = triggerOfficialEcdCatchup({
    country: 'bf', dates: ['2026-08-02'], syncFn, now: () => 1000,
  });
  await Promise.resolve();
  const overlap = triggerOfficialEcdCatchup({
    country: 'bf', dates: ['2026-08-02', '2026-08-03'], syncFn, now: () => 1000,
  });
  await overlap.task;
  assert.deepEqual(calls, [['2026-08-02'], ['2026-08-03']]);
  release();
  await first.task;
});

test('un résultat de synchronisation incomplet ne déclenche pas le cooldown', async () => {
  _test.resetForTests();
  const logs = [];
  const failed = triggerOfficialEcdCatchup({
    country: 'bf',
    dates: ['2026-08-04'],
    syncFn: async () => [{ country: 'bf', date: '2026-08-04', payouts: { failed: 1 } }],
    logger: { error: (message) => logs.push(message) },
    now: () => 1000,
  });
  await failed.task;
  const retry = triggerOfficialEcdCatchup({
    country: 'bf', dates: ['2026-08-04'], syncFn: async () => [], now: () => 1001,
  });
  assert.equal(retry.started, true);
  assert.equal(logs.length, 1);
  await retry.task;
});
