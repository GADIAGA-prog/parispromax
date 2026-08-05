/* eslint-disable no-console */
const prisma = require('../db');
const { fetchResult } = require('./scrape');
const { fetchPmuResult } = require('./scrapePmu');
const {
  buildPredictionSnapshot,
  preRacePredictionPicks,
} = require('../services/predictionSelection');
const { serializableTransaction } = require('../services/officialResultState');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(value, fallback) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function uniqueWinnerNumbers(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) return [];
    seen.add(number);
    return [number];
  });
}

// A result already stored in the database is the freshest state observed by
// this worker. A slower upstream request may only contain an older prefix, so
// it may extend that state but must never shorten or reorder it.
function mergeLatestArrival(currentValues, fetchedValues) {
  const current = uniqueWinnerNumbers(currentValues);
  const fetched = uniqueWinnerNumbers(fetchedValues);
  if (!current.length) return fetched;
  if (!fetched.length) return current;

  const currentIsFetchedPrefix = current.every((number, index) => fetched[index] === number);
  if (currentIsFetchedPrefix) return fetched;

  const fetchedIsCurrentPrefix = fetched.every((number, index) => current[index] === number);
  if (fetchedIsCurrentPrefix) return current;

  // A non-prefix conflict cannot be merged without inventing positions. Keep
  // the transaction's fresher database value and let a later fetch reconcile it.
  return current;
}

// Keep enough official finishers for every product context. Five covers a
// Quinté; genuinely smaller fields stop at their active runner count.
function requiredArrivalLength(race) {
  const full = parseJson(race?.raw, {});
  const excluded = new Set(uniqueWinnerNumbers(parseJson(race?.nonPartants, [])));
  const active = uniqueWinnerNumbers((full?.horses || []).map((horse) => horse?.number))
    .filter((number) => !excluded.has(number)).length;
  return active > 0 ? Math.min(5, active) : 5;
}

// Stamp the official finishing position onto each Runner row — this is the
// LTR training label. Without it, freshly scraped races never enter the
// training set (only backfilled ones did).
async function stampFinishPositions(raceId, winners, db = prisma) {
  await db.runner.updateMany({ where: { raceId }, data: { finishPos: null } });
  for (let i = 0; i < winners.length; i++) {
    await db.runner.updateMany({
      where: { raceId, number: Number(winners[i]) },
      data: { finishPos: i + 1 },
    });
  }
}

// Auto-detect race results (arrivals) for races that are missing or incomplete, and
// record whether our #1 AI pick placed in the top 3 (drives the real success
// rate). `dates` optionally limits to specific YYYY-MM-DD strings.
async function detectResults({ dates } = {}) {
  const where = {};
  if (dates && dates.length) where.date = { in: dates };

  const races = await prisma.race.findMany({
    where,
    include: {
      result: true,
      predictions: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });

  let recorded = 0;
  let checked = 0;
  let errors = 0;
  let completed = 0;
  let partial = 0;
  for (const race of races) {
    const externalId = String(race.externalId || '');
    const pmu = externalId.match(/^pmu-(\d{4}-\d{2}-\d{2})-R(\d+)-C(\d+)$/i);
    const geny = externalId.match(/^c(\d+)$/i);
    if (!pmu && !geny) continue; // demo races have no supported source id
    const existingWinners = uniqueWinnerNumbers(parseJson(race.result?.winners, []));
    const requiredWinners = requiredArrivalLength(race);
    if (race.result && existingWinners.length >= requiredWinners) continue;
    checked++;

    let winners;
    try {
      winners = pmu
        ? await fetchPmuResult(pmu[1], Number(pmu[2]), Number(pmu[3]))
        : await fetchResult(geny[1]);
    } catch (error) {
      errors++;
      console.warn(`[results] ${race.externalId} ignorée: ${error.message}`);
      await sleep(1200);
      continue;
    }
    await sleep(1200); // politeness
    winners = uniqueWinnerNumbers(winners);
    if (!winners || winners.length < Math.min(3, requiredWinners)) continue; // not run yet
    if (
      race.result
      && winners.length === existingWinners.length
      && winners.every((number, index) => number === existingWinners[index])
    ) continue;

    const picks = preRacePredictionPicks(race);

    try {
      const persisted = await serializableTransaction(prisma, async (tx) => {
        const current = await tx.result.findUnique({ where: { raceId: race.id } });
        const currentWinners = uniqueWinnerNumbers(parseJson(current?.winners, []));
        const mergedWinners = mergeLatestArrival(currentWinners, winners);
        let predictionSnapshot = current?.predictionSnapshot
          || race.result?.predictionSnapshot
          || null;
        let predicted = Boolean(current?.predicted ?? race.result?.predicted);
        if (picks.length && !predictionSnapshot) {
          const top = picks[0];
          // Hit = our #1 AI pick finished in the top 3 (placé).
          predicted = top ? mergedWinners.slice(0, 3).includes(Number(top.number)) : false;
          predictionSnapshot = JSON.stringify(
            buildPredictionSnapshot(picks, race, Math.min(mergedWinners.length, 3))
          );
        }
        await tx.result.upsert({
          where: { raceId: race.id },
          update: {
            winners: JSON.stringify(mergedWinners),
            predictionSnapshot,
            predicted,
          },
          create: {
            raceId: race.id,
            winners: JSON.stringify(mergedWinners),
            predictionSnapshot,
            predicted,
          },
        });
        await stampFinishPositions(race.id, mergedWinners, tx);
        return {
          hadResult: Boolean(current),
          wasComplete: currentWinners.length >= requiredWinners,
          isComplete: mergedWinners.length >= requiredWinners,
        };
      });
      if (persisted.isComplete && !persisted.wasComplete) {
        if (persisted.hadResult) completed++;
        else recorded++;
      } else if (!persisted.isComplete) {
        partial++;
      }
    } catch (error) {
      errors++;
      console.warn(`[results] enregistrement ${race.externalId} ignoré: ${error.message}`);
    }
  }

  console.log(`[results] checked ${checked}, recorded ${recorded}, completed ${completed}, partial ${partial}`);
  return { checked, recorded, completed, partial, errors };
}

if (require.main === module) {
  detectResults()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error('[results] error', e);
      process.exitCode = 1;
    });
}

module.exports = {
  detectResults,
  stampFinishPositions,
  _test: {
    parseJson,
    uniqueWinnerNumbers,
    mergeLatestArrival,
    requiredArrivalLength,
  },
};
