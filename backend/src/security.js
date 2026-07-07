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

module.exports = { safeEqual, sha256, genOtpCode, rateLimit };
