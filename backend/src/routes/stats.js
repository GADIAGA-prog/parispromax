const express = require('express');
const prisma = require('../db');

const router = express.Router();

// GET /stats/success-rate — REAL measured hit rate from recorded Results.
// "Hit" = our #1 AI pick finished among the actual placed runners.
// Returns { sampleSize, hits, rate } — rate is null until there's data, so the
// app never shows a fabricated number.
router.get('/success-rate', async (_req, res) => {
  const total = await prisma.result.count();
  const hits = await prisma.result.count({ where: { predicted: true } });
  const rate = total > 0 ? Math.round((hits / total) * 100) : null;
  res.json({ sampleSize: total, hits, rate });
});

module.exports = router;
