const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const { safeEqual } = require('../security');

// YengaPay Direct Payment API. This flow deliberately stays in the app: the
// customer chooses the operator and follows the OTP flow declared by YengaPay.
// No Mobile Money PIN is ever collected by ParisPromax.

const isConfigured = () => config.yengapay.configured;

function http() {
  return axios.create({
    baseURL: config.yengapay.baseUrl,
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.yengapay.apiKey,
    },
  });
}

const OPERATORS_BY_COUNTRY = {
  bf: ['ORANGE', 'MOOV', 'TELECEL', 'CORISM', 'SANKM'],
  // The official SDK currently advertises Orange + Moov in CI, while the
  // YengaPay operator catalogue additionally advertises MTN MoMo CI. The
  // PaymentIntent remains the final authority before a debit is requested.
  ci: ['ORANGE', 'MOOV', 'MTN'],
  sn: ['ORANGE'],
  ml: ['ORANGE'],
  ne: ['ORANGE'],
  tg: ['MOOV'],
  bj: ['MOOV'],
};

const OPERATOR_NAMES = {
  ORANGE: 'Orange Money',
  MOOV: 'Moov Money',
  TELECEL: 'Telecel Money',
  CORISM: 'Coris Money',
  SANKM: 'Sank Money',
  MTN: 'MTN MoMo',
};

// Current direct-payment guide:
// - CORISM/SANKM: request the OTP from YengaPay, then call /pay with it.
// - ORANGE/TELECEL: the customer obtains the OTP, then /pay is called directly.
// - MOOV/MTN: push validation on the customer's phone, no OTP field here.
const SERVER_OTP_OPERATORS = new Set(['CORISM', 'SANKM']);
const CUSTOMER_OTP_OPERATORS = new Set(['ORANGE', 'TELECEL']);

function normalizeOperatorCode(operator) {
  const code = String(operator || '').trim().toUpperCase();
  return ['MTN_MOMO_CI', 'MTN_MOMO'].includes(code) ? 'MTN' : code;
}

function operatorsForCountry(country) {
  return OPERATORS_BY_COUNTRY[String(country || '').toLowerCase()] || [];
}

function operatorDetailsForCountry(country) {
  return operatorsForCountry(country).map((code) => ({
    code,
    name: OPERATOR_NAMES[code] || code,
    otpMode: SERVER_OTP_OPERATORS.has(code)
      ? 'server'
      : CUSTOMER_OTP_OPERATORS.has(code)
        ? 'customer'
        : 'none',
  }));
}

function requiresOtp(_country, operator) {
  const op = normalizeOperatorCode(operator);
  return SERVER_OTP_OPERATORS.has(op) || CUSTOMER_OTP_OPERATORS.has(op);
}

function requiresOtpRequest(operator) {
  return SERVER_OTP_OPERATORS.has(normalizeOperatorCode(operator));
}

function normalizePhone(raw, country) {
  const dialCodes = { bf: '226', ci: '225', sn: '221', ml: '223', ne: '227', tg: '228', bj: '229' };
  const cc = String(country || '').toLowerCase();
  const dial = dialCodes[cc];
  let value = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  if (!value) return '';
  if (dial && !value.startsWith(dial)) value = `${dial}${value.replace(/^0/, '')}`;
  return `+${value}`;
}

function mapStatus(status) {
  switch (String(status || '').toUpperCase()) {
    case 'DONE':
    case 'SUCCESS':
    case 'SUCCESSFUL':
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'failed';
    default:
      return 'pending';
  }
}

function availableOperator(intent, country, operator) {
  const available = Array.isArray(intent?.availableOperators) ? intent.availableOperators : [];
  if (!available.length) return null;
  const expectedCountry = String(country || '').toUpperCase();
  const expectedOperator = normalizeOperatorCode(operator);
  return available.find(
    (item) =>
      normalizeOperatorCode(item?.code) === expectedOperator &&
      String(item?.countryCode || '').toUpperCase() === expectedCountry
  ) || null;
}

function verifyWebhookHash(body, receivedHash, secret = config.yengapay.webhookSecret) {
  if (!secret) return true;
  if (!receivedHash) return false;
  const supplied = String(receivedHash).replace(/^sha256=/i, '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body || {}))
    .digest('hex');
  return safeEqual(expected, supplied);
}

async function initDirectPayment({ transactionId, amount, description, customer }) {
  const { data } = await http().post(
    `/groups/${config.yengapay.groupId}/projects/${config.yengapay.projectId}/direct-payment/init`,
    {
      amount: Math.round(Number(amount)),
      reference: transactionId,
      customerEmailToNotify: customer?.email || undefined,
      articles: [{ title: description || 'Abonnement ParisPromax', price: Math.round(Number(amount)) }],
      metadata: { transactionId, userId: customer?.id || null },
    }
  );
  if (!data?.paymentIntentId) throw new Error('YengaPay: payment intent manquant');
  return data;
}

async function requestMobilePayment({ paymentIntentId, operator, country, phone, otp }) {
  const { data } = await http().post(
    `/groups/${config.yengapay.groupId}/projects/${config.yengapay.projectId}/direct-payment/pay`,
    {
      paymentIntentId,
      operatorCode: String(operator).toUpperCase(),
      countryCode: String(country).toUpperCase(),
      customerMSISDN: normalizePhone(phone, country),
      ...(otp ? { otp: String(otp) } : {}),
    }
  );
  return { ...data, status: mapStatus(data?.status) };
}

async function sendPaymentOtp({ paymentIntentId, operator, country, phone }) {
  const { data } = await http().post(
    `/groups/${config.yengapay.groupId}/projects/${config.yengapay.projectId}/direct-payment/send-otp`,
    {
      paymentIntentId,
      operatorCode: String(operator).toUpperCase(),
      countryCode: String(country).toUpperCase(),
      customerMSISDN: normalizePhone(phone, country),
    }
  );
  return data;
}

async function verifyPayment(payment) {
  if (!isConfigured()) return { status: 'pending', method: null, raw: null };
  const ref = payment?.providerRef;
  if (!ref) return { status: 'pending', method: null, raw: null };
  const { data } = await http().get(
    `/groups/${config.yengapay.groupId}/projects/${config.yengapay.projectId}/direct-payment/status/${encodeURIComponent(ref)}`
  );
  return { status: mapStatus(data?.status), method: data?.operator || null, raw: data };
}

module.exports = {
  isConfigured,
  operatorsForCountry,
  operatorDetailsForCountry,
  normalizeOperatorCode,
  requiresOtp,
  requiresOtpRequest,
  availableOperator,
  verifyWebhookHash,
  normalizePhone,
  initDirectPayment,
  sendPaymentOtp,
  requestMobilePayment,
  verifyPayment,
  mapStatus,
};
