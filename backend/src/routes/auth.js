const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { signToken } = require('../auth');
const { sendSms } = require('../services/sms');

const router = express.Router();

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d+]/g, '');
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

// POST /auth/request-otp  { phone }
// Generates an OTP, stores it, "sends" it (dev: returned + logged).
router.post('/request-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (phone.length < 8) return res.status(400).json({ error: 'Numéro invalide' });

  const code = genCode();
  const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60 * 1000);

  await prisma.otpCode.create({ data: { phone, code, expiresAt } });
  await sendSms(phone, `Votre code ParisPromax : ${code} (valable ${config.otpTtlMinutes} min)`);

  const response = { ok: true, ttlMinutes: config.otpTtlMinutes };
  if (config.otpDevMode) response.devCode = code; // dev convenience only
  res.json(response);
});

// POST /auth/verify-otp  { phone, code }
// Verifies the code, creates the user if new, returns a JWT + profile.
router.post('/verify-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || '').trim();
  if (!phone || !code) return res.status(400).json({ error: 'Champs manquants' });

  const otp = await prisma.otpCode.findFirst({
    where: { phone, code, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) return res.status(400).json({ error: 'Code invalide ou expiré' });

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });

  let user = await prisma.user.findUnique({ where: { phone } });
  let isNew = false;
  if (!user) {
    isNew = true;
    // No free trial: new users have no access until they subscribe.
    user = await prisma.user.create({ data: { phone } });
  }

  const token = signToken(user);
  res.json({ token, user: { id: user.id, phone: user.phone, isNew } });
});

module.exports = router;
