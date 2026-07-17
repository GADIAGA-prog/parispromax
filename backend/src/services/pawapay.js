const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

const ISO3 = { bj: 'BEN', bf: 'BFA', ci: 'CIV', cg: 'COG', sn: 'SEN' };

const isConfigured = () => config.pawapay.configured;

function http() {
  return axios.create({
    baseURL: config.pawapay.baseUrl,
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${config.pawapay.apiToken}`,
      'Content-Type': 'application/json',
    },
  });
}

function mapStatus(value) {
  switch (String(value || '').toUpperCase()) {
    case 'COMPLETED': return 'success';
    case 'FAILED':
    case 'REJECTED': return 'failed';
    default: return 'pending';
  }
}

async function initiatePayment({ transactionId, amount, currency, description, customer }) {
  if (!isConfigured()) {
    if (!config.allowMock) throw new Error('pawaPay non configuré');
    return {
      mode: 'mock',
      paymentUrl: `${config.publicBaseUrl}/payments/mock/${transactionId}`,
      providerRef: null,
      notifyUrl: `${config.publicBaseUrl}/payments/pawapay/webhook`,
      returnUrl: `${config.publicBaseUrl}/payments/return`,
    };
  }

  const depositId = crypto.randomUUID();
  const returnUrl = `${config.publicBaseUrl}/payments/return`;
  const country = ISO3[String(customer?.country || '').toLowerCase()];
  const body = {
    depositId,
    returnUrl,
    customerMessage: 'ParisPromax abonnement',
    amountDetails: { amount: String(Math.round(Number(amount))), currency: currency || 'XOF' },
    language: 'FR',
    reason: String(description || 'Abonnement ParisPromax').slice(0, 50),
    metadata: [{ transactionId }],
  };
  if (country) body.country = country;

  // En sandbox, laisser le numéro vide permet de saisir les MSISDN de test.
  if (config.pawapay.mode === 'live' && customer?.phone) {
    const phoneNumber = String(customer.phone).replace(/\D/g, '');
    if (phoneNumber) body.phoneNumber = phoneNumber;
  }

  const { data } = await http().post('/v2/paymentpage', body);
  if (!data?.redirectUrl) {
    const reason = data?.failureReason?.failureMessage || data?.failureReason?.failureCode;
    throw new Error(reason || 'pawaPay: URL de paiement manquante');
  }
  return {
    mode: config.pawapay.mode,
    paymentUrl: data.redirectUrl,
    providerRef: depositId,
    notifyUrl: `${config.publicBaseUrl}/payments/pawapay/webhook`,
    returnUrl,
  };
}

async function verifyPayment(payment) {
  if (!isConfigured() || !payment?.providerRef) {
    return { status: 'pending', method: 'mobile-money', raw: null };
  }
  const { data } = await http().get(`/v2/deposits/${payment.providerRef}`);
  const deposit = data?.data || data;
  return { status: mapStatus(deposit?.status), method: 'mobile-money', raw: data };
}

async function activeConfiguration() {
  const { data } = await http().get('/v2/active-conf');
  return data;
}

module.exports = { isConfigured, initiatePayment, verifyPayment, activeConfiguration, mapStatus };
