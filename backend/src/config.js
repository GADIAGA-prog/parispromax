require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES) || 5,
  otpDevMode: String(process.env.OTP_DEV_MODE || 'true') === 'true',
  sms: {
    provider: process.env.SMS_PROVIDER || '',
    apiKey: process.env.SMS_API_KEY || '',
    sender: process.env.SMS_SENDER || 'ParisPromax',
  },
  cinetpay: {
    apiKey: process.env.CINETPAY_API_KEY || '',
    siteId: process.env.CINETPAY_SITE_ID || '',
    secretKey: process.env.CINETPAY_SECRET_KEY || '',
    mode: process.env.CINETPAY_MODE || 'sandbox',
    baseUrl: process.env.CINETPAY_BASE_URL || 'https://api-checkout.cinetpay.com/v2',
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',
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

module.exports = config;
