const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { scrapeProgramme } = require('../jobs/scrape');
const { ingestData } = require('../jobs/ingest');
const { detectResults } = require('../jobs/results');

const router = express.Router();

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// Token guard (query ?token= or header x-cron-token). Requires CRON_TOKEN set.
function checkToken(req, res, next) {
  const token = req.query.token || req.headers['x-cron-token'];
  if (!config.cronToken || token !== config.cronToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// The actual heavy work: scrape today's programme (clean replace) + auto-detect
// results for today + yesterday. Runs in the background (can take minutes).
async function runRefresh() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const payload = await scrapeProgramme(today, { maxReunions: 8, maxCourses: 4 });
    if (payload.racetracks.length) {
      const old = await prisma.race.findMany({ where: { date: today }, select: { id: true } });
      const ids = old.map((r) => r.id);
      if (ids.length) {
        await prisma.prediction.deleteMany({ where: { raceId: { in: ids } } });
        await prisma.result.deleteMany({ where: { raceId: { in: ids } } });
        await prisma.race.deleteMany({ where: { id: { in: ids } } });
      }
      const scraped = await ingestData(payload);
      console.log(`[cron] scraped ${scraped} races (${payload.racetracks.length} tracks) for ${today}`);
    }
  } catch (e) {
    console.error('[cron] scrape error:', e.message);
  }
  try {
    const r = await detectResults({ dates: [today, isoDaysAgo(1)] });
    console.log('[cron] results:', r);
  } catch (e) {
    console.error('[cron] results error:', e.message);
  }
}

// POST /cron/refresh — responds immediately (202) and runs the job in the
// background, so the caller (GitHub Actions) never times out.
let running = false;
router.post('/refresh', checkToken, (req, res) => {
  if (running) return res.status(200).json({ ok: true, alreadyRunning: true });
  running = true;
  res.status(202).json({ ok: true, started: true });
  runRefresh().finally(() => { running = false; });
});

module.exports = router;
