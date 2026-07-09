const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { signToken } = require('../auth');
const { sendSms } = require('../services/sms');
const {
  sha256,
  genOtpCode,
  genRecoveryCode,
  normalizeRecoveryCode,
  hashPassword,
  verifyPassword,
  rateLimit,
} = require('../security');

const router = express.Router();

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d+]/g, '');
}

// Pays supportés par FeexPay (ISO2) — seuls pays d'inscription autorisés.
// Doit rester aligné avec NETWORKS_BY_COUNTRY dans services/feexpay.js.
const SUPPORTED_COUNTRIES = new Set(['bf', 'bj', 'ci', 'tg', 'sn', 'cg']);
function normalizeCountry(raw) {
  const c = String(raw || '').trim().toLowerCase();
  return SUPPORTED_COUNTRIES.has(c) ? c : null;
}

// Anti-abuse limits on OTP generation (per phone number).
const OTP_MAX_PER_WINDOW = 5;             // max codes...
const OTP_WINDOW_MS = 15 * 60 * 1000;     // ...per 15-minute sliding window
const OTP_MIN_INTERVAL_MS = 30 * 1000;    // min delay between two requests
const OTP_MAX_ATTEMPTS = 5;               // failed guesses before the code dies

// Per-IP rate limits (second layer on top of the per-phone limits, so one IP
// can't spray many phone numbers).
const ipLimitRequest = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });
const ipLimitVerify = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });
const ipLimitLogin = rateLimit({ windowMs: 10 * 60 * 1000, max: 40 });

// --- Connexion par MOT DE PASSE (sans SMS ni email) --------------------------
// Anti-force-brute par numéro : 10 échecs -> verrou 15 minutes (en mémoire,
// suffisant pour un déploiement mono-instance ; l'IP est limitée en plus).
const PWD_MAX_FAILS = 10;
const PWD_LOCK_MS = 15 * 60 * 1000;
const pwdFails = new Map(); // phone -> { count, lockedUntil }

function pwdLocked(phone) {
  const s = pwdFails.get(phone);
  return Boolean(s && s.lockedUntil && Date.now() < s.lockedUntil);
}
function pwdFail(phone) {
  const s = pwdFails.get(phone) || { count: 0, lockedUntil: 0 };
  s.count += 1;
  if (s.count >= PWD_MAX_FAILS) {
    s.lockedUntil = Date.now() + PWD_LOCK_MS;
    s.count = 0;
  }
  pwdFails.set(phone, s);
}
function pwdOk(phone) {
  pwdFails.delete(phone);
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 72;
}

// POST /auth/register  { phone, password, country? }
// Crée le compte (ou pose le mot de passe d'un ancien compte OTP sans mot de
// passe) et retourne un JWT — l'utilisateur est connecté immédiatement.
router.post('/register', ipLimitLogin, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = req.body.password;
  if (phone.length < 8 || phone.length > 16) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }
  if (!validPassword(password)) {
    return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  }

  const country = normalizeCountry(req.body.country);
  let user = await prisma.user.findUnique({ where: { phone } });
  let isNew = false;
  if (user && user.passwordHash) {
    return res.status(409).json({ error: 'Ce numéro a déjà un compte. Connectez-vous.' });
  }
  // Code de récupération : SEUL moyen autonome de réinitialiser le mot de passe
  // (pas de SMS/email). Renvoyé UNE fois en clair ; stocké haché.
  const recoveryCode = genRecoveryCode();
  if (user) {
    // Ancien compte OTP (pré-lancement) sans mot de passe : on le réclame.
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(password),
        recoveryCodeHash: sha256(recoveryCode),
        country: country || user.country,
      },
    });
  } else {
    isNew = true;
    user = await prisma.user.create({
      data: {
        phone,
        passwordHash: hashPassword(password),
        recoveryCodeHash: sha256(recoveryCode),
        country,
      },
    });
  }

  const token = signToken(user);
  res.json({
    token,
    recoveryCode, // à afficher/noter côté app — jamais renvoyé à nouveau
    user: { id: user.id, phone: user.phone, country: user.country, isNew },
  });
});

// POST /auth/reset-password  { phone, recoveryCode, newPassword }
// Réinitialisation AUTONOME (sans back-office) : le code de récupération remis
// à l'inscription prouve la propriété du compte. Un nouveau code est généré et
// renvoyé (l'ancien devient invalide). Connecte l'utilisateur dans la foulée.
router.post('/reset-password', ipLimitLogin, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = normalizeRecoveryCode(req.body.recoveryCode);
  const newPassword = req.body.newPassword;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Numéro ou code de récupération invalide' });
  }
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  }
  if (pwdLocked(phone)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.recoveryCodeHash || user.recoveryCodeHash !== sha256(code)) {
    pwdFail(phone); // partage le verrou anti-force-brute du login
    return res.status(401).json({ error: 'Numéro ou code de récupération incorrect' });
  }
  pwdOk(phone);

  const recoveryCode = genRecoveryCode(); // rotation : l'ancien code est consommé
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword), recoveryCodeHash: sha256(recoveryCode) },
  });

  const token = signToken(updated);
  res.json({
    token,
    recoveryCode,
    user: { id: updated.id, phone: updated.phone, country: updated.country, isNew: false },
  });
});

// POST /auth/login  { phone, password }
router.post('/login', ipLimitLogin, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = req.body.password;
  if (!phone || typeof password !== 'string') {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  if (pwdLocked(phone)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    pwdFail(phone);
    // Même message dans tous les cas (pas d'énumération de comptes).
    return res.status(401).json({ error: 'Numéro ou mot de passe incorrect' });
  }
  pwdOk(phone);

  const country = normalizeCountry(req.body.country);
  const updated =
    country && user.country !== country
      ? await prisma.user.update({ where: { id: user.id }, data: { country } })
      : user;

  const token = signToken(updated);
  res.json({
    token,
    user: { id: updated.id, phone: updated.phone, country: updated.country, isNew: false },
  });
});

// POST /auth/request-otp  { phone }
// Generates an OTP, stores it HASHED, "sends" it (dev: returned + logged).
router.post('/request-otp', ipLimitRequest, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (phone.length < 8 || phone.length > 16) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }

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

  const code = genOtpCode();
  const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60 * 1000);

  // Invalidate previous pending codes for this phone (one active code at a
  // time — a fresh request supersedes older codes).
  await prisma.otpCode.updateMany({
    where: { phone, consumed: false },
    data: { consumed: true },
  });
  await prisma.otpCode.create({ data: { phone, code: sha256(code), expiresAt } });
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
// Brute-force hardened: the active code dies after OTP_MAX_ATTEMPTS bad guesses.
router.post('/verify-otp', ipLimitVerify, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || '').trim();
  if (!phone || !/^\d{4,8}$/.test(code)) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  // Latest ACTIVE code for this phone (fetched by phone, not by code, so we
  // can count failed attempts against it).
  const otp = await prisma.otpCode.findFirst({
    where: { phone, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(400).json({ error: 'Code invalide ou expiré' });
  }

  if (otp.code !== sha256(code)) {
    const updated = await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    if (updated.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
      return res.status(400).json({ error: 'Trop de tentatives. Demandez un nouveau code.' });
    }
    return res.status(400).json({ error: 'Code invalide ou expiré' });
  }

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
