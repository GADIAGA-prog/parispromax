const axios = require('axios');
const config = require('../config');

// CinetPay NEW API (panel.cinetpay.net / api.cinetpay.net).
// Docs: your dashboard -> Ressources -> Documentation API.
//
// Auth is two-step:
//   1. POST /v1/oauth/login { api_key, api_password } -> access token
//   2. Use `Authorization: Bearer <token>` for /v1/payment (create) and the
//      status/verify endpoint.
// The api_key prefix (sk_test_ / sk_live_) selects sandbox vs production.
//
// Falls back to a local MOCK checkout when no keys are configured.

const isConfigured = () => config.cinetpay.configured;
// New CinetPay API base is a fixed host (env can't break the /v1 path).
const base = () => 'https://api.cinetpay.net/v1';

// Obtain an OAuth access token (short-lived; fetched per operation for safety).
async function login() {
  const { data } = await axios.post(
    `${base()}/oauth/login`,
    { api_key: config.cinetpay.apiKey, api_password: config.cinetpay.apiPassword },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  const token =
    data?.data?.access_token || data?.data?.token || data?.access_token || data?.token;
  if (!token) {
    throw new Error(`CinetPay: authentification échouée (${data?.status || data?.description || 'token manquant'})`);
  }
  return token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Initiate a payment. Returns { mode, paymentUrl, providerRef, notifyUrl, returnUrl }.
async function initiatePayment({ transactionId, amount, currency, description, customer }) {
  const notifyUrl = `${config.publicBaseUrl}/payments/cinetpay/webhook`;
  const returnUrl = `${config.publicBaseUrl}/payments/return`;

  if (!isConfigured()) {
    if (!config.allowMock) {
      throw new Error('CinetPay non configuré (paiement indisponible en production)');
    }
    return {
      mode: 'mock',
      paymentUrl: `${config.publicBaseUrl}/payments/mock/${transactionId}`,
      providerRef: null,
      notifyUrl,
      returnUrl,
    };
  }

  const token = await login();
  const body = {
    merchant_transaction_id: transactionId,
    amount: Math.round(Number(amount)),
    currency: currency || 'XOF',
    designation: description || 'Abonnement ParisPromax',
    description: description || 'Abonnement ParisPromax',
    success_url: returnUrl,
    failed_url: returnUrl,
    notify_url: notifyUrl,
    customer_name: customer?.name || 'Client ParisPromax',
    customer_phone_number: customer?.phone || undefined,
    channel: 'ALL', // ALL | MOBILE_MONEY | CREDIT_CARD
  };

  const { data } = await axios.post(`${base()}/payment`, body, {
    headers: authHeaders(token),
    timeout: 15000,
  });

  const d = data?.data || data;
  const paymentUrl =
    d?.payment_url || d?.payment_link || d?.url || d?.checkout_url || d?.link ||
    data?.payment_url;
  const ref = d?.payment_token || d?.token || d?.transaction_id || transactionId;
  if (!paymentUrl) {
    // TEMP: include the raw response so we can map the URL field exactly.
    throw new Error(`CinetPay: payment_url introuvable — ${JSON.stringify(data).slice(0, 450)}`);
  }

  return {
    mode: config.cinetpay.mode,
    paymentUrl,
    providerRef: String(ref),
    notifyUrl,
    returnUrl,
  };
}

// Map CinetPay status -> our internal status.
function mapStatus(status) {
  switch (String(status || '').toUpperCase()) {
    case 'ACCEPTED':
    case 'COMPLETED':
    case 'SUCCESS':
    case 'SUCCESSFUL':
    case 'PAID':
      return 'success';
    case 'REFUSED':
    case 'FAILED':
    case 'CANCELED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'failed';
    default:
      return 'pending';
  }
}

// Verify a payment's real status. Uses our merchant_transaction_id.
// Returns { status: 'success'|'failed'|'pending'|'mock', method, raw }.
async function verifyPayment(payment) {
  if (!isConfigured()) return { status: 'mock', method: null, raw: null };
  const txn = payment && payment.transactionId;
  if (!txn) return { status: 'pending', method: null, raw: null };

  const token = await login();
  const { data } = await axios.get(`${base()}/payment/${encodeURIComponent(txn)}`, {
    headers: authHeaders(token),
    timeout: 15000,
  });
  const d = data?.data || data;
  return { status: mapStatus(d?.status || d?.payment_status), method: d?.payment_method || null, raw: data };
}

module.exports = { initiatePayment, verifyPayment, isConfigured, mapStatus, login };
