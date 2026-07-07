/* eslint-disable no-console */
// Ingestion job: reads the scraped live_races.json, upserts Race rows, and
// stores AI Predictions (top picks) for each race. Run after the scraper:
//
//   node ../src/backend-scraper/scraper.js   (writes live_races.json)
//   node src/jobs/ingest.js                  (loads it into the DB)
//
// Or call ingestFromFile() from a scheduler.

const fs = require('fs');
const path = require('path');
const prisma = require('../db');
const { rankRunners } = require('../services/aiEngine');
const { computeRatings, ratingForHorse, ratingFrom, syncActorStats } = require('./ratings');

const RACES_FILE = path.resolve(__dirname, '../../../src/services/live_races.json');

async function ingestFromFile(file = RACES_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`Fichier de courses introuvable (${file}): ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Fichier de courses illisible/corrompu (${file}): ${e.message}`);
  }
  return ingestData(data);
}

// Ingest a payload object (tracks + races) into the DB with predictions.
async function ingestData(data) {
  const date = data?.meta?.date || new Date().toISOString().slice(0, 10);

  // Real jockey/trainer ratings from accumulated results (empty early on).
  const ratings = await computeRatings();
  await syncActorStats(ratings); // M1/M2 — persist ActorStat for imputation + LTR

  let raceCount = 0;
  for (const track of data.racetracks || []) {
    for (const race of track.races || []) {
      const externalId = race.id || `${track.id}-${race.number}`;
      // Enrich each horse with a real jockey/trainer performance rating so the
      // AI scoring (which weights jockeyRating) reflects who's riding/training.
      (race.horses || []).forEach((h) => {
        h.jockeyRating = ratingForHorse(h, ratings);
      });
      // Store the FULL ranked field (not just the top 5) so paying users get a
      // real AI score for every runner. The LTR daemon also pushes full fields.
      const picks = rankRunners(race);

      const saved = await prisma.race.upsert({
        where: { externalId },
        update: {
          track: track.name,
          name: race.name,
          date,
          discipline: track.discipline || null,
          condition: track.condition || race.condition || null,
          distance: race.distance || null,
          raw: JSON.stringify({ track: track.name, ...race }),
        },
        create: {
          externalId,
          track: track.name,
          name: race.name,
          date,
          discipline: track.discipline || null,
          condition: track.condition || race.condition || null,
          distance: race.distance || null,
          raw: JSON.stringify({ track: track.name, ...race }),
        },
      });

      await prisma.prediction.create({
        data: { raceId: saved.id, topPicks: JSON.stringify(picks) },
      });

      // M1/M2 — persist one normalised Runner row per horse (feeds the LTR model).
      // Critical fields stay optional; ratings are imputed to 50 when unknown.
      await prisma.runner.deleteMany({ where: { raceId: saved.id } });
      const runners = (race.horses || [])
        .filter((h) => Number.isFinite(Number(h.number)) && h.name)
        .map((h) => ({
          raceId: saved.id,
          number: Number(h.number),
          name: String(h.name).trim(),
          jockeyName: h.jockey || null,
          trainerName: h.trainer || null,
          coteFloat: h.coteFloat ?? h.odds ?? null,
          coteOpen: h.coteOpen ?? null,
          gains: Number.isFinite(Number(h.gains)) ? Number(h.gains) : 0,
          chrono: h.chrono ? Number(h.chrono) : null,
          deferrage: h.deferrage || null,
          musiqueRaw: h.musiqueRaw || h.form || null,
          musiqueParsed: h.musiqueParsed ?? null,
          jockeyRating: ratingFrom(ratings.jockey.get(h.jockey)) || 50,
          trainerRating: ratingFrom(ratings.trainer.get(h.trainer)) || 50,
        }));
      if (runners.length) await prisma.runner.createMany({ data: runners });
      raceCount++;
    }
  }
  console.log(`[ingest] ${raceCount} courses ingérées pour ${date}.`);
  return raceCount;
}

// Backfill — reconstruit les lignes Runner pour les courses TERMINÉES qui n'en
// ont pas encore (données historiques piégées dans Race.raw). Parse la musique
// avec le nouveau parseur ; calcule finishPos depuis l'arrivée. Idempotent
// (n'agit que sur les courses sans Runner).
async function backfillRunners() {
  const { parseMusique } = require('../scraper/musique');
  const races = await prisma.race.findMany({
    where: { result: { isNot: null }, runners: { none: {} } },
    include: { result: true },
  });
  let created = 0;
  let skipped = 0;
  for (const race of races) {
    try {
      const raw = JSON.parse(race.raw);
      let winners = [];
      try {
        winners = JSON.parse(race.result.winners);
      } catch {
        winners = [];
      }
      const posByNum = new Map(winners.map((n, i) => [Number(n), i + 1]));
      // Dédoublonnage par numéro (les vieux scrapes contenaient des doublons).
      const seen = new Set();
      const runners = (raw.horses || [])
        .filter((h) => {
          const n = Number(h.number);
          if (!Number.isFinite(n) || !h.name || seen.has(n)) return false;
          seen.add(n);
          return true;
        })
        .map((h) => ({
          raceId: race.id,
          number: Number(h.number),
          name: String(h.name).trim(),
          jockeyName: h.jockey || null,
          trainerName: h.trainer || null,
          coteFloat: h.coteFloat ?? h.odds ?? null,
          coteOpen: null,
          gains: Number.isFinite(Number(h.gains)) ? Number(h.gains) : 0,
          chrono: h.chrono ? Number(h.chrono) : null,
          deferrage: h.deferrage || null,
          musiqueRaw: h.musiqueRaw || h.form || null,
          musiqueParsed: h.musiqueParsed ?? parseMusique(h.form || ''),
          jockeyRating: h.jockeyRating || 50,
          trainerRating: 50,
          finishPos: posByNum.get(Number(h.number)) ?? null,
        }));
      if (runners.length) {
        await prisma.runner.createMany({ data: runners });
        created += runners.length;
      }
    } catch (e) {
      skipped++;
      console.warn(`[backfill] course ${race.externalId} ignorée: ${e.message}`);
    }
  }
  // Passe de réparation : courses terminées dont les Runner existent déjà mais
  // sans finishPos (ingérées avant que detectResults ne pose les labels LTR).
  const { stampFinishPositions } = require('./results');
  const unlabeled = await prisma.race.findMany({
    where: { result: { isNot: null }, runners: { some: { finishPos: null } } },
    include: { result: true },
    take: 2000,
  });
  let stamped = 0;
  for (const race of unlabeled) {
    try {
      const winners = JSON.parse(race.result.winners);
      if (Array.isArray(winners) && winners.length) {
        await stampFinishPositions(race.id, winners);
        stamped++;
      }
    } catch {
      /* winners illisible -> on passe */
    }
  }

  console.log(
    `[backfill] ${races.length} courses -> ${created} Runner créés (${skipped} ignorées, ${stamped} courses re-labellisées).`
  );
  return { races: races.length, runners: created, skipped, stamped };
}

if (require.main === module) {
  ingestFromFile()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error('[ingest] error', e);
      process.exitCode = 1;
    });
}

module.exports = { ingestFromFile, ingestData, backfillRunners, RACES_FILE };
