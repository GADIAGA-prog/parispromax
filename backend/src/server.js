const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const prisma = require('./db');

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
const feedbackRoutes = require('./routes/feedback');
const { backfillReferralCodes } = require('./services/referral');
const { getProvider } = require('./services/paymentProvider');
const { canonicalRedirectTarget } = require('./services/canonicalWeb');
const { browserOriginAllowed } = require('./services/corsOrigins');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const androidApkUrl =
  process.env.ANDROID_APK_URL ||
  'https://github.com/GADIAGA-prog/parispromax/releases/latest/download/ParisPromax-Android.apk';

// Behind Render's proxy: makes req.ip the real client IP (rate limiting).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Minimal security headers (helmet-lite, no extra dependency).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; " +
      "img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
  );
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
      if (browserOriginAllowed(origin, config.corsOrigins)) {
        return cb(null, true);
      }
      return cb(new Error('Origine non autorisée par CORS'));
    },
  })
);

// NOTE: payment webhook needs the raw-ish body but we use JSON/urlencoded per route.
app.use(express.json({ limit: '200kb' }));
// The HTML, JavaScript and CSS are deployed together. Revalidate public assets
// on every visit so a browser never combines a new page with an hour-old app
// bundle (which otherwise leaves new modules stuck on their loading skeletons).
app.use(express.static(publicDir, { index: false, maxAge: 0 }));

app.get('/health', async (_req, res) => {
  const provider = config.payments.provider;
  const configured = getProvider(provider).isConfigured();
  const mode = config[provider]?.mode || null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ready = configured || config.allowMock;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: 'parispromax-backend',
      revision: process.env.RENDER_GIT_COMMIT
        ? process.env.RENDER_GIT_COMMIT.slice(0, 7)
        : null,
      database: 'up',
      paymentProvider: provider,
      paymentMode: mode, // sandbox | live (non-secret, for diagnostics)
      payments: configured ? 'configured' : config.allowMock ? 'mock' : 'unavailable',
      time: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: 'parispromax-backend',
      database: 'down',
      time: new Date().toISOString(),
    });
  }
});

// Public Web portal: same-origin API access keeps authentication and payment
// flows simple while the mobile app continues using the exact same backend.
app.get('/', (req, res) => {
  const redirectTarget = canonicalRedirectTarget(req.hostname, config.webBaseUrl);
  if (redirectTarget) {
    // Keep Render as the Android/API endpoint, but never present its technical
    // hostname as a second public website.
    res.set('Cache-Control', 'no-store');
    return res.redirect(308, redirectTarget);
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Stable first-party download URL used by the website. The APK itself lives in
// GitHub Releases so the 79 MB binary does not slow down every Render deploy.
app.get('/download/android', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.redirect(302, androidApkUrl);
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
app.use('/feedback', feedbackRoutes);

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

backfillReferralCodes().catch((error) => console.error('[referral] backfill error', error));

server.listen(config.port, () => {
  console.log(`\n🏇 ParisPromax backend on http://localhost:${config.port}`);
  console.log(`   Admin:    http://localhost:${config.port}/admin`);
  const payConfigured = getProvider(config.payments.provider).isConfigured();
  console.log(
    `   Payments: ${config.payments.provider} — ${
      payConfigured ? 'keys set' : config.allowMock ? 'LOCAL MOCK' : 'NOT CONFIGURED'
    }`
  );
  console.log(`   OTP:      ${config.otpDevMode ? 'DEV (codes returned in API)' : 'SMS provider'}`);
  console.log(`   Realtime: ${realtimeOn ? 'socket.io + IA worker ON' : 'off (no REDIS_URL)'}\n`);
});
