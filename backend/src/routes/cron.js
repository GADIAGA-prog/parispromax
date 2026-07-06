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
    const payload = await scrapeProgramme(today, { maxReunions: 10, maxCourses: 8 });
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
  runRefresh()
    .catch((e) => console.error('[cron/refresh] unhandled error:', e))
    .finally(() => { running = false; });
});

// POST /cron/results — LIGHT & FREQUENT: only detect results (arrivals) for
// today + yesterday. Meant to be polled every ~15-20 min so results appear
// shortly after each race finishes (no waiting until the evening).
let runningResults = false;
router.post('/results', checkToken, (req, res) => {
  if (runningResults) return res.status(200).json({ ok: true, alreadyRunning: true });
  runningResults = true;
  res.status(202).json({ ok: true, started: true });
  const today = new Date().toISOString().slice(0, 10);
  detectResults({ dates: [today, isoDaysAgo(1)] })
    .then((r) => console.log('[cron/results]', r))
    .catch((e) => console.error('[cron/results] error:', e.message))
    .finally(() => { runningResults = false; });
});

// POST /cron/backfill — reconstruit les Runner des courses passées terminées
// (alimente le jeu LTR). Idempotent. Protégé par le CRON_TOKEN.
router.post('/backfill', checkToken, async (_req, res) => {
  try {
    const { backfillRunners } = require('../jobs/ingest');
    const r = await backfillRunners();
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[cron/backfill] error', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
