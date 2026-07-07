const axios = require('axios');
const config = require('../config');

// LigdiCash HTTP API — Pay-in avec redirection (checkout invoice).
// Docs : https://developers.ligdicash.com  (référence : librairie PHP officielle
// Ligdicash/ligdicash-php).
//
// Flux : créer une facture -> rediriger le client vers l'URL de paiement hébergée
// (response_text) -> confirmer le statut par token AVANT d'accorder l'accès (on
// ne fait jamais confiance au retour client). Sandbox vs live = base URL + les
// clés correspondantes.
//
// Auth : deux en-têtes — `Apikey: <clé>` et `Authorization: Bearer <token>`.
// Retombe sur un MOCK local quand aucune clé n'est configurée.

const isConfigured = () => config.ligdicash.configured;

function headers() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Apikey: config.ligdicash.apiKey,
    Authorization: `Bearer ${config.ligdicash.token}`,
  };
}

// Initie un paiement. Retourne { mode, paymentUrl, providerRef, notifyUrl, returnUrl }.
async function initiatePayment({ transactionId, amount, currency, description, customer }) {
  const notifyUrl = `${config.publicBaseUrl}/payments/ligdicash/webhook`;
  const returnUrl = `${config.publicBaseUrl}/payments/return`;

  if (!isConfigured()) {
    if (!config.allowMock) {
      throw new Error('LigdiCash non configuré (paiement indisponible en production)');
    }
    return {
      mode: 'mock',
      paymentUrl: `${config.publicBaseUrl}/payments/mock/${transactionId}`,
      providerRef: null,
      notifyUrl,
      returnUrl,
    };
  }

  // LigdiCash n'accepte que XOF. Le montant doit être un entier.
  if (currency && String(currency).toLowerCase() !== 'xof') {
    throw new Error('LigdiCash ne supporte que la devise XOF');
  }
  const total = Math.round(Number(amount));
  const label = description || 'Abonnement ParisPromax';

  const body = {
    commande: {
      invoice: {
        items: [
          {
            name: 'ParisPromax',
            description: label,
            quantity: 1,
            unit_price: total,
            total_price: total,
          },
        ],
        total_amount: total,
        devise: 'xof',
        description: label,
        customer: customer?.phone || '',
        customer_firstname: '',
        customer_lastname: '',
        customer_email: '',
        // Renvoyé tel quel dans le retour/IPN -> réconciliation avec notre txn.
        external_id: transactionId,
        otp: '',
      },
      store: { name: 'PARISPROMAX', website_url: config.publicBaseUrl },
      actions: { cancel_url: returnUrl, return_url: returnUrl, callback_url: notifyUrl },
      custom_data: { transaction_id: transactionId, user_id: customer?.id || null },
    },
  };

  const { data } = await axios.post(
    `${config.ligdicash.baseUrl}/redirect/checkout-invoice/create`,
    body,
    { headers: headers(), timeout: 15000 }
  );

  if (String(data.response_code) !== '00' || !data.token) {
    throw new Error(
      `LigdiCash: création de facture échouée (${data.response_text || data.description || data.response_code})`
    );
  }

  // response_text contient l'URL de paiement hébergée.
  const paymentUrl = data.response_text;
  if (!/^https?:\/\//.test(String(paymentUrl || ''))) {
    throw new Error("LigdiCash: URL de paiement absente dans la réponse");
  }

  return {
    mode: config.ligdicash.mode === 'live' ? 'live' : 'test',
    paymentUrl,
    providerRef: String(data.token),
    notifyUrl,
    returnUrl,
  };
}

// Mappe le statut LigdiCash -> notre statut interne.
function mapStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'completed':
      return 'success';
    case 'pending':
    case '':
      return 'pending';
    default: // nocompleted / notcompleted / cancelled / expired ...
      return 'failed';
  }
}

// Vérifie le vrai statut d'une facture auprès de LigdiCash
// (payment.providerRef = invoiceToken). Retourne
// { status: 'success'|'failed'|'pending'|'mock', method, raw }.
async function verifyPayment(payment) {
  if (!isConfigured()) return { status: 'mock', method: null, raw: null };
  const token = payment && payment.providerRef;
  if (!token) return { status: 'pending', method: null, raw: null };

  const { data } = await axios.get(
    `${config.ligdicash.baseUrl}/redirect/checkout-invoice/confirm/?invoiceToken=${encodeURIComponent(token)}`,
    { headers: headers(), timeout: 15000 }
  );
  const method = data.operator_name ? `ligdicash:${data.operator_name}` : 'ligdicash';
  return { status: mapStatus(data.status), method, raw: data };
}

module.exports = { initiatePayment, verifyPayment, isConfigured, mapStatus };
