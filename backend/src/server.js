const express = require('express');
const http = require('http');
const cors = require('cors');
const config = require('./config');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const paymentRoutes = require('./routes/payments');
const planRoutes = require('./routes/plans');
const raceRoutes = require('./routes/races');
const cronRoutes = require('./routes/cron');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const mlRoutes = require('./routes/ml');
const legalRoutes = require('./routes/legal');

const app = express();

// Behind Render's proxy: makes req.ip the real client IP (rate limiting).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Minimal security headers (helmet-lite, no extra dependency).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  if (config.isProd) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS: mobile apps send no Origin so are always allowed. When CORS_ORIGINS is
// set, only those browser origins are allowed (real enforcement). When it is
// left empty (dev), all origins are allowed for convenience.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Origine non autorisée par CORS'));
    },
  })
);

// NOTE: payment webhook needs the raw-ish body but we use JSON/urlencoded per route.
app.use(express.json({ limit: '200kb' }));

app.get('/health', (_req, res) => {
  const provider = config.payments.provider;
  const configured =
    provider === 'cinetpay' ? config.cinetpay.configured : config.fedapay.configured;
  const mode = provider === 'cinetpay' ? config.cinetpay.mode : config.fedapay.mode;
  res.json({
    ok: true,
    service: 'parispromax-backend',
    paymentProvider: provider,
    paymentMode: mode, // sandbox | live (non-secret, for diagnostics)
    payments: configured ? 'configured' : 'mock',
    time: new Date().toISOString(),
  });
});

// Friendly landing page so the root URL isn't a bare "Not found".
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>ParisPromax API</title>
  <style>body{margin:0;background:#0f172a;color:#f8fafc;font-family:system-ui,Arial,sans-serif;
  display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
  .card{background:#111c33;border:1px solid #1e293b;border-radius:16px;padding:36px;max-width:420px}
  h1{color:#10b981;margin:0 0 8px} a{display:inline-block;margin:6px;padding:10px 18px;border-radius:10px;
  background:#10b981;color:#06251c;font-weight:800;text-decoration:none}
  .muted{color:#94a3b8;font-size:14px}</style></head>
  <body><div class="card">
  <h1>🏇 ParisPromax API</h1>
  <p class="muted">Le serveur fonctionne. Ceci est l'API ; il n'y a pas de page publique ici.</p>
  <a href="/admin">Back-office</a><a href="/health">État</a>
  <p class="muted"><a href="/legal/privacy" style="background:none;color:#94a3b8;font-weight:400">Confidentialité</a> ·
  <a href="/legal/terms" style="background:none;color:#94a3b8;font-weight:400">Conditions</a> ·
  <a href="/legal/account-deletion" style="background:none;color:#94a3b8;font-weight:400">Suppression de compte</a></p>
  </div></body></html>`);
});

app.use('/auth', authRoutes);
app.use('/me', meRoutes);
app.use('/payments', paymentRoutes);
app.use('/plans', planRoutes);
app.use('/races', raceRoutes);
app.use('/cron', cronRoutes);
app.use('/stats', statsRoutes);
app.use('/admin', adminRoutes);
app.use('/ml', mlRoutes);
app.use('/legal', legalRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

// M3 — serveur HTTP (permet d'attacher socket.io). Le temps réel + le worker IA
// ne s'activent QUE si REDIS_URL est configuré (la prod actuelle reste intacte).
const server = http.createServer(app);
let realtimeOn = false;
if (process.env.REDIS_URL) {
  try {
    require('./services/realtime').initRealtime(server);
    require('./services/queue').startPredictionWorker();
    realtimeOn = true;
  } catch (e) {
    console.error('[realtime] init failed (deps installées ?):', e.message);
  }
}

server.listen(config.port, () => {
  console.log(`\n🏇 ParisPromax backend on http://localhost:${config.port}`);
  console.log(`   Admin:    http://localhost:${config.port}/admin`);
  const payConfigured =
    config.payments.provider === 'cinetpay' ? config.cinetpay.configured : config.fedapay.configured;
  console.log(`   Payments: ${config.payments.provider} — ${payConfigured ? 'LIVE/keys set' : 'MOCK mode (no keys)'}`);
  console.log(`   OTP:      ${config.otpDevMode ? 'DEV (codes returned in API)' : 'SMS provider'}`);
  console.log(`   Realtime: ${realtimeOn ? 'socket.io + IA worker ON' : 'off (no REDIS_URL)'}\n`);
});
