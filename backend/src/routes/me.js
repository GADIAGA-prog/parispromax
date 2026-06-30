const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../auth');
const { getAccess } = require('../services/subscription');

const router = express.Router();

// GET /me — current user profile + access state (drives the app paywall).
router.get('/', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const access = await getAccess(req.userId);

  const trialMsLeft = access.trialEnd ? Math.max(0, access.trialEnd - Date.now()) : 0;
  res.json({
    user: { id: user.id, phone: user.phone },
    access: {
      hasAccess: access.hasAccess,
      hasPaid: access.hasPaid,
      trialActive: access.trialActive,
      hoursRemaining: Math.ceil(trialMsLeft / (60 * 60 * 1000)),
      paidUntil: access.paidEnd,
    },
  });
});

module.exports = router;
