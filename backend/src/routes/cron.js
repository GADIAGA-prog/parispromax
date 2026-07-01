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

// POST /cron/refresh — scheduled job entry point:
//   1. scrape today's programme (clean replace)
//   2. auto-detect results for today + yesterday
router.post('/refresh', checkToken, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const result = { date: today, scraped: 0, hippodromes: 0, results: null };

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
      result.scraped = await ingestData(payload);
      result.hippodromes = payload.racetracks.length;
    }
  } catch (e) {
    result.scrapeError = e.message;
  }

  try {
    result.results = await detectResults({ dates: [today, isoDaysAgo(1)] });
  } catch (e) {
    result.resultsError = e.message;
  }

  res.json({ ok: true, ...result });
});

module.exports = router;
