const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { signToken } = require('../auth');
const { sendSms } = require('../services/sms');
const {
  sha256,
  safeEqual,
  genOtpCode,
  genRecoveryCode,
  normalizeRecoveryCode,
  hashPassword,
  verifyPassword,
  hashRecoveryCode,
  verifyRecoveryCode,
  hashRecoveryAnswer,
  verifyRecoveryAnswer,
  rateLimit,
} = require('../security');

const router = express.Router();
const { ensureReferralCode, normalizeReferralCode } = require('../services/referral');
const { normalizeRegistrationCountry } = require('../services/registrationCountries');
const { isUniqueConstraintOn } = require('../services/prismaErrors');
const { internationalPhone } = require('../services/phone');
const {
  RECOVERY_QUESTIONS,
  cleanText,
  normalizeBirthDate,
  questionLabel,
  validateRegistrationProfile,
} = require('../services/accountRecovery');
const { sendRecoveryRequestEmail } = require('../services/recoveryEmail');

function normalizePhone(raw, country) {
  return internationalPhone(raw, country);
}

// Registration follows the commercial country catalogue. Payment-provider
// availability is evaluated later, when the member actually starts a payment.
function normalizeCountry(raw) {
  return normalizeRegistrationCountry(raw);
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
const ipLimitRecovery = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });

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
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 72;
}

// POST /auth/register  { phone, password, country, identity, recovery Q/A }
// Crée le compte (ou pose le mot de passe d'un ancien compte OTP sans mot de
// passe) et retourne un JWT — l'utilisateur est connecté immédiatement.
router.post('/register', ipLimitLogin, async (req, res) => {
  const phone = normalizePhone(req.body.phone, req.body.country);
  const password = req.body.password;
  if (!phone || phone.length < 8 || phone.length > 16) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }
  if (!validPassword(password)) {
    return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
  }
  const profile = validateRegistrationProfile(req.body);
  if (!profile.ok) return res.status(400).json({ error: profile.error });
  const profileData = {
    firstName: profile.data.firstName,
    lastName: profile.data.lastName,
    birthDate: profile.data.birthDate,
    birthPlace: profile.data.birthPlace,
    recoveryQuestion: profile.data.recoveryQuestion,
    recoveryAnswerHash: hashRecoveryAnswer(profile.data.recoveryAnswer),
  };

  const country = normalizeCountry(req.body.country);
  if (!country) {
    return res.status(400).json({ error: 'Pays non pris en charge par ParisPromax' });
  }
  const referralCode = normalizeReferralCode(req.body.referralCode);
  const sponsor = referralCode ? await prisma.user.findUnique({ where: { referralCode } }) : null;
  if (referralCode && !sponsor) return res.status(400).json({ error: 'Code de parrainage invalide' });
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
    user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(password),
          recoveryCodeHash: hashRecoveryCode(recoveryCode),
          country: country || user.country,
          ...profileData,
        },
      });
      if (sponsor && sponsor.id !== user.id) {
        const used = await tx.referral.findUnique({ where: { referredId: user.id } });
        if (!used) await tx.referral.create({ data: { sponsorId: sponsor.id, referredId: user.id } });
      }
      return updated;
    });
  } else {
    isNew = true;
    try {
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            phone,
            passwordHash: hashPassword(password),
            recoveryCodeHash: hashRecoveryCode(recoveryCode),
            country,
            ...profileData,
          },
        });
        await ensureReferralCode(created.id, tx);
        if (sponsor) await tx.referral.create({ data: { sponsorId: sponsor.id, referredId: created.id } });
        return tx.user.findUnique({ where: { id: created.id } });
      });
    } catch (error) {
      // Two simultaneous registrations can both pass the initial lookup. The
      // database remains the source of truth; map the phone uniqueness race to
      // a normal client conflict instead of exposing an internal error.
      if (isUniqueConstraintOn(error, 'phone')) {
        return res.status(409).json({ error: 'Ce numéro a déjà un compte. Connectez-vous.' });
      }
      throw error;
    }
  }

  if (!user.referralCode) {
    user = { ...user, referralCode: await ensureReferralCode(user.id) };
  }

  const token = signToken(user);
  res.json({
    token,
    recoveryCode, // à afficher/noter côté app — jamais renvoyé à nouveau
    user: {
      id: user.id,
      phone: user.phone,
      country: user.country,
      firstName: user.firstName,
      lastName: user.lastName,
      isNew,
    },
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
    return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
  }
  if (pwdLocked(phone)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !verifyRecoveryCode(code, user.recoveryCodeHash)) {
    pwdFail(phone); // partage le verrou anti-force-brute du login
    return res.status(401).json({ error: 'Numéro ou code de récupération incorrect' });
  }
  pwdOk(phone);

  const recoveryCode = genRecoveryCode(); // rotation : l'ancien code est consommé
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword), recoveryCodeHash: hashRecoveryCode(recoveryCode) },
  });

  const token = signToken(updated);
  res.json({
    token,
    recoveryCode,
    user: {
      id: updated.id,
      phone: updated.phone,
      country: updated.country,
      firstName: updated.firstName,
      lastName: updated.lastName,
      isNew: false,
    },
  });
});

// Public allow-list used by the registration form. No secrets or user data.
router.get('/recovery-questions', (_req, res) => {
  res.json({ questions: RECOVERY_QUESTIONS });
});

// POST /auth/recovery-question { phone }
// Returns only the public question label. The answer and identity fields are
// never returned. Rate-limited to reduce account-enumeration attempts.
router.post('/recovery-question', ipLimitRecovery, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone || phone.length < 8 || phone.length > 16) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { recoveryQuestion: true, recoveryAnswerHash: true },
  });
  const question = user?.recoveryAnswerHash ? questionLabel(user.recoveryQuestion) : null;
  if (!question) {
    return res.status(404).json({
      error: "La récupération par question n'est pas disponible pour ce compte",
    });
  }
  res.json({ question });
});

// POST /auth/reset-password-security { phone, birthDate, answer, newPassword }
// Both the birth date and the scrypt-hashed answer must match. A successful
// reset rotates the paper recovery code too, exactly like the code flow.
router.post('/reset-password-security', ipLimitRecovery, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const birthDate = normalizeBirthDate(req.body.birthDate);
  const answer = req.body.answer;
  const newPassword = req.body.newPassword;
  if (!phone || !birthDate || typeof answer !== 'string') {
    return res.status(400).json({ error: 'Informations de récupération invalides' });
  }
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
  }
  if (pwdLocked(phone)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  const identityMatches = Boolean(
    user?.birthDate &&
    safeEqual(user.birthDate, birthDate) &&
    verifyRecoveryAnswer(answer, user.recoveryAnswerHash)
  );
  if (!identityMatches) {
    pwdFail(phone);
    return res.status(401).json({ error: 'Informations de récupération incorrectes' });
  }
  pwdOk(phone);

  const recoveryCode = genRecoveryCode();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
    },
  });
  const token = signToken(updated);
  res.json({
    token,
    recoveryCode,
    user: {
      id: updated.id,
      phone: updated.phone,
      country: updated.country,
      firstName: updated.firstName,
      lastName: updated.lastName,
      isNew: false,
    },
  });
});

// POST /auth/recovery-request
// Creates a durable request and optionally notifies the private support inbox.
// The destination and SMTP details never appear in the response or mobile app.
router.post('/recovery-request', ipLimitRecovery, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone || phone.length < 8 || phone.length > 16) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }
  const claimedFirstName = cleanText(req.body.firstName, 80);
  const claimedLastName = cleanText(req.body.lastName, 80);
  const claimedBirthDate = normalizeBirthDate(req.body.birthDate);
  const claimedBirthPlace = cleanText(req.body.birthPlace, 120);
  const paymentReference = cleanText(req.body.paymentReference, 120);
  if (
    claimedFirstName.length < 2 ||
    claimedLastName.length < 2 ||
    !claimedBirthDate ||
    claimedBirthPlace.length < 2
  ) {
    return res.status(400).json({ error: "Informations d'identité incomplètes" });
  }

  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  const request = await prisma.recoveryRequest.create({
    data: {
      userId: user?.id || null,
      phone,
      claimedFirstName,
      claimedLastName,
      claimedBirthDate,
      claimedBirthPlace,
      paymentReference: paymentReference || null,
    },
  });

  try {
    const delivery = await sendRecoveryRequestEmail(request);
    if (delivery.sent) {
      await prisma.recoveryRequest.update({
        where: { id: request.id },
        data: { emailSent: true },
      });
    }
  } catch (error) {
    // The durable request remains visible in the back-office. Do not expose
    // SMTP details or account existence to the public caller.
    console.error(`[recovery] email delivery failed for request ${request.id}:`, error.message);
  }

  res.status(202).json({
    ok: true,
    requestId: request.id,
    message: 'Demande transmise au support. Une vérification sera effectuée avant tout changement.',
  });
});

// POST /auth/login  { phone, password }
router.post('/login', ipLimitLogin, async (req, res) => {
  const phone = normalizePhone(req.body.phone, req.body.country);
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

  // Country synchronisation is useful for plans and payments, but it is not
  // part of password verification. A temporary profile-write failure must not
  // prevent an otherwise valid login.
  let updated = user;
  try {
    const country = normalizeCountry(req.body.country);
    if (country && user.country !== country) {
      updated = await prisma.user.update({ where: { id: user.id }, data: { country } });
    }
  } catch (error) {
    console.error('[auth] country sync skipped after valid login:', error.message);
  }

  const token = signToken(updated);
  res.json({
    token,
    user: {
      id: updated.id,
      phone: updated.phone,
      country: updated.country,
      firstName: updated.firstName,
      lastName: updated.lastName,
      isNew: false,
    },
  });
});

// POST /auth/request-otp  { phone }
// Generates an OTP, stores it HASHED, "sends" it (dev: returned + logged).
router.post('/request-otp', ipLimitRequest, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone || phone.length < 8 || phone.length > 16) {
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
  const phone = normalizePhone(req.body.phone, req.body.country);
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

  await ensureReferralCode(user.id);

  const token = signToken(user);
  res.json({ token, user: { id: user.id, phone: user.phone, country: user.country, isNew } });
});

module.exports = router;
