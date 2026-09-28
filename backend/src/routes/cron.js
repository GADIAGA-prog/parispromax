const express = require('express');
const prisma = require('../db');
const config = require('../config');
const dailyRefresh = require('../services/dailyRefresh');
const { detectResults } = require('../jobs/results');
const { syncOfficialResultsData } = require('../services/officialCatchup');

const router = express.Router();

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// Token guard (query ?token= or header x-cron-token). Requires CRON_TOKEN set.
const { safeEqual } = require('../security');
function checkToken(req, res, next) {
  const token = String(req.query.token || req.headers['x-cron-token'] || '');
  if (!config.cronToken || !safeEqual(token, config.cronToken)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Cron and the server timer share one in-flight job.
router.post('/refresh', checkToken, (req, res) => {
  const result = dailyRefresh.trigger({ force: true });
  res.status(result.started ? 202 : 200).json({
    ok: true, started: result.started, alreadyRunning: result.reason === 'already-running',
  });
});

// POST /cron/results — LIGHT & FREQUENT: only detect results (arrivals) for
// today + yesterday. Meant to be polled every ~10 min so results appear
// shortly after each race finishes (no waiting until the evening).
let runningResults = false;
router.post('/results', checkToken, (req, res) => {
  if (runningResults) return res.status(200).json({ ok: true, alreadyRunning: true });
  runningResults = true;
  res.status(202).json({ ok: true, started: true });
  const today = new Date().toISOString().slice(0, 10);
  const dates = [today, isoDaysAgo(1)];
  (async () => {
    try {
      const result = await detectResults({ dates });
      console.log('[cron/results]', result);
    } catch (error) {
      console.error('[cron/results] error:', error.message);
    }
    try {
      const official = await syncOfficialResultsData({ dates });
      console.log('[cron/results] official reports:', official);
    } catch (error) {
      console.error('[cron/results] official ECD error:', error.message);
    }
  })()
    .finally(() => { runningResults = false; });
});

// POST /cron/backfill — reconstruit les Runner des courses passées terminées
// (alimente le jeu LTR). Idempotent. Protégé par le CRON_TOKEN.
// POST /cron/picks — reconcile the national daily pick from races already in
// the database. Kept separate from the heavy refresh so schedulers can verify
// this critical user-facing step after background ingestion has completed.
router.post('/picks', checkToken, async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const rows = await prisma.race.findMany({ where: { date: today } });
    const races = rows.map((row) => {
      try {
        return { ...JSON.parse(row.raw), id: row.externalId };
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (!races.length) return res.status(409).json({ error: 'no races available', date: today });

    const { autoAssignNationalPicks } = require('../jobs/ingest');
    const result = await autoAssignNationalPicks({
      meta: { date: today },
      racetracks: [{ id: 'stored', name: 'Courses du jour', races }],
    });
    res.json({ ok: true, date: today, races: races.length, ...result });
  } catch (error) {
    console.error('[cron/picks] error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

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
