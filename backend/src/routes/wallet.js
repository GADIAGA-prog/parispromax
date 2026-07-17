const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
const MAX_AMOUNT = 1_000_000_000;

function amount(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_AMOUNT ? parsed : null;
}

function entryJson(entry) {
  return {
    id: entry.id,
    label: entry.label,
    betType: entry.betType,
    stake: entry.stake,
    winnings: entry.winnings,
    profit: entry.winnings - entry.stake,
    playedAt: entry.playedAt,
  };
}

router.get('/', requireAuth, async (req, res) => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const where = { userId: req.userId };
  const [entries, allAggregate, monthAggregate] = await Promise.all([
    prisma.walletEntry.findMany({
      where, orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }], take: 500,
    }),
    prisma.walletEntry.aggregate({ where, _sum: { stake: true, winnings: true }, _count: true }),
    prisma.walletEntry.aggregate({
      where: { ...where, playedAt: { gte: monthStart, lt: nextMonth } },
      _sum: { stake: true, winnings: true }, _count: true,
    }),
  ]);
  const totals = (aggregate) => {
    const stake = aggregate._sum.stake || 0;
    const winnings = aggregate._sum.winnings || 0;
    return { stake, winnings, profit: winnings - stake, count: aggregate._count };
  };

  res.json({
    entries: entries.map(entryJson),
    summary: totals(allAggregate),
    month: totals(monthAggregate),
  });
});

router.post('/', requireAuth, async (req, res) => {
  const label = String(req.body.label || '').trim().slice(0, 80);
  const betType = String(req.body.betType || '').trim().slice(0, 30) || null;
  const stake = amount(req.body.stake);
  const winnings = amount(req.body.winnings ?? 0);
  const date = String(req.body.date || '').trim();
  if (!label) return res.status(400).json({ error: 'Libellé requis' });
  if (stake == null || stake === 0) return res.status(400).json({ error: 'Mise invalide' });
  if (winnings == null) return res.status(400).json({ error: 'Gain invalide' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Date invalide' });
  const playedAt = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(playedAt.getTime())) return res.status(400).json({ error: 'Date invalide' });

  const entry = await prisma.walletEntry.create({
    data: { userId: req.userId, label, betType, stake, winnings, playedAt },
  });
  res.status(201).json({ entry: entryJson(entry) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const owned = await prisma.walletEntry.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!owned) return res.status(404).json({ error: 'Jeu introuvable' });
  const label = String(req.body.label || '').trim().slice(0, 80);
  const betType = String(req.body.betType || '').trim().slice(0, 30) || null;
  const stake = amount(req.body.stake);
  const winnings = amount(req.body.winnings ?? 0);
  const date = String(req.body.date || '').trim();
  if (!label || stake == null || stake === 0 || winnings == null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Données du jeu invalides' });
  }
  const playedAt = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(playedAt.getTime())) return res.status(400).json({ error: 'Date invalide' });
  const entry = await prisma.walletEntry.update({
    where: { id: owned.id }, data: { label, betType, stake, winnings, playedAt },
  });
  res.json({ entry: entryJson(entry) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const deleted = await prisma.walletEntry.deleteMany({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!deleted.count) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json({ ok: true });
});

module.exports = router;
