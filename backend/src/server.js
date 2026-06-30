const express = require('express');
const cors = require('cors');
const config = require('./config');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const paymentRoutes = require('./routes/payments');
const raceRoutes = require('./routes/races');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');

const app = express();

// CORS: allow configured origins; mobile apps send no Origin so always allowed.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(null, true); // permissive in this phase; tighten for prod
    },
  })
);

// NOTE: payment webhook needs the raw-ish body but we use JSON/urlencoded per route.
app.use(express.json());

app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'parispromax-backend',
    cinetpay: config.cinetpay.configured ? 'configured' : 'mock',
    time: new Date().toISOString(),
  })
);

app.use('/auth', authRoutes);
app.use('/me', meRoutes);
app.use('/payments', paymentRoutes);
app.use('/races', raceRoutes);
app.use('/stats', statsRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(config.port, () => {
  console.log(`\n🏇 ParisPromax backend on http://localhost:${config.port}`);
  console.log(`   Admin:    http://localhost:${config.port}/admin`);
  console.log(`   CinetPay: ${config.cinetpay.configured ? 'LIVE/keys set' : 'MOCK mode (no keys)'}`);
  console.log(`   OTP:      ${config.otpDevMode ? 'DEV (codes returned in API)' : 'SMS provider'}\n`);
});
