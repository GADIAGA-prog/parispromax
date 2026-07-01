const axios = require('axios');
const config = require('../config');

// CinetPay API v2 client.
// Docs: https://docs.cinetpay.com/api/1.0-en/checkout/initialisation
//
// When CinetPay keys are NOT configured, we fall back to a local MOCK mode so
// the full flow (initiate -> pay -> webhook -> activate) can be tested without
// a merchant account. Swap in the real keys in .env to go live.

const isConfigured = () => config.cinetpay.configured;

// Initiate a payment. Returns { paymentUrl, mode }.
async function initiatePayment({
  transactionId,
  amount,
  currency,
  description,
  customer,
  channels = 'ALL', // ALL | MOBILE_MONEY | CREDIT_CARD
}) {
  const notifyUrl = `${config.publicBaseUrl}/payments/cinetpay/webhook`;
  const returnUrl = `${config.publicBaseUrl}/payments/return`;

  if (!isConfigured()) {
    if (!config.allowMock) {
      throw new Error('CinetPay non configuré (paiement indisponible en production)');
    }
    // MOCK mode — our own hosted page simulates the PSP checkout.
    return {
      mode: 'mock',
      paymentUrl: `${config.publicBaseUrl}/payments/mock/${transactionId}`,
      notifyUrl,
      returnUrl,
    };
  }

  const payload = {
    apikey: config.cinetpay.apiKey,
    site_id: config.cinetpay.siteId,
    transaction_id: transactionId,
    amount,
    currency,
    description: description || 'Abonnement ParisPromax',
    notify_url: notifyUrl,
    return_url: returnUrl,
    channels,
    customer_id: customer?.id || undefined,
    customer_name: customer?.name || undefined,
    customer_phone_number: customer?.phone || undefined,
  };

  const { data } = await axios.post(`${config.cinetpay.baseUrl}/payment`, payload, {
    timeout: 15000,
  });
  if (data.code !== '201' || !data.data?.payment_url) {
    throw new Error(`CinetPay init failed: ${data.message || data.code}`);
  }
  return { mode: 'live', paymentUrl: data.data.payment_url, notifyUrl, returnUrl };
}

// Verify a transaction's real status with CinetPay, given our Payment record
// (uses payment.transactionId). Uniform signature across providers.
// Returns { status: 'success'|'failed'|'pending'|'mock', method, raw }.
async function verifyPayment(payment) {
  if (!isConfigured()) {
    // In mock mode the webhook/mock page sets status directly in the DB,
    // so verification is a no-op signalling "trust the stored status".
    return { status: 'mock', method: null, raw: null };
  }

  const payload = {
    apikey: config.cinetpay.apiKey,
    site_id: config.cinetpay.siteId,
    transaction_id: payment && payment.transactionId,
  };
  const { data } = await axios.post(`${config.cinetpay.baseUrl}/payment/check`, payload, {
    timeout: 15000,
  });

  const apiStatus = data?.data?.status; // ACCEPTED | REFUSED | PENDING ...
  let status = 'pending';
  if (apiStatus === 'ACCEPTED') status = 'success';
  else if (apiStatus === 'REFUSED') status = 'failed';

  return {
    status,
    method: data?.data?.payment_method || null,
    raw: data,
  };
}

module.exports = { initiatePayment, verifyPayment, isConfigured };
