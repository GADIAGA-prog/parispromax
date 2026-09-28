const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createDailyRefresh, refreshSlot } = require('../src/services/dailyRefreshScheduler');

test('bascule à minuit GMT même après une collecte réussie la veille', async () => {
  let now = Date.parse('2026-09-27T23:59:00Z');
  const dates = [];
  const scheduler = createDailyRefresh({ now: () => now, refresh: async (date) => {
    dates.push(date);
    return { programmeReady: true };
  } });
  await scheduler.trigger().task;
  assert.equal(scheduler.trigger().reason, 'up-to-date');
  now += 60000;
  await scheduler.trigger().task;
  assert.deepEqual(dates, ['2026-09-27', '2026-09-28']);
  assert.equal(refreshSlot(Date.parse('2026-09-28T02:00:00+02:00')), '2026-09-28:0');
});

test('réessaie après 15 minutes si la source est vide ou échoue', async () => {
  let now = Date.parse('2026-09-28T00:00:00Z');
  let calls = 0;
  const scheduler = createDailyRefresh({ now: () => now, logger: { error() {} }, refresh: async () => {
    calls += 1;
    if (calls === 1) throw new Error('source unavailable');
    return { programmeReady: calls > 2 };
  } });
  await scheduler.trigger().task;
  now += 14 * 60000;
  assert.equal(scheduler.trigger().reason, 'cooldown');
  now += 60000;
  await scheduler.trigger().task;
  now += 15 * 60000;
  await scheduler.trigger().task;
  assert.equal(calls, 3);
  assert.equal(scheduler.trigger().reason, 'up-to-date');
  now += 30 * 60000;
  await scheduler.trigger().task;
  assert.equal(calls, 4);
});

test('cron et minuterie ne lancent pas deux collectes simultanées', async () => {
  let release;
  const scheduler = createDailyRefresh({ refresh: () => new Promise((resolve) => { release = resolve; }) });
  const first = scheduler.trigger();
  await Promise.resolve();
  const second = scheduler.trigger({ force: true });
  assert.equal(second.reason, 'already-running');
  assert.equal(second.task, first.task);
  release({ programmeReady: true });
  await first.task;
});

test('une collecte commencée la veille ne valide pas le nouveau jour', async () => {
  let now = Date.parse('2026-09-27T23:59:00Z');
  let release;
  const scheduler = createDailyRefresh({ now: () => now, refresh: () => new Promise((resolve) => { release = resolve; }) });
  const first = scheduler.trigger();
  await Promise.resolve();
  now += 60000;
  assert.equal(scheduler.trigger().reason, 'already-running');
  release({ programmeReady: true });
  await first.task;
  const next = scheduler.trigger();
  assert.equal(next.started, true);
  await Promise.resolve();
  release({ programmeReady: true });
  await next.task;
});

test('les quatre routes quotidiennes demandent le jour GMT même si la base contient seulement la veille ou demain', async () => {
  const routes = new Map();
  const queries = [];
  const router = { get(path, ...handlers) { routes.set(path, handlers.at(-1)); } };
  const db = {
    race: {
      findFirst() { throw new Error('La dernière date disponible ne doit pas remplacer le jour demandé'); },
      async findMany({ where }) { queries.push(where.date); return []; },
    },
    nationalPick: { async findUnique({ where }) { queries.push(where.date_country.date); return null; } },
    ecdPick: { async findMany() { return []; } },
  };
  const fixed = Date.parse('2026-09-28T00:00:00Z');
  const stubs = {
    express: { Router: () => router },
    '../db': db,
    '../../../shared/nationalGameRules': { getNationalGame: () => null },
    '../../../shared/ecdRules': { getEcdProfile: () => ({}) },
    '../services/ecdOfficialSource': { syncOfficialEcdProgram: async () => null },
    '../services/ecdProgram': { groupSelectedRaces: () => [] },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/races'), 'utf8'), {
    require: (name) => stubs[name] || {}, module: { exports: {} }, console,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } },
  });
  for (const date of [undefined, '2026-09-27']) {
    for (const path of ['/', '/full', '/national', '/ecd']) {
      let body;
      await routes.get(path)({ query: { country: 'bf', date } }, { json(value) { body = value; } });
      assert.equal(body.date || body.meta.date, date || '2026-09-28');
    }
  }
  assert.deepEqual(queries, [...Array(4).fill('2026-09-28'), ...Array(4).fill('2026-09-27')]);
});
