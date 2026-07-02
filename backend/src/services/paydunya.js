const axios = require('axios');
const config = require('../config');

// PayDunya HTTP API (checkout invoice).
// Docs: https://developers.paydunya.com/doc/EN/http_json
//
// Flow: create an invoice -> redirect the customer to the hosted checkout URL
// -> confirm the invoice status by token before granting access (never trust
// the client). Sandbox vs live is selected by the base URL + the matching keys.
//
// Falls back to a local MOCK checkout when no keys are configured.

const isConfigured = () => config.paydunya.configured;

function headers() {
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': config.paydunya.masterKey,
    'PAYDUNYA-PRIVATE-KEY': config.paydunya.privateKey,
    'PAYDUNYA-TOKEN': config.paydunya.token,
  };
}

// Initiate a payment. Returns { mode, paymentUrl, providerRef, notifyUrl, returnUrl }.
async function initiatePayment({ transactionId, amount, currency, description, customer }) {
  const notifyUrl = `${config.publicBaseUrl}/payments/paydunya/webhook`;
  const returnUrl = `${config.publicBaseUrl}/payments/return`;

  if (!isConfigured()) {
    if (!config.allowMock) {
      throw new Error('PayDunya non configuré (paiement indisponible en production)');
    }
    return {
      mode: 'mock',
      paymentUrl: `${config.publicBaseUrl}/payments/mock/${transactionId}`,
      providerRef: null,
      notifyUrl,
      returnUrl,
    };
  }

  const body = {
    invoice: {
      total_amount: Math.round(Number(amount)),
      description: description || 'Abonnement ParisPromax',
    },
    store: { name: 'PARISPROMAX' },
    actions: { cancel_url: returnUrl, return_url: returnUrl, callback_url: notifyUrl },
    // Echoed back on the IPN so we can reconcile to our own transaction.
    custom_data: { transaction_id: transactionId, user_id: customer?.id || null },
  };

  const { data } = await axios.post(
    `${config.paydunya.baseUrl}/checkout-invoice/create`,
    body,
    { headers: headers(), timeout: 15000 }
  );

  if (String(data.response_code) !== '00' || !data.token) {
    throw new Error(`PayDunya: création de facture échouée (${data.response_text || data.response_code})`);
  }

  // On success response_text holds the checkout URL; be robust and fall back to
  // the canonical hosted-invoice URL built from the token.
  const paymentUrl =
    data.response_text && /^https?:\/\//.test(data.response_text)
      ? data.response_text
      : `https://paydunya.com/checkout/invoice/${data.token}`;

  return {
    mode: config.paydunya.mode === 'live' ? 'live' : 'test',
    paymentUrl,
    providerRef: String(data.token),
    notifyUrl,
    returnUrl,
  };
}

// Map PayDunya status -> our internal status.
function mapStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'completed':
      return 'success';
    case 'cancelled':
    case 'canceled':
      return 'failed';
    default:
      return 'pending';
  }
}

// Verify an invoice's real status with PayDunya (payment.providerRef = token).
// Returns { status: 'success'|'failed'|'pending'|'mock', method, raw }.
async function verifyPayment(payment) {
  if (!isConfigured()) return { status: 'mock', method: null, raw: null };
  const token = payment && payment.providerRef;
  if (!token) return { status: 'pending', method: null, raw: null };

  const { data } = await axios.get(
    `${config.paydunya.baseUrl}/checkout-invoice/confirm/${token}`,
    { headers: headers(), timeout: 15000 }
  );
  return { status: mapStatus(data.status), method: 'paydunya', raw: data };
}

module.exports = { initiatePayment, verifyPayment, isConfigured, mapStatus };
