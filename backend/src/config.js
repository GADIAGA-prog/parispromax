require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
// Dev is detected by a SQLite database (file:...); production uses Postgres/MySQL.
// This does NOT rely on NODE_ENV being set (Render blueprints may not apply it).
const isSqliteDev = String(process.env.DATABASE_URL || '').startsWith('file:');
// "Prod-like" = anything that is not the local SQLite dev DB. Security defaults
// below must be SAFE in this mode even when NODE_ENV is missing.
const isProdLike = isProd || !isSqliteDev;
const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();

const config = {
  port: Number(process.env.PORT) || 4000,
  isProd,
  // The local MOCK checkout (free "simulate success") must NEVER be reachable
  // outside the local SQLite database, even if an environment variable is set
  // incorrectly on a production service.
  allowMock:
    isSqliteDev && !isProd && String(process.env.ALLOW_MOCK_PAYMENTS || 'true') !== 'false',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: String(process.env.JWT_SECRET || '').trim() || 'dev-secret-change-me',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES) || 5,
  // OTP dev mode returns the code in the API response (no SMS). It MUST never
  // default to on outside the local SQLite dev DB, otherwise anyone could log
  // in as any phone number. The boot checks reject an explicit `true` outside
  // local SQLite as well.
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
    // Secret partagé que FeexPay envoie dans l'en-tête du webhook
    // (dashboard -> Webhooks -> Type d'en-tête: Bearer, Valeur: ce secret).
    // Optionnel : quand il est vide, le webhook reste accepté sans en-tête
    // (le statut est de toute façon re-vérifié via l'API avant activation).
    webhookSecret: process.env.FEEXPAY_WEBHOOK_SECRET || '',
  },
  yengapay: {
    // Direct Payment YengaPay: API key + group + project are required by the
    // official API. Sandbox uses the staging endpoint.
    apiKey: process.env.YENGAPAY_API_KEY || '',
    groupId: process.env.YENGAPAY_GROUP_ID || '',
    projectId: process.env.YENGAPAY_PROJECT_ID || '',
    mode: (process.env.YENGAPAY_MODE || 'sandbox').toLowerCase(), // sandbox | live
    webhookSecret: process.env.YENGAPAY_WEBHOOK_SECRET || '',
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',
  // Public website shown to visitors. PUBLIC_BASE_URL may deliberately remain
  // the technical Render API URL because payment providers call it directly.
  webBaseUrl: process.env.WEB_BASE_URL || 'https://www.parispromax.com',
  cronToken: process.env.CRON_TOKEN || '',
  // Bearer token the Python ML daemon uses to push predictions / read NP.
  // Falls back to CRON_TOKEN so a single secret can cover both integrations.
  mlToken: process.env.ML_PUSH_TOKEN || process.env.CRON_TOKEN || '',
  subscription: {
    priceXOF: Number(process.env.SUB_PRICE_XOF) || 5400,
    periodDays: Number(process.env.SUB_PERIOD_DAYS) || 30,
  },
  pawapay: {
    apiToken: process.env.PAWAPAY_API_TOKEN || '',
    mode: (process.env.PAWAPAY_MODE || 'sandbox').toLowerCase(),
    baseUrl: '',
    configured: false,
  },
  referral: {
    discountPercent: Math.min(100, Math.max(0, Number(process.env.REFERRAL_DISCOUNT_PERCENT) || 10)),
  },
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: adminPassword || 'admin',
    // The back-office (payments, phone numbers, scrape triggers) must never be
    // reachable with weak/default credentials outside the local dev DB.
    // An invalid production password disables /admin without crashing the API.
    enabled: !isProdLike || adminPassword.length >= 16,
  },
  recoverySupport: {
    // Kept server-side so the destination is never shipped in the mobile app.
    emailTo: process.env.RECOVERY_EMAIL_TO || 'ftevolut@gmail.com',
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: Number(process.env.SMTP_PORT) || 465,
    smtpSecure: String(process.env.SMTP_SECURE || 'true') !== 'false',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || '',
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

config.yengapay.baseUrl =
  config.yengapay.mode === 'live'
    ? 'https://api.yengapay.com/api/v1'
    : 'https://api.staging.yengapay.com/api/v1';
config.yengapay.configured = Boolean(
  config.yengapay.apiKey && config.yengapay.groupId && config.yengapay.projectId
);

config.pawapay.baseUrl =
  config.pawapay.mode === 'live' ? 'https://api.pawapay.io' : 'https://api.sandbox.pawapay.io';
config.pawapay.configured = Boolean(config.pawapay.apiToken);
config.recoverySupport.configured = Boolean(
  config.recoverySupport.emailTo &&
  config.recoverySupport.smtpHost &&
  config.recoverySupport.smtpUser &&
  config.recoverySupport.smtpPass
);

// ---- Boot-time security checks (fail fast on unsafe production setups) ------
if (isProdLike) {
  if (!String(process.env.JWT_SECRET || '').trim() || config.jwtSecret.length < 32) {
    // A guessable secret lets anyone forge tokens for any account.
    throw new Error(
      '[config] JWT_SECRET est obligatoire et doit contenir au moins 32 caractères hors dev.'
    );
  }
  if (config.otpDevMode) {
    throw new Error(
      '[config] OTP_DEV_MODE=true est interdit hors de la base SQLite locale.'
    );
  }
  if (!config.admin.enabled) {
    console.warn(
      '[config] ADMIN_PASSWORD absent ou trop court : le back-office /admin est DESACTIVE (16 caracteres minimum hors dev).'
    );
  }
  if (!/^https:\/\//.test(config.publicBaseUrl)) {
    // FeexPay reçoit cette URL comme `merchant_domain` et l'utilise pour
    // générer la page de validation des opérateurs à redirection (Orange BF…).
    // Une valeur localhost fait échouer les paiements en production.
    console.warn(
      `[config] ⚠️ PUBLIC_BASE_URL="${config.publicBaseUrl}" n'est pas une URL https publique. ` +
        'Les webhooks et les paiements Orange/Moov BF risquent d’échouer. ' +
        'Définissez PUBLIC_BASE_URL=https://<votre-service>.onrender.com'
    );
  }
}

module.exports = config;
