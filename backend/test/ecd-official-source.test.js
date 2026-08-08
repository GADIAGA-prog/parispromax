const test = require('node:test');
const assert = require('node:assert/strict');
const {
  documentIdentity,
  parseDocumentLinks,
  discoverPaginatedDocuments,
  meetingOneCandidate,
  selectOfficialRaces,
  parseArrivalLine,
  parseLonabReportText,
  payoutRowsFromBlock,
  raceRunnerCount,
  mergeOfficialArrival,
  taggedPayoutRows,
  mergeCountryPayoutRows,
  predictionSnapshot,
  stampOfficialFinishPositions,
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

test('le programme LONAB du 3 août conserve R1 et R3 quand la date est dans le titre', () => {
  const html = `
    <div class="views-row">
      <span>journal hippique ECD du 03 AOÛT 2026 R1</span>
      <a href="/documents/journal-hippique-r1.pdf">Télécharger</a>
    </div>
    <div class="views-row">
      <span>journal hippique ECD du 03 AOÛT 2026 R3</span>
      <a href="/documents/journal-hippique-r3.pdf">Télécharger</a>
    </div>
    <div class="views-row">
      <span>journal hippique ECD du 02 AOÛT 2026 R3</span>
      <a href="/documents/journal-hippique-veille-r3.pdf">Télécharger</a>
    </div>`;
  const documents = parseDocumentLinks(
    html,
    'https://www.lonab.bf/programme-ecd',
    '2026-08-03',
    'program'
  );
  assert.deepEqual(documents.map((item) => item.meeting), [1, 3]);
});

test('la découverte ECD parcourt les pages historiques jusqu’au rapport recherché', async () => {
  const calls = [];
  const http = {
    async get(url) {
      calls.push(url);
      const page = Number(new URL(url).searchParams.get('page') || 0);
      const date = page === 2 ? '03 JUILLET 2026' : `${5 - page} AOUT 2026`;
      return { data: `<div class="views-row">Rapports ECD du ${date} R3<a href="/RAPPORT_ECD_${page}_R3.pdf">PDF</a></div>` };
    },
  };
  const documents = await discoverPaginatedDocuments(
    'https://www.lonab.bf/resultats-gains-ecd',
    '2026-07-03',
    'report',
    { force: true, http, maxPages: 4 }
  );
  assert.equal(documents.length, 1);
  assert.equal(documents[0].date, '2026-07-03');
  assert.equal(documents[0].meeting, 3);
  assert.equal(calls.length, 3);
});

test('retrouve le PDF officiel R1 quand la page LONAB ne référence que R3', () => {
  const candidate = meetingOneCandidate({
    date: '2026-08-03',
    meeting: 3,
    kind: 'program',
    title: 'journal hippique ECD du 03 AOUT 2026 R3',
    url: 'https://www.lonab.bf/sites/default/files/2026-08/JH_ECD_DU-03-08-2026_R3.pdf',
  });
  assert.equal(candidate.meeting, 1);
  assert.equal(
    candidate.url,
    'https://www.lonab.bf/sites/default/files/2026-08/JH_ECD_DU-03-08-2026_R1.pdf'
  );
  assert.match(candidate.title, /R1$/);
});

test('retrouve aussi le rapport de gains R1 depuis le lien officiel R3', () => {
  const candidate = meetingOneCandidate({
    date: '2026-08-03',
    meeting: 3,
    kind: 'report',
    title: 'Rapports ECD du 03 AOUT 2026 R3',
    url: 'https://www.lonab.bf/sites/default/files/2026-08/RAPPORT_ECD_03-08-2026_R3.pdf',
  });
  assert.deepEqual(
    { meeting: candidate.meeting, kind: candidate.kind },
    { meeting: 1, kind: 'report' }
  );
  assert.match(candidate.url, /_R1\.pdf$/);
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

test('deduplique une arrivee de petit champ repetee dans la ligne PDF', () => {
  const parsed = parseArrivalLine('2ieme 8 - 2 - 8 2 550 2 8 - 7 1 550 202');
  assert.deepEqual(parsed, { course: 2, arrival: [8, 2] });
});

test('un ECD de moins de huit partants publie un Jumele sans rapport Trio', () => {
  const text = `
    GAGNANT 8 0 0 JUM GAGNANT 8 - 2 26 850 4
    8 550 9 8 - 2 4 950 49
    2ieme 8 - 2 - 7 2 550 2 8 - 7 1 550 202
    7 550 5 2 - 7 4 950 49
    JUM ORDRE 8 - 2 0 0 TRIO Arrivee 27 350 20
    0 0 0 0`;
  const block = parseLonabReportText(text)[0];
  const rows = payoutRowsFromBlock(block, [8, 2]);

  assert.equal(rows.some((row) => row.bet === 'Trio'), false);
  assert.equal(rows.some((row) => row.bet.includes('ordre')), true);

  const withoutTrioSegment = {
    ...block,
    lines: [...block.lines.slice(0, 4), 'JUM ORDRE 8 - 2 1 250 3'],
  };
  const jumOnly = payoutRowsFromBlock(withoutTrioSegment, [8, 2]);
  assert.deepEqual(jumOnly.find((row) => row.bet.includes('ordre')), {
    bet: 'Jumelé ordre',
    numbers: '8 - 2',
    amount: 1250,
    winnerCount: 3,
  });
});

test('les rapports synchronisés gardent leur pays et préservent les autres opérateurs', () => {
  const lonab = taggedPayoutRows([
    { bet: 'Gagnant', numbers: '8', amount: 550, winnerCount: 2 },
  ], { country: 'bf', operator: 'LONAB' });
  assert.deepEqual(
    { country: lonab[0].country, operator: lonab[0].operator, status: lonab[0].reportStatus },
    { country: 'bf', operator: 'LONAB', status: 'complete' }
  );
  const merged = mergeCountryPayoutRows([
    { bet: 'Gagnant', numbers: '4', amount: 900, country: 'ci', operator: 'LONACI' },
    { bet: 'Gagnant', numbers: '1', amount: 100 },
  ], lonab, 'bf');
  assert.deepEqual(merged.map((row) => row.country || 'legacy-bf'), ['ci', 'bf']);
});

test('un rapport ECD ne tronque ni ne reordonne une arrivee nationale plus longue', () => {
  assert.deepEqual(
    mergeOfficialArrival([8, 2, 7], [8, 2, 7, 4, 11]),
    [8, 2, 7, 4, 11]
  );
  assert.deepEqual(
    mergeOfficialArrival([8, 3, 6], [8, 2, 7, 4, 11]),
    [8, 2, 7, 4, 11]
  );
});

test('dimensionne le snapshot officiel et etiquette les positions Runner', async () => {
  const horses = Array.from({ length: 8 }, (_value, index) => ({
    number: index + 1,
    name: `Cheval ${index + 1}`,
  }));
  const race = {
    id: 'race-1',
    date: '2026-08-04',
    raw: JSON.stringify({ time: '14:00', horses }),
    nonPartants: '[8]',
    predictions: [{
      createdAt: new Date('2026-08-04T11:00:00.000Z'),
      topPicks: JSON.stringify(horses.map((horse, index) => ({ ...horse, rank: index + 1 }))),
    }],
    result: null,
  };
  assert.equal(raceRunnerCount(race), 7);
  const frozen = predictionSnapshot(race, [1, 2]);
  const snapshot = JSON.parse(frozen.snapshot);
  assert.equal(snapshot.groups.format.places, 2);
  assert.equal(snapshot.topPicks.length, 4);

  const writes = [];
  const db = { runner: { updateMany: async (query) => writes.push(query) } };
  const count = await stampOfficialFinishPositions(db, race.id, [4, 2, 4, 7]);
  assert.equal(count, 3);
  assert.deepEqual(writes[0], {
    where: { raceId: 'race-1', finishPos: { lte: 3 } },
    data: { finishPos: null },
  });
  assert.deepEqual(writes.slice(1).map((query) => [query.where.number, query.data.finishPos]), [
    [4, 1], [2, 2], [7, 3],
  ]);
});

test('le snapshot officiel ignore une prediction creee apres le depart', () => {
  const baseRace = {
    id: 'race-time',
    date: '2026-08-04',
    raw: JSON.stringify({
      time: '14:00',
      horses: Array.from({ length: 8 }, (_value, index) => ({ number: index + 1 })),
    }),
    nonPartants: '[]',
    result: null,
  };
  const row = {
    ...baseRace,
    predictions: [
      { createdAt: new Date('2026-08-04T12:30:00Z'), topPicks: '[{"number":8,"rank":1}]' },
      { createdAt: new Date('2026-08-04T11:30:00Z'), topPicks: '[{"number":2,"rank":1}]' },
    ],
  };
  const frozen = predictionSnapshot(row, [2, 5, 7]);
  assert.equal(JSON.parse(frozen.snapshot).ranking[0].number, 2);

  const postRaceOnly = predictionSnapshot({
    ...baseRace,
    predictions: [row.predictions[0]],
  }, [8, 5, 7]);
  assert.equal(postRaceOnly.snapshot, null);
  assert.equal(postRaceOnly.predicted, false);
});
