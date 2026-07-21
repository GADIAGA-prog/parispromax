/* eslint-disable no-console */
const prisma = require('../db');
const { fetchResult } = require('./scrape');
const { fetchPmuResult } = require('./scrapePmu');
const { buildPredictionSnapshot } = require('../services/predictionSelection');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stamp the official finishing position onto each Runner row — this is the
// LTR training label. Without it, freshly scraped races never enter the
// training set (only backfilled ones did).
async function stampFinishPositions(raceId, winners) {
  for (let i = 0; i < winners.length; i++) {
    await prisma.runner.updateMany({
      where: { raceId, number: Number(winners[i]) },
      data: { finishPos: i + 1 },
    });
  }
}

// Auto-detect race results (arrivals) for races that don't have one yet, and
// record whether our #1 AI pick placed in the top 3 (drives the real success
// rate). `dates` optionally limits to specific YYYY-MM-DD strings.
async function detectResults({ dates } = {}) {
  const where = { result: { is: null } };
  if (dates && dates.length) where.date = { in: dates };

  const races = await prisma.race.findMany({
    where,
    include: { predictions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  let recorded = 0;
  let checked = 0;
  for (const race of races) {
    const externalId = String(race.externalId || '');
    const pmu = externalId.match(/^pmu-(\d{4}-\d{2}-\d{2})-R(\d+)-C(\d+)$/i);
    const geny = externalId.match(/^c(\d+)$/i);
    if (!pmu && !geny) continue; // demo races have no supported source id
    checked++;

    const winners = pmu
      ? await fetchPmuResult(pmu[1], Number(pmu[2]), Number(pmu[3]))
      : await fetchResult(geny[1]);
    await sleep(1200); // politeness
    if (!winners || winners.length < 3) continue; // not run yet

    let predicted = false;
    let predictionSnapshot = null;
    if (race.predictions.length) {
      let picks = [];
      try {
        picks = JSON.parse(race.predictions[0].topPicks);
      } catch {
        picks = [];
      }
      const top = picks[0];
      // Hit = our #1 AI pick finished in the top 3 (placé).
      predicted = top ? winners.slice(0, 3).includes(top.number) : false;
      predictionSnapshot = JSON.stringify(
        buildPredictionSnapshot(picks, race, Math.min(winners.length, 5))
      );
    }

    await prisma.result.create({
      data: {
        raceId: race.id,
        winners: JSON.stringify(winners),
        predictionSnapshot,
        predicted,
      },
    });
    await stampFinishPositions(race.id, winners);
    recorded++;
  }

  console.log(`[results] checked ${checked}, recorded ${recorded}`);
  return { checked, recorded };
}

if (require.main === module) {
  detectResults()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error('[results] error', e);
      process.exitCode = 1;
    });
}

module.exports = { detectResults, stampFinishPositions };
