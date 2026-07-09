require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
// Dev is detected by a SQLite database (file:...); production uses Postgres/MySQL.
// This does NOT rely on NODE_ENV being set (Render blueprints may not apply it).
const isSqliteDev = String(process.env.DATABASE_URL || '').startsWith('file:');
// "Prod-like" = anything that is not the local SQLite dev DB. Security defaults
// below must be SAFE in this mode even when NODE_ENV is missing.
const isProdLike = isProd || !isSqliteDev;

const config = {
  port: Number(process.env.PORT) || 4000,
  isProd,
  // The local MOCK checkout (free "simulate success") must NEVER be reachable in
  // production, otherwise anyone could grant themselves a subscription. It is on
  // ONLY with a SQLite dev DB, or if explicitly forced via ALLOW_MOCK_PAYMENTS.
  allowMock:
    String(process.env.ALLOW_MOCK_PAYMENTS || '') === 'true' || (isSqliteDev && !isProd),
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES) || 5,
  // OTP dev mode returns the code in the API response (no SMS). It MUST never
  // default to on outside the local SQLite dev DB, otherwise anyone could log
  // in as any phone number. Explicit OTP_DEV_MODE=true still wins (staging).
  otpDevMode:
    process.env.OTP_DEV_MODE != null
      ? String(process.env.OTP_DEV_MODE) === 'true'
      : !isProdLike,
  sms: {
    provider: (process.env.SMS_PROVIDER || '').toLowerCase(), // '' | twilio | orange
    apiKey: process.env.SMS_API_KEY || '',
    sender: process.env.SMS_SENDER || 'ParisPromax',
    // Twilio
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
    // Orange SMS API (developer.orange.com — dispo Burkina Faso)
    orangeClientId: process.env.ORANGE_CLIENT_ID || '',
    orangeClientSecret: process.env.ORANGE_CLIENT_SECRET || '',
    orangeSender: process.env.ORANGE_SENDER || '', // numéro dédié, ex. +226XXXXXXX
  },
  // Active payment provider: 'fedapay' (default) | 'cinetpay'. When the chosen
  // provider has no keys, payments fall back to a local MOCK checkout.
  payments: {
    provider: (process.env.PAYMENT_PROVIDER || 'fedapay').toLowerCase(),
    // Providers to hide even if configured (e.g. during a provider outage).
    // Comma-separated ISO ids, e.g. PAYMENT_DISABLED=cinetpay
    disabled: (process.env.PAYMENT_DISABLED || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },
  cinetpay: {
    // New CinetPay API (panel.cinetpay.net / api.cinetpay.net). The key prefix
    // (sk_test_ / sk_live_) selects the environment; no site_id needed.
    apiKey: process.env.CINETPAY_API_KEY || '',
    apiPassword: process.env.CINETPAY_API_PASSWORD || '',
  },
  fedapay: {
    secretKey: process.env.FEDAPAY_SECRET_KEY || '', // sk_sandbox_... / sk_live_...
    publicKey: process.env.FEDAPAY_PUBLIC_KEY || '',
    webhookSecret: process.env.FEDAPAY_WEBHOOK_SECRET || '',
    mode: (process.env.FEDAPAY_MODE || 'sandbox').toLowerCase(), // sandbox | live
    country: (process.env.FEDAPAY_COUNTRY || 'bj').toLowerCase(), // ISO2 for phone
  },
  paydunya: {
    masterKey: process.env.PAYDUNYA_MASTER_KEY || '',
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY || '', // test_private_.../live_private_...
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY || '',
    token: process.env.PAYDUNYA_TOKEN || '',
    mode: (process.env.PAYDUNYA_MODE || 'test').toLowerCase(), // test | live
  },
  ligdicash: {
    // Agrégateur mobile money (Orange Money, Moov Money…) — Burkina/UEMOA.
    // Deux clés depuis le projet API LigdiCash : Apikey + Token (Bearer).
    apiKey: process.env.LIGDICASH_API_KEY || '',
    token: process.env.LIGDICASH_TOKEN || '',
    mode: (process.env.LIGDICASH_MODE || 'test').toLowerCase(), // test | live
  },
  feexpay: {
    // Agrégateur mobile money + carte (Bénin/UEMOA). Depuis le dashboard
    // FeexPay : le Shop ID + le Token (Bearer, les tokens live commencent par
    // fp_). Même base URL pour test/live ; l'environnement suit le token.
    shopId: process.env.FEEXPAY_SHOP_ID || '',
    token: process.env.FEEXPAY_TOKEN || '',
    mode: (process.env.FEEXPAY_MODE || 'SANDBOX').toUpperCase(), // SANDBOX | LIVE
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',
  cronToken: process.env.CRON_TOKEN || '',
  // Bearer token the Python ML daemon uses to push predictions / read NP.
  // Falls back to CRON_TOKEN so a single secret can cover both integrations.
  mlToken: process.env.ML_PUSH_TOKEN || process.env.CRON_TOKEN || '',
  subscription: {
    priceXOF: Number(process.env.SUB_PRICE_XOF) || 5000,
    periodDays: Number(process.env.SUB_PERIOD_DAYS) || 30,
  },
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin',
    // The back-office (payments, phone numbers, scrape triggers) must never be
    // reachable with the default admin/admin pair outside the local dev DB.
    enabled: !isProdLike || Boolean(process.env.ADMIN_PASSWORD),
  },
  // Bearer token the IA microservice requires (mirrors PPM_IA_TOKEN on the
  // Python side). Optional: when unset, iaClient sends no Authorization header.
  iaToken: process.env.IA_TOKEN || '',
};

// Whether CinetPay is configured for live payments. Only the API Key + Site ID
// are required: we verify each transaction via CinetPay's server-side
// /payment/check API (no HMAC secret needed). The Secret Key stays optional
// (reserved for future webhook HMAC verification).
// Environment is derived from the key prefix; configured = key + password.
config.cinetpay.mode = config.cinetpay.apiKey.startsWith('sk_live_') ? 'live' : 'test';
config.cinetpay.configured = Boolean(config.cinetpay.apiKey && config.cinetpay.apiPassword);

// FedaPay base URL derived from mode; configured = a secret key is present.
config.fedapay.baseUrl =
  config.fedapay.mode === 'live'
    ? 'https://api.fedapay.com'
    : 'https://sandbox-api.fedapay.com';
config.fedapay.configured = Boolean(config.fedapay.secretKey);

// PayDunya base URL derived from mode; configured = master+private+token present.
config.paydunya.baseUrl =
  config.paydunya.mode === 'live'
    ? 'https://app.paydunya.com/api/v1'
    : 'https://app.paydunya.com/sandbox-api/v1';
config.paydunya.configured = Boolean(
  config.paydunya.masterKey && config.paydunya.privateKey && config.paydunya.token
);

// LigdiCash base URL derived from mode; configured = Apikey + Token present.
config.ligdicash.baseUrl =
  config.ligdicash.mode === 'live'
    ? 'https://app.ligdicash.com/pay/v01'
    : 'https://test.ligdicash.com/pay/v01';
config.ligdicash.configured = Boolean(config.ligdicash.apiKey && config.ligdicash.token);

// FeexPay : base URL unique (l'environnement suit le token) ; configured =
// Shop ID + Token présents.
// API v2 (dashboard app-v2.feexpay.me -> Développeurs : Identifiant + Clé privée).
// L'ancienne api.feexpay.me rejette les identifiants v2 ("Le format de l'id est
// invalide"). L'environnement (test/live) suit la clé privée utilisée.
config.feexpay.baseUrl = process.env.FEEXPAY_BASE_URL || 'https://api-v2.feexpay.me/api';
config.feexpay.configured = Boolean(config.feexpay.shopId && config.feexpay.token);

// ---- Boot-time security checks (fail fast on unsafe production setups) ------
if (isProdLike) {
  if (!process.env.JWT_SECRET) {
    // A guessable secret lets anyone forge tokens for any account.
    throw new Error(
      '[config] JWT_SECRET est obligatoire hors dev (DATABASE_URL non-SQLite). Définissez-le puis redémarrez.'
    );
  }
  if (config.otpDevMode) {
    console.warn(
      '[config] ⚠️ OTP_DEV_MODE=true avec une base de production : les codes OTP sont renvoyés par l’API. À réserver au staging.'
    );
  }
  if (!config.admin.enabled) {
    console.warn(
      '[config] ⚠️ ADMIN_PASSWORD non défini : le back-office /admin est DÉSACTIVÉ (identifiants par défaut refusés).'
    );
  }
}

module.exports = config;
