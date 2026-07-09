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

  res.json({
    user: { id: user.id, phone: user.phone, country: user.country },
    access: {
      hasAccess: access.hasAccess,
      hasPaid: access.hasPaid,
      plan: access.plan,
      paidUntil: access.paidUntil,
    },
  });
});

// POST /me/recovery-code — régénère le code de récupération (affiché une fois).
// Permet à un utilisateur connecté de (re)noter un code valide s'il a perdu
// celui remis à l'inscription. L'ancien code devient invalide.
router.post('/recovery-code', requireAuth, async (req, res) => {
  const { genRecoveryCode, sha256 } = require('../security');
  const recoveryCode = genRecoveryCode();
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { recoveryCodeHash: sha256(recoveryCode) },
    });
  } catch {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
  res.json({ ok: true, recoveryCode });
});

// DELETE /me — account deletion (Play Store requirement: any app with account
// creation must let the user delete the account in-app). Personal data is
// erased: subscriptions + OTP codes deleted, payments kept for accounting but
// DETACHED from the user (userId -> null), then the user row is removed.
router.delete('/', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  await prisma.$transaction([
    prisma.subscription.deleteMany({ where: { userId: user.id } }),
    prisma.payment.updateMany({ where: { userId: user.id }, data: { userId: null } }),
    prisma.otpCode.deleteMany({ where: { phone: user.phone } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  res.json({ ok: true, deleted: true });
});

module.exports = router;
