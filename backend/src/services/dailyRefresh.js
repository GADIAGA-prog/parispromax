const { scrapeProgramme } = require('../jobs/scrape');
const { ingestData } = require('../jobs/ingest');
const { detectResults } = require('../jobs/results');
const { syncOfficialResultsData } = require('./officialCatchup');
const { createDailyRefresh } = require('./dailyRefreshScheduler');

async function runRefresh(today) {
  let programmeReady = false;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  try {
    // The scheduled refresh runs in the background, so it can load the whole
    // PMU card rather than the smaller, interactive admin preview.
    const payload = await scrapeProgramme(today, { maxReunions: 20, maxCourses: 20 });
    if (payload.racetracks.length) {
      // Assign the declared Quinte as soon as the complete PMU payload exists.
      // This must not depend on the heavier prediction/Runner ingestion below.
      const { autoAssignNationalPicks } = require('../jobs/ingest');
      await autoAssignNationalPicks(payload);

      // ingestData upserts races. Do not delete the date first: doing so erased
      // already detected results and could leave the day empty after a partial
      // upstream response or an ingestion failure.
      const scraped = await ingestData(payload);
      programmeReady = scraped > 0;
      console.log(`[cron] scraped ${scraped} races (${payload.racetracks.length} tracks) for ${today}`);
    }
  } catch (e) {
    console.error('[cron] scrape error:', e.message);
  }
  try {
    const r = await detectResults({ dates: [today, yesterday] });
    console.log('[cron] results:', r);
  } catch (e) {
    console.error('[cron] results error:', e.message);
  }
  try {
    const official = await syncOfficialResultsData({ dates: [today, yesterday] });
    console.log('[cron] official reports:', official);
  } catch (e) {
    console.error('[cron] official ECD error:', e.message);
  }
  return { programmeReady };
}

module.exports = createDailyRefresh({ refresh: runRefresh });
