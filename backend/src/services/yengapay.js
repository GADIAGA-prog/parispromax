const axios = require('axios');
const config = require('../config');

// YengaPay Direct Payment API. This flow deliberately stays in the app: the
// customer chooses the operator and, for Orange Money, enters the OTP supplied
// by the operator. No Mobile Money PIN is collected by ParisPromax.

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
  ci: ['ORANGE', 'MOOV', 'MTN'],
  sn: ['ORANGE'],
  ml: ['ORANGE'],
  ne: ['ORANGE'],
  tg: ['MOOV'],
  bj: ['MOOV'],
};

function operatorsForCountry(country) {
  return OPERATORS_BY_COUNTRY[String(country || '').toLowerCase()] || [];
}

function requiresOtp(country, operator) {
  const op = String(operator || '').toUpperCase();
  // Official YengaPay flow: Orange is one-step with OTP; Coris, Sank and
  // Telecel use an OTP flow. Moov triggers a validation on the handset.
  return op === 'ORANGE' || ['CORISM', 'SANKM', 'TELECEL'].includes(op);
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
      return 'success';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'failed';
    default:
      return 'pending';
  }
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
  requiresOtp,
  initDirectPayment,
  requestMobilePayment,
  verifyPayment,
  mapStatus,
};
