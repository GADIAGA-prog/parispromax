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
const { topPicks } = require('../services/aiEngine');

const RACES_FILE = path.resolve(__dirname, '../../../src/services/live_races.json');

async function ingestFromFile(file = RACES_FILE) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  const date = data?.meta?.date || new Date().toISOString().slice(0, 10);

  let raceCount = 0;
  for (const track of data.racetracks || []) {
    for (const race of track.races || []) {
      const externalId = race.id || `${track.id}-${race.number}`;
      const picks = topPicks(race, 5);

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

module.exports = { ingestFromFile, RACES_FILE };
