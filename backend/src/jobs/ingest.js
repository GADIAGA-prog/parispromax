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
const { computeRatings, ratingForHorse } = require('./ratings');

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
      raceCount++;
    }
  }
  console.log(`[ingest] ${raceCount} courses ingérées pour ${date}.`);
  return raceCount;
}

if (require.main === module) {
  ingestFromFile()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error('[ingest] error', e);
      process.exitCode = 1;
    });
}

module.exports = { ingestFromFile, ingestData, RACES_FILE };
