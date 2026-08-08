'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminRouter = require('../src/routes/admin');
const { storedNationalReport } = require('../src/services/nationalOfficialSource');
const { getNationalGame } = require('../../shared/nationalGameRules');
const { evaluateGrandCarnet } = require('../../shared/grandCarnetOutcome');
const { _test } = adminRouter;

test('tague explicitement les rapports manuels avec leur pays et leur contexte', () => {
  assert.deepEqual(
    _test.tagManualPayoutRows([
      { bet: 'Ordre', numbers: '4-7-1-9', amount: 12000, winnerCount: 3 },
    ], {
      country: 'bf',
      context: 'national',
      reportDate: '2026-08-01',
      podium: 3,
      arrival: [4, 7, 1],
      gameLabel: 'Tiercé',
      operator: 'LONAB',
    }),
    [{
      bet: 'Ordre',
      numbers: '4 - 7 - 1',
      amount: 12000,
      winnerCount: 3,
      country: 'bf',
      context: 'national',
      source: 'admin',
      reportStatus: 'manual',
      reportDate: '2026-08-01',
      podium: 3,
      arrivals: [[4, 7, 1]],
      operator: 'LONAB',
      kind: 'order',
      gameLabel: 'Tiercé',
    }]
  );
});

test('un rapport national manuel est directement exploitable par le Grand Carnet', () => {
  const date = '2026-08-01';
  const arrival = [7, 11, 2];
  const rows = _test.tagManualPayoutRows([
    { bet: 'Ordre', amount: 71000, winnerCount: 1 },
    { bet: 'Désordre', amount: 14000, winnerCount: 2 },
  ], {
    country: 'bf',
    context: 'national',
    reportDate: date,
    podium: 3,
    arrival,
    gameLabel: 'Tiercé',
    operator: 'LONAB',
  });
  const report = storedNationalReport(rows, 'bf', date, 3);
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.arrival, arrival);

  const outcome = evaluateGrandCarnet(
    getNationalGame('bf', date),
    [7, 11, 2, 9, 4].map((number) => ({ number, name: `Cheval ${number}` })),
    arrival,
    { officialReport: report }
  );
  assert.equal(outcome.gainStatus, 'confirmed');
  assert.equal(outcome.gain, 71000);
});

test('remplace seulement les rapports du pays et du contexte visés', () => {
  const existing = [
    { bet: 'Ancien ECD BF' },
    { bet: 'National BF', country: 'bf', context: 'national' },
    { bet: 'ECD CI', country: 'ci', context: 'ecd' },
  ];
  const replacement = [{
    bet: 'Nouveau ECD BF', country: 'bf', context: 'ecd', source: 'admin',
  }];

  assert.deepEqual(
    _test.mergeScopedPayoutRows(existing, replacement, { country: 'bf', context: 'ecd' }),
    [existing[1], existing[2], replacement[0]]
  );
});

test('un tableau vide efface uniquement le bloc de rapports demandé', () => {
  const national = { bet: 'Ordre', country: 'bf', context: 'national' };
  const ecdCi = { bet: 'Trio', country: 'ci', context: 'ecd' };
  assert.deepEqual(
    _test.mergeScopedPayoutRows(
      [{ bet: 'Legacy ECD BF' }, national, ecdCi],
      [],
      { country: 'bf', context: 'ecd' }
    ),
    [national, ecdCi]
  );
});

test('normalise aussi les tags des anciens rapports préservés', () => {
  assert.deepEqual(
    _test.mergeScopedPayoutRows(
      [{ bet: 'Legacy ECD BF' }],
      [{ bet: 'Ordre', country: 'bf', context: 'national' }],
      { country: 'bf', context: 'national' }
    ),
    [
      { bet: 'Legacy ECD BF', country: 'bf', context: 'ecd' },
      { bet: 'Ordre', country: 'bf', context: 'national' },
    ]
  );
});

test('impose le podium maximal des contextes ECD et national de la course', () => {
  assert.equal(_test.maximumRequiredArrival({ hasEcd: true, runnerCount: 6 }), 2);
  assert.equal(_test.maximumRequiredArrival({
    hasEcd: true,
    runnerCount: 6,
    hasNational: true,
    nationalPodium: 5,
  }), 5);
  assert.equal(_test.maximumRequiredArrival({ hasNational: true, nationalPodium: 4 }), 4);
  assert.equal(_test.maximumRequiredArrival(), 3);
});

test('exige un contexte explicite lorsque la course est hybride', () => {
  assert.equal(_test.resolvePayoutContext('', { hasEcd: true }), 'ecd');
  assert.equal(_test.resolvePayoutContext('', { hasNational: true }), 'national');
  assert.equal(_test.resolvePayoutContext('', { hasEcd: true, hasNational: true }), null);
  assert.equal(
    _test.resolvePayoutContext('national', { hasEcd: true, hasNational: true }),
    'national'
  );
  assert.equal(_test.resolvePayoutContext('national', { hasEcd: true }), null);
  assert.equal(_test.resolvePayoutContext('ecd', { hasNational: true }), null);
});

test('la recherche du petit champ ECD est limitée au pays demandé', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.js'),
    'utf8'
  );
  assert.match(
    source,
    /prisma\.ecdPick\.findFirst\(\{[\s\S]*?where: \{ country, date: race\.date, externalId: race\.externalId \}/
  );
  assert.match(source, /Math\.min\(5, podium\)/);
  assert.match(
    source,
    /serializableTransaction\(prisma, async \(tx\)[\s\S]*tx\.result\.findUnique[\s\S]*mergeScopedPayoutRows/
  );
});
