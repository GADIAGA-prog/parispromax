const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { signToken } = require('../auth');
const { sendSms } = require('../services/sms');

const router = express.Router();

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d+]/g, '');
}

// FedaPay-supported countries (ISO2). Used to validate the signup country.
const SUPPORTED_COUNTRIES = new Set(['bf', 'bj', 'ci', 'tg', 'sn', 'ne', 'gn', 'ml']);
function normalizeCountry(raw) {
  const c = String(raw || '').trim().toLowerCase();
  return SUPPORTED_COUNTRIES.has(c) ? c : null;
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

// Anti-abuse limits on OTP generation (per phone number).
const OTP_MAX_PER_WINDOW = 5;             // max codes...
const OTP_WINDOW_MS = 15 * 60 * 1000;     // ...per 15-minute sliding window
const OTP_MIN_INTERVAL_MS = 30 * 1000;    // min delay between two requests

// POST /auth/request-otp  { phone }
// Generates an OTP, stores it, "sends" it (dev: returned + logged).
router.post('/request-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (phone.length < 8) return res.status(400).json({ error: 'Numéro invalide' });

  // Rate-limit: block bursts (spam/enumeration/SMS-cost abuse).
  const since = new Date(Date.now() - OTP_WINDOW_MS);
  const recent = await prisma.otpCode.findMany({
    where: { phone, createdAt: { gt: since } },
    orderBy: { createdAt: 'desc' },
    take: OTP_MAX_PER_WINDOW,
  });
  if (recent.length >= OTP_MAX_PER_WINDOW) {
    return res.status(429).json({ error: 'Trop de demandes. Réessayez dans quelques minutes.' });
  }
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_MIN_INTERVAL_MS) {
    return res.status(429).json({ error: 'Veuillez patienter avant de redemander un code.' });
  }

  const code = genCode();
  const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60 * 1000);

  await prisma.otpCode.create({ data: { phone, code, expiresAt } });
  const sms = await sendSms(phone, `Votre code ParisPromax : ${code} (valable ${config.otpTtlMinutes} min)`);

  // In production (a real SMS provider is configured) a delivery failure must
  // surface, otherwise the user waits for a code that never arrives. In dev
  // mode the code is returned in the response, so "not delivered" is expected.
  if (!config.otpDevMode && sms && sms.delivered === false) {
    return res.status(502).json({ error: "Échec d'envoi du SMS. Réessayez plus tard." });
  }

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

  const country = normalizeCountry(req.body.country);
  let user = await prisma.user.findUnique({ where: { phone } });
  let isNew = false;
  if (!user) {
    isNew = true;
    // No free trial: new users have no access until they subscribe.
    user = await prisma.user.create({ data: { phone, country } });
  } else if (country && user.country !== country) {
    // Keep the country up to date (e.g. user picked it on a later login).
    user = await prisma.user.update({ where: { id: user.id }, data: { country } });
  }

  const token = signToken(user);
  res.json({ token, user: { id: user.id, phone: user.phone, country: user.country, isNew } });
});

module.exports = router;
