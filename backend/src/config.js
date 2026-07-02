require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
// Dev is detected by a SQLite database (file:...); production uses Postgres/MySQL.
// This does NOT rely on NODE_ENV being set (Render blueprints may not apply it).
const isSqliteDev = String(process.env.DATABASE_URL || '').startsWith('file:');

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
  otpDevMode: String(process.env.OTP_DEV_MODE || 'true') === 'true',
  sms: {
    provider: process.env.SMS_PROVIDER || '',
    apiKey: process.env.SMS_API_KEY || '',
    sender: process.env.SMS_SENDER || 'ParisPromax',
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
    apiKey: process.env.CINETPAY_API_KEY || '',
    siteId: process.env.CINETPAY_SITE_ID || '',
    secretKey: process.env.CINETPAY_SECRET_KEY || '',
    mode: process.env.CINETPAY_MODE || 'sandbox',
    baseUrl: process.env.CINETPAY_BASE_URL || 'https://api-checkout.cinetpay.com/v2',
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
  },
};

// Whether CinetPay is configured for live payments. Only the API Key + Site ID
// are required: we verify each transaction via CinetPay's server-side
// /payment/check API (no HMAC secret needed). The Secret Key stays optional
// (reserved for future webhook HMAC verification).
config.cinetpay.configured = Boolean(
  config.cinetpay.apiKey && config.cinetpay.siteId
);

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

module.exports = config;
