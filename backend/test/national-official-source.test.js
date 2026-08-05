'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nationalDocumentDate,
  parseNationalResultLinks,
  discoverOfficialNationalReport,
  parseNationalReportText,
  taggedNationalRows,
  mergeNationalRows,
  storedNationalReport,
  selectOfficialArrival,
  _test: nationalSourceTest,
} = require('../src/services/nationalOfficialSource');
const { getNationalGame } = require('../../shared/nationalGameRules');
const { evaluateGrandCarnet } = require('../../shared/grandCarnetOutcome');
const { grandCarnetOfficialReport } = require('../src/routes/races')._test;

const tierceText = `
TIERCE DU SAMEDI 01/08/2026
ARR :7 - 11 - 2 NPO:00 NP:00
GAINS
ORDRE : 71 000 1 071
DESORDRE : 14 000 2 054
MAP TIERCE : 104 797 000
GAINS
GAGNANT : 5 500 1 746
PLACE A : 1 500 2 774
`;

const quinteText = `
''4+1'' DU VENDREDI 31/07/2026
ARR : 3 - 4 - 2 - 5 - 8 NPO : 00 NP:00
GAINS NOMBRE GAGNANTS
ORDRE : 19 564 000 4
DESORDRE : 270 000 217
BONUS : 3 500 15 642
MAP "4+1" : 191 593 000
`;

function candidates(numbers) {
  return numbers.map((number) => ({ number, name: `Cheval ${number}` }));
}

test('découvre un rapport PMU B par sa date sans exiger de réunion', () => {
  const html = `
    <div class="views-row">Télécharger les résultats PMU'B du 01 Aout 2026
      <a href="/sites/default/files/2026-08/Res_01_08_2026_TIERCE.pdf">Télécharger</a>
    </div>`;
  assert.equal(nationalDocumentDate('Résultats du 01 Aout 2026'), '2026-08-01');
  assert.deepEqual(parseNationalResultLinks(html, 'https://lonab.bf/resultats-gains-pmub'), [{
    date: '2026-08-01',
    title: "Télécharger les résultats PMU'B du 01 Aout 2026 Télécharger",
    url: 'https://lonab.bf/sites/default/files/2026-08/Res_01_08_2026_TIERCE.pdf',
    kind: 'national-report',
  }]);
});

test('extrait strictement arrivée, ordre et désordre du Tiercé LONAB', () => {
  const report = parseNationalReportText(tierceText);
  assert.equal(report.status, 'complete');
  assert.equal(report.date, '2026-08-01');
  assert.equal(report.podium, 3);
  assert.deepEqual(report.arrivals, [[7, 11, 2]]);
  assert.deepEqual(
    report.payouts.map((row) => [row.kind, row.amount, row.winnerCount]),
    [['order', 71000, 1071], ['disorder', 14000, 2054]]
  );
});

test('le titre 4+1 reste prioritaire sur les lignes Tiercé ou Quarté venant', () => {
  const report = parseNationalReportText(`${quinteText}\nTIERCE V. : 1 500 20`);
  assert.equal(report.status, 'complete');
  assert.equal(report.gameLabel, '4+1');
  assert.equal(report.podium, 5);
  assert.deepEqual(report.arrival, [3, 4, 2, 5, 8]);
  assert.equal(report.payouts.find((row) => row.kind === 'bonus').amount, 3500);
  assert.deepEqual(
    report.payouts.find((row) => row.kind === 'disorder'),
    { kind: 'disorder', bet: 'Désordre', amount: 270000, winnerCount: 217 }
  );
});

test('un rapport 4+1 sans gagnant ordre reste complet et non calculable', () => {
  const report = parseNationalReportText(`
    ''4+1'' DU MERCREDI 20/05/2026
    ARR : 2 - 7 - 4 - 10 - 11 NPO : 00 NP : 00
    ORDRE : - 0
    DESORDRE : 896 000 105
    BONUS : 36 500 1 237
  `);
  assert.equal(report.status, 'complete');
  assert.deepEqual(
    report.payouts.map((row) => [row.kind, row.amount, row.winnerCount]),
    [['order', 0, 0], ['disorder', 896000, 105], ['bonus', 36500, 1237]]
  );
});

test('la découverte nationale atteint au moins la quatrième page du rattrapage', async () => {
  nationalSourceTest.resetCachesForTests();
  const calls = [];
  const http = {
    async get(url) {
      calls.push(url);
      const page = Number(new URL(url).searchParams.get('page') || 0);
      const date = page === 3 ? '01 AOUT 2026' : `${28 - page} JUILLET 2026`;
      return { data: `<div class="views-row">Résultats du ${date}<a href="/report-${page}.pdf">PDF</a></div>` };
    },
  };
  const found = await discoverOfficialNationalReport('bf', '2026-08-01', { http });
  assert.equal(found.page, 3);
  assert.equal(found.report.date, '2026-08-01');
  assert.equal(calls.length, 4);
});

test('conserve les alternatives officielles en cas de dead heat', () => {
  const report = parseNationalReportText(`
    QUARTE DU JEUDI 21/05/2026
    ARR : 4-11-3-6 ou 4-11-6-3 NPO : 00 NP : 2
    ORDRE : 193 500 10
    DESORDRE : 7 500 100
    TIERCE V. : 3 500 50
  `);
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.arrivals, [[4, 11, 3, 6], [4, 11, 6, 3]]);
  assert.deepEqual(selectOfficialArrival(report.arrivals, [4, 11, 6]), [4, 11, 6, 3]);
});

test('fusionne le rapport national sans effacer les gains ECD de la course hybride', () => {
  const report = parseNationalReportText(tierceText);
  const national = taggedNationalRows(report, {
    country: 'bf', operator: 'LONAB', sourceUrl: 'https://lonab.bf/report.pdf',
  });
  const ecd = [{ context: 'ecd', country: 'bf', bet: 'Trio', amount: 5000 }];
  const merged = mergeNationalRows(ecd, national, 'bf');
  assert.equal(merged.filter((row) => row.context === 'ecd').length, 1);
  assert.equal(storedNationalReport(merged, 'bf', '2026-08-01', 3).status, 'complete');
});

test('calcule le rapport ordre ou désordre du Grand Carnet depuis le PDF officiel', () => {
  const game = getNationalGame('bf', '2026-08-01');
  const report = parseNationalReportText(tierceText);
  const officialReport = { status: 'complete', payouts: report.payouts, arrivals: report.arrivals };
  const ordered = evaluateGrandCarnet(
    game,
    candidates([7, 11, 2, 9, 4]),
    report.arrival,
    { officialReport }
  );
  const unordered = evaluateGrandCarnet(
    game,
    candidates([11, 7, 2, 9, 4]),
    report.arrival,
    { officialReport }
  );
  assert.equal(ordered.gainStatus, 'confirmed');
  assert.equal(ordered.gain, 71000);
  assert.equal(ordered.winningBreakdown.order.count, 1);
  assert.equal(unordered.gain, 14000);
  assert.equal(unordered.winningBreakdown.disorder.count, 1);
});

test('aucun rapport reste en attente et seul un rapport réellement incomplet est partiel', () => {
  const date = '2026-08-01';
  const game = getNationalGame('bf', date);
  const arrival = [7, 11, 2];
  const picks = candidates([7, 11, 2, 9, 4]);
  const pending = storedNationalReport([], 'bf', date, 3);
  assert.equal(pending.status, 'pending');
  assert.equal(grandCarnetOfficialReport(pending, { operator: 'LONAB' }), null);
  const waitingOutcome = evaluateGrandCarnet(game, picks, arrival, {
    officialReport: grandCarnetOfficialReport(pending, { operator: 'LONAB' }),
  });
  assert.equal(waitingOutcome.gainStatus, 'pending-official-report');
  const directPendingOutcome = evaluateGrandCarnet(game, picks, arrival, {
    officialReport: { ...pending, operator: 'LONAB' },
  });
  assert.equal(directPendingOutcome.gainStatus, 'pending-official-report');

  const partial = storedNationalReport([{
    country: 'bf',
    context: 'national',
    reportDate: date,
    podium: 3,
    arrivals: [arrival],
    kind: 'order',
    bet: 'Ordre',
    amount: 71000,
    winnerCount: 1,
  }], 'bf', date, 3);
  assert.equal(partial.status, 'partial');
  const partialOutcome = evaluateGrandCarnet(game, picks, arrival, {
    officialReport: grandCarnetOfficialReport(partial, { operator: 'LONAB' }),
  });
  assert.equal(partialOutcome.gainStatus, 'report-partial');
});

test('une arrivée nationale partielle ne peut pas être déclarée perdue', () => {
  const game = getNationalGame('bf', '2026-07-31');
  const outcome = evaluateGrandCarnet(
    game,
    candidates([3, 4, 2, 5, 8, 9, 10]),
    [3, 4, 2],
    { officialReport: null }
  );
  assert.equal(outcome, null);
});

test('additionne les Bonus 4+1 réellement couverts par podium plus 2', () => {
  const game = getNationalGame('bf', '2026-07-31');
  const report = parseNationalReportText(quinteText);
  const outcome = evaluateGrandCarnet(
    game,
    candidates([3, 4, 2, 5, 8, 9, 10]),
    report.arrival,
    { officialReport: { status: 'complete', payouts: report.payouts, arrivals: report.arrivals } }
  );
  assert.equal(outcome.gainStatus, 'confirmed');
  assert.equal(outcome.winningCombinations, 3);
  assert.equal(outcome.winningBreakdown.order.count, 1);
  assert.equal(outcome.winningBreakdown.bonus.count, 2);
  assert.equal(outcome.gain, 19571000);
});

test('un rapport ordre à zéro rend le montant indéterminable sans inventer une perte', () => {
  const game = getNationalGame('bf', '2026-08-01');
  const report = parseNationalReportText(tierceText);
  report.payouts = report.payouts.map((row) => (
    row.kind === 'order' ? { ...row, amount: 0, winnerCount: 0 } : row
  ));
  const outcome = evaluateGrandCarnet(
    game,
    candidates([7, 11, 2, 9, 4]),
    report.arrival,
    { officialReport: { status: 'complete', payouts: report.payouts, arrivals: report.arrivals } }
  );
  assert.equal(outcome.gainStatus, 'official-report-indeterminate');
  assert.equal(outcome.gain, null);
  assert.equal(outcome.netGain, null);
});
