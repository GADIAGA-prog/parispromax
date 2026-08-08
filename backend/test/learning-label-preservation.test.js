const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backend = path.join(__dirname, '..');
const ingest = fs.readFileSync(path.join(backend, 'src', 'jobs', 'ingest.js'), 'utf8');
const results = fs.readFileSync(path.join(backend, 'src', 'jobs', 'results.js'), 'utf8');
const admin = fs.readFileSync(path.join(backend, 'src', 'routes', 'admin.js'), 'utf8');
const official = fs.readFileSync(path.join(backend, 'src', 'services', 'ecdOfficialSource.js'), 'utf8');
const cron = fs.readFileSync(path.join(backend, 'src', 'routes', 'cron.js'), 'utf8');

test('un rafraichissement conserve les positions officielles des Runner', () => {
  assert.doesNotMatch(ingest, /runner\.deleteMany/);
  assert.match(ingest, /prisma\.\$transaction\(runners\.map/);
  assert.match(ingest, /where: \{ raceId_number: \{ raceId, number \} \}/);
  assert.match(ingest, /update: mutable/);
  assert.match(ingest, /create: \{ raceId, number, \.\.\.mutable, finishPos: null \}/);
  assert.match(ingest, /if \(process\.env\.REDIS_URL\) await enqueuePrediction\(externalId\)/);
});

test('les snapshots automatiques et manuels excluent les predictions post-depart', () => {
  assert.match(results, /preRacePredictionPicks\(race\)/);
  assert.match(admin, /preRacePredictionPicks\(race\)/);
  assert.match(results, /take: 50/);
  assert.match(admin, /take: 50/);
});

test('une correction d arrivee efface les anciennes positions avant de relabelliser', () => {
  assert.match(results, /updateMany\(\{ where: \{ raceId \}, data: \{ finishPos: null \} \}\)/);
});

test('resultat et positions officielles sont ecrits dans la meme transaction', () => {
  assert.match(results, /serializableTransaction\(prisma, async \(tx\)/);
  assert.match(results, /stampFinishPositions\(race\.id, mergedWinners, tx\)/);
  assert.match(admin, /serializableTransaction\(prisma, async \(tx\)/);
  assert.match(admin, /stampFinishPositions\(race\.id, mergedWinners, tx\)/);
  assert.match(official, /serializableTransaction\(db, async \(tx\)/);
  assert.match(official, /stampOfficialFinishPositions\(tx, race\.id, officialArrival\)/);
});

test('les echecs PMU et PDF restent isoles sans bloquer les rapports suivants', () => {
  assert.match(results, /for \(const race of races\)[\s\S]*catch \(error\)[\s\S]*continue;/);
  assert.match(official, /for \(const report of documents\.reports\)[\s\S]*failures\.push/);
  assert.match(cron, /detectResults\(\{ dates \}\)[\s\S]*syncOfficialResultsData\(\{ dates \}\)/);
});

test('le minimum manuel suit le podium maximal des contextes du pays demandé', () => {
  assert.match(admin, /const runnerCount = raceRunnerCount\(race\)/);
  assert.match(admin, /where: \{ country, date: race\.date, externalId: race\.externalId \}/);
  assert.match(admin, /const minimumArrival = maximumRequiredArrival\(/);
  assert.match(admin, /hasNational: Boolean\(nationalPick\)/);
});
