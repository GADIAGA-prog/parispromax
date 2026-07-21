const crypto = require('crypto');

// Constant-time string comparison (avoids timing side-channels on secrets).
// Safe on unequal lengths: compares HMACs of both values.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const key = crypto.randomBytes(32);
  const ha = crypto.createHmac('sha256', key).update(a).digest();
  const hb = crypto.createHmac('sha256', key).update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// SHA-256 hex — used to store OTP codes hashed at rest.
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Cryptographically secure 6-digit code (Math.random is predictable).
function genOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

// Code de récupération lisible (reset de mot de passe SANS SMS/email) :
// 8 caractères sans ambiguïté (pas de 0/O/1/I/L), format XXXX-XXXX.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genRecoveryCode() {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    if (i === 3) s += '-';
  }
  return s;
}

// Normalise un code saisi par l'utilisateur (espaces/tirets/casse tolérés).
function normalizeRecoveryCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
}

// --- Password hashing (scrypt, built-in — no extra dependency) ---------------
const SCRYPT_N = 16384; // cost 2^14, ~50ms — fine for a login endpoint
const SCRYPT_KEYLEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 })
    .toString('hex');
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, nStr, salt, hash] = String(stored || '').split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const computed = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, {
      N: Number(nStr) || SCRYPT_N,
      r: 8,
      p: 1,
    });
    return crypto.timingSafeEqual(computed, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// Recovery codes have enough entropy for users to write down, but storing a
// fast SHA-256 digest made an offline database leak unnecessarily easy to brute
// force. New codes use scrypt; the SHA-256 fallback keeps existing accounts
// recoverable and is automatically replaced after the next successful reset.
function hashRecoveryCode(code) {
  return hashPassword(normalizeRecoveryCode(code) || code);
}

function verifyRecoveryCode(code, stored) {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized || !stored) return false;
  if (String(stored).startsWith('scrypt$')) return verifyPassword(normalized, stored);
  return safeEqual(String(stored), sha256(normalized));
}

// Security answers are intentionally normalized before hashing so harmless
// differences in accents, punctuation or repeated spaces do not lock a user
// out. The normalized value is still protected with the same salted scrypt
// construction as passwords and is never stored or logged in plaintext.
function normalizeRecoveryAnswer(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hashRecoveryAnswer(answer) {
  return hashPassword(normalizeRecoveryAnswer(answer));
}

function verifyRecoveryAnswer(answer, stored) {
  const normalized = normalizeRecoveryAnswer(answer);
  return normalized.length >= 2 && verifyPassword(normalized, stored);
}

// Minimal in-memory sliding-window rate limiter (single-instance deploys).
// Usage: app.post('/x', rateLimit({ windowMs: 600000, max: 30 }), handler)
function rateLimit({ windowMs, max, keyFn }) {
  const hits = new Map(); // key -> [timestamps]
  // Periodic cleanup so the map never grows unbounded.
  const cleaner = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const fresh = arr.filter((t) => t > cutoff);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  }, Math.max(windowMs, 60 * 1000));
  if (cleaner.unref) cleaner.unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (hits.get(key) || []).filter((t) => t > cutoff);
    if (arr.length >= max) {
      return res.status(429).json({ error: 'Trop de requêtes. Réessayez plus tard.' });
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

module.exports = {
  safeEqual,
  sha256,
  genOtpCode,
  genRecoveryCode,
  normalizeRecoveryCode,
  hashPassword,
  verifyPassword,
  hashRecoveryCode,
  verifyRecoveryCode,
  normalizeRecoveryAnswer,
  hashRecoveryAnswer,
  verifyRecoveryAnswer,
  rateLimit,
};
