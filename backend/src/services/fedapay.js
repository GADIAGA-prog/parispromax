const axios = require('axios');
const config = require('../config');

// FedaPay API v1 client.
// Docs: https://docs.fedapay.com/integration-api/en/collects-management-en
//
// Flow: create a transaction -> generate a payment token (hosted checkout URL)
// -> redirect the customer -> confirm via webhook/polling by re-fetching the
// transaction status from FedaPay (never trust the client).
//
// When no secret key is configured we fall back to a local MOCK checkout so the
// full flow can be tested without a FedaPay account.

const isConfigured = () => config.fedapay.configured;

function http() {
  return axios.create({
    baseURL: config.fedapay.baseUrl,
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${config.fedapay.secretKey}`,
      'Content-Type': 'application/json',
    },
  });
}

// FedaPay wraps single resources as { "v1/transaction": {...} }; be tolerant.
function unwrap(data, key) {
  if (!data) return null;
  return data[`v1/${key}`] || data[key] || data.data || data;
}

// International dialing codes for FedaPay-supported countries (ISO2 -> code).
const DIAL_CODES = {
  bj: '229', bf: '226', ci: '225', tg: '228',
  sn: '221', ne: '227', gn: '224', ml: '223',
};

// Best-effort normalisation of any input into a valid E.164 number using the
// account country, so FedaPay's strict (live) phone validation accepts it.
// Handles every common user format:
//   "07 12 34 56" | "70123456" | "22670123456" | "+22670123456" | "0022670..."
//   and even a DUPLICATED country code ("+22622670...") -> "+22670123456".
// Returns null if we cannot form a plausible number.
function normalizePhone(raw, country) {
  const cc = DIAL_CODES[country];
  let d = String(raw || '').replace(/\D/g, ''); // digits only (drops any '+')
  if (!d) return null;
  d = d.replace(/^00/, ''); // international "00" prefix
  d = d.replace(/^0+/, ''); // national trunk leading zero(s)
  if (!cc) return d.length >= 8 ? `+${d}` : null;
  // Strip one or more leading (possibly duplicated) country codes.
  while (d.startsWith(cc) && d.length - cc.length >= 8) d = d.slice(cc.length);
  if (d.length < 8) return null; // too short to be a real mobile number
  return `+${cc}${d}`;
}

// Build a FedaPay customer from our phone-only user. FedaPay's customer base is
// keyed by a unique email, so we derive a STABLE synthetic email from the phone
// when the user has none — this makes customer creation idempotent (one FedaPay
// customer per phone) and populates FedaPay's integrated customer management.
// Returns undefined when we can't produce a valid phone (payer will enter it on
// the hosted checkout instead).
function buildCustomer(customer) {
  if (!customer || !customer.phone) return undefined;
  // Prefer the user's own country (chosen at signup); fall back to the account
  // default. This is what makes the correct country's Mobile Money operators
  // (e.g. Orange/Moov Burkina) appear on the FedaPay checkout page.
  const country = DIAL_CODES[customer.country] ? customer.country : config.fedapay.country;
  const number = normalizePhone(customer.phone, country);
  if (!number) return undefined;
  const digits = number.replace(/\D/g, '');
  return {
    firstname: customer.firstname || 'Client',
    lastname: customer.lastname || `PPM-${digits.slice(-4)}`,
    email: customer.email || `ppm-${digits}@parispromax.app`,
    phone_number: { number, country },
  };
}

// Initiate a payment. Returns { mode, paymentUrl, providerRef, notifyUrl, returnUrl }.
async function initiatePayment({ transactionId, amount, currency, description, customer }) {
  const notifyUrl = `${config.publicBaseUrl}/payments/fedapay/webhook`;
  const returnUrl = `${config.publicBaseUrl}/payments/return`;

  if (!isConfigured()) {
    if (!config.allowMock) {
      throw new Error('FedaPay non configuré (paiement indisponible en production)');
    }
    return {
      mode: 'mock',
      paymentUrl: `${config.publicBaseUrl}/payments/mock/${transactionId}`,
      providerRef: null,
      notifyUrl,
      returnUrl,
    };
  }

  const client = http();

  // 1. Create the transaction.
  const createBody = {
    description: description || 'Abonnement ParisPromax',
    amount: Math.round(Number(amount)),
    currency: { iso: currency || 'XOF' },
    callback_url: returnUrl,
    // Our own reference, echoed back so we can reconcile if needed.
    merchant_reference: transactionId,
  };
  const cust = buildCustomer(customer);

  let createRes;
  try {
    createRes = await client.post(
      '/v1/transactions',
      cust ? { ...createBody, customer: cust } : createBody
    );
  } catch (e) {
    // If FedaPay rejects the customer (e.g. an invalid phone), don't fail the
    // whole payment — retry without the customer. The payer then enters their
    // Mobile Money number directly on the hosted checkout page.
    const errs = e.response?.data?.errors || {};
    const customerRejected =
      e.response?.status === 400 &&
      (e.response?.data?.model === 'V1::Customer' ||
        Object.keys(errs).some((k) => k.includes('phone') || k.includes('customer')));
    if (cust && customerRejected) {
      createRes = await client.post('/v1/transactions', createBody);
    } else {
      throw e;
    }
  }
  const txn = unwrap(createRes.data, 'transaction');
  if (!txn || !txn.id) {
    throw new Error('FedaPay: création de transaction échouée (id manquant)');
  }

  // 2. Generate the hosted-checkout token/URL.
  const tokenRes = await client.post(`/v1/transactions/${txn.id}/token`);
  const tok = unwrap(tokenRes.data, 'token');
  const paymentUrl = tokenRes.data?.url || tok?.url;
  if (!paymentUrl) {
    throw new Error('FedaPay: URL de paiement manquante');
  }

  return {
    mode: 'live',
    paymentUrl,
    providerRef: String(txn.id),
    notifyUrl,
    returnUrl,
  };
}

// Map FedaPay status -> our internal status.
function mapStatus(fedaStatus) {
  switch (String(fedaStatus || '').toLowerCase()) {
    case 'approved':
    case 'transferred':
      return 'success';
    case 'declined':
    case 'canceled':
    case 'expired':
      return 'failed';
    default:
      return 'pending'; // pending / created / refunded (handled elsewhere)
  }
}

// Verify a transaction's real status with FedaPay, given our Payment record
// (uses payment.providerRef = the FedaPay transaction id).
// Returns { status: 'success'|'failed'|'pending'|'mock', method, raw }.
async function verifyPayment(payment) {
  if (!isConfigured()) return { status: 'mock', method: null, raw: null };
  const ref = payment && payment.providerRef;
  if (!ref) return { status: 'pending', method: null, raw: null };

  const { data } = await http().get(`/v1/transactions/${ref}`);
  const txn = unwrap(data, 'transaction');
  return {
    status: mapStatus(txn?.status),
    method: txn?.mode || txn?.last_error_code || null,
    raw: data,
  };
}

module.exports = { initiatePayment, verifyPayment, isConfigured, mapStatus, buildCustomer };
