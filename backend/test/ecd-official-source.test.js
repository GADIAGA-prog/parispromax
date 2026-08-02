const test = require('node:test');
const assert = require('node:assert/strict');
const {
  documentIdentity,
  parseDocumentLinks,
  selectOfficialRaces,
  parseLonabReportText,
  payoutRowsFromBlock,
} = require('../src/services/ecdOfficialSource');

test('identifie la date et la réunion dans les documents officiels ECD', () => {
  assert.deepEqual(
    documentIdentity('Récapitulatif du 02- 08- 2026 - Réunion 3 ECD_02-08-2026_R3.pdf'),
    { date: '2026-08-02', meeting: 3 }
  );
});

test('le programme LONAB du 2 août contient exclusivement R1 et R3', () => {
  const html = `
    <table><tbody>
      <tr><td>journal hippique ECD du 02 AOUT 2026 R1</td><td><a href="/2026/JH_02-08-2026_R1.pdf">Télécharger</a></td></tr>
      <tr><td>journal hippique ECD du 02 AOUT 2026 R3</td><td><a href="/2026/JH_02-08-2026_R3.pdf">Télécharger</a></td></tr>
      <tr><td>journal hippique ECD du 01 AOUT 2026 R4</td><td><a href="/2026/JH_01-08-2026_R4.pdf">Télécharger</a></td></tr>
    </tbody></table>`;
  const documents = parseDocumentLinks(
    html,
    'https://www.lonab.bf/programme-ecd',
    '2026-08-02',
    'program'
  );
  assert.deepEqual(documents.map((item) => item.meeting), [1, 3]);
  assert.match(documents[0].url, /^https:\/\/www\.lonab\.bf\//);
});

test('la sélection officielle conserve toutes les courses de R1 et R3', () => {
  const race = (meeting, course) => ({
    externalId: `pmu-2026-08-02-R${meeting}-C${course}`,
    raw: JSON.stringify({ meetingNumber: meeting, courseNumber: course }),
  });
  const nationalRace = race(1, 3);
  const selected = selectOfficialRaces([
    race(5, 1),
    race(3, 2),
    nationalRace,
    race(1, 1),
    race(3, 1),
  ], [1, 3]);
  assert.deepEqual(selected.map((item) => item.externalId), [
    'pmu-2026-08-02-R1-C1',
    'pmu-2026-08-02-R1-C3',
    'pmu-2026-08-02-R3-C1',
    'pmu-2026-08-02-R3-C2',
  ]);
});

test('extrait les dix rapports d’une course depuis le PDF LONAB', () => {
  const text = `
    GAGNANT 8 0 0 JUM GAGNANT 8 - 2 26 850 4
    8 550 9 8 - 2 4 950 49
    2ième 8 - 2 - 7 2 550 2 8 - 7 1 550 202
    7 550 5 2 - 7 4 950 49
    JUM ORDRE 8 - 2 0 0 TRIO Arrivée 27 350 20
    0 0 0 0`;
  const blocks = parseLonabReportText(text);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].arrival, [8, 2, 7]);

  const rows = payoutRowsFromBlock(blocks[0], blocks[0].arrival);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.find((row) => row.bet === 'Jumelé gagnant'), {
    bet: 'Jumelé gagnant',
    numbers: '8 - 2',
    amount: 26850,
    winnerCount: 4,
  });
  assert.deepEqual(rows.at(-1), {
    bet: 'Trio',
    numbers: '8 - 2 - 7',
    amount: 27350,
    winnerCount: 20,
  });
});
