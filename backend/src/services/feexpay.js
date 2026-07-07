const axios = require('axios');
const config = require('../config');

// FeexPay HTTP API — agrégateur mobile money + carte (Bénin/UEMOA).
// Réf. faisant autorité : SDK officiels FeexPay (feexpay-sdk-php,
// @feexpay/react-sdk v1.5.8). Base : https://api.feexpay.me/api.
// Auth : en-tête `Authorization: Bearer <token>` (+ shop id dans le corps).
//
// ⚠️ FeexPay n'est PAS un PSP à page hébergée comme FedaPay/PayDunya :
//   * Mobile money = paiement DIRECT (requesttopay) : on fournit numéro +
//     opérateur, FeexPay pousse une confirmation sur le téléphone. Pas d'URL.
//     -> exposé via requestMobilePayment() + un écran dédié dans l'app.
//   * Carte = renvoie une `url` de redirection (initcard) : ça rentre dans
//     l'interface redirect classique -> initiatePayment().
// Dans les deux cas on VÉRIFIE le statut côté serveur (verifyPayment) avant
// d'accorder l'accès — jamais confiance au retour client.

const isConfigured = () => config.feexpay.configured;

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.feexpay.token}`,
  };
}

// Opérateurs mobile money par pays (repris du SDK React `ne`). Clé = ISO2.
const NETWORKS_BY_COUNTRY = {
  bj: ['MTN', 'MOOV', 'CELTIIS'],
  ci: ['MTN', 'MOOV', 'ORANGE', 'WAVE'],
  bf: ['MOOV', 'ORANGE'],
  cg: ['MTN'],
  sn: ['ORANGE', 'FREE'],
  tg: ['TOGOCOM', 'MOOV'],
};

// ISO2 -> nom de pays FeexPay (pour la table `reseau`).
const COUNTRY_NAME = {
  bj: 'BENIN',
  ci: 'COTE_D_IVOIRE',
  bf: 'BURKINA_FASO',
  cg: 'CONGO_BRAZZAVILLE',
  sn: 'SENEGAL',
  tg: 'TOGO',
};

// Table pays -> opérateur -> valeur `reseau` attendue par l'API (SDK React `Re`).
const RESEAU = {
  BENIN: { MTN: 'MTN', MOOV: 'MOOV', CELTIIS: 'CELTIIS BJ', CORIS: 'CORIS' },
  COTE_D_IVOIRE: { MTN: 'MTN CI', MOOV: 'MOOV CI', ORANGE: 'ORANGE CI', WAVE: 'WAVE CI' },
  BURKINA_FASO: { MOOV: 'MOOV BF', ORANGE: 'ORANGE BF' },
  CONGO_BRAZZAVILLE: { MTN: 'MTN CG' },
  SENEGAL: { ORANGE: 'ORANGE SN', FREE: 'FREE SN' },
  TOGO: { TOGOCOM: 'TOGOCOM TG', MOOV: 'MOOV TG' },
};

// Liste des opérateurs disponibles pour un pays (ISO2), pour l'écran de choix.
function operatorsForCountry(iso2) {
  return NETWORKS_BY_COUNTRY[String(iso2 || '').toLowerCase()] || ['MTN', 'MOOV'];
}

// Mappe (ISO2, opérateur) -> valeur `reseau` de l'API (fallback: minuscule).
function mapReseau(iso2, network) {
  const country = COUNTRY_NAME[String(iso2 || '').toLowerCase()];
  const net = String(network || '').toUpperCase();
  return (RESEAU[country] && RESEAU[country][net]) || net.toLowerCase();
}

// Normalise un numéro : on retire tout sauf les chiffres, et un éventuel préfixe
// pays dupliqué (ex. "226226..." -> "226..."), comme le fait le SDK.
function normalizePhone(raw) {
  let s = String(raw || '').replace(/\D/g, '');
  if (s.length >= 8) {
    const p = s.slice(0, 3);
    if (s.startsWith(p + p)) s = s.slice(p.length);
  }
  return s;
}

// Email/nom de repli : nos utilisateurs s'inscrivent au téléphone (pas d'email).
function fallbackEmail(customer) {
  const digits = String(customer?.phone || '').replace(/\D/g, '') || 'client';
  return customer?.email || `${digits}@parispromax.app`;
}

// --- MOBILE MONEY (paiement direct) ------------------------------------------
// Déclenche une demande de paiement mobile money. Retourne
// { reference, status } (status: 'pending'|'success'|'failed'). La confirmation
// se fait sur le téléphone du client ; l'app suit ensuite via verifyPayment.
async function requestMobilePayment({ transactionId, amount, description, phone, network, country, customer }) {
  if (!isConfigured()) {
    throw new Error('FeexPay non configuré');
  }
  const reseau = mapReseau(country, network);
  // MTN rejette les caractères spéciaux dans la description.
  const desc = String(description || 'Abonnement ParisPromax').replace(/[^a-zA-Z0-9 ]/g, '');

  const body = {
    phoneNumber: normalizePhone(phone),
    amount: Math.round(Number(amount)),
    reseau,
    description: desc,
    customId: transactionId, // renvoyé pour réconciliation
    shop: config.feexpay.shopId,
    token: config.feexpay.token,
    payment_interface: 'API',
    callback_info: { transaction_id: transactionId, user_id: customer?.id || null },
    currency: 'XOF',
    first_name: customer?.firstName || 'Client',
    email: fallbackEmail(customer),
    otp: '',
  };

  const { data } = await axios.post(
    `${config.feexpay.baseUrl}/transactions/requesttopay/integration`,
    body,
    { headers: headers(), timeout: 20000 }
  );

  const reference = data.reference || data.transaction_id || null;
  if (!reference) {
    throw new Error(`FeexPay: référence absente (${data.message || data.status || 'réponse inattendue'})`);
  }
  return { reference: String(reference), status: mapStatus(data.status), raw: data };
}

// --- CARTE (redirect) — interface provider standard ---------------------------
// initiatePayment renvoie { mode, paymentUrl, providerRef, notifyUrl, returnUrl }
// via le flux carte (initcard). Le mobile money passe par requestMobilePayment.
async function initiatePayment({ transactionId, amount, currency, description, customer }) {
  const notifyUrl = `${config.publicBaseUrl}/payments/feexpay/webhook`;
  const returnUrl = `${config.publicBaseUrl}/payments/return`;

  if (!isConfigured()) {
    if (!config.allowMock) {
      throw new Error('FeexPay non configuré (paiement indisponible en production)');
    }
    return {
      mode: 'mock',
      paymentUrl: `${config.publicBaseUrl}/payments/mock/${transactionId}`,
      providerRef: null,
      notifyUrl,
      returnUrl,
    };
  }
  if (currency && String(currency).toLowerCase() !== 'xof') {
    throw new Error('FeexPay ne supporte que la devise XOF');
  }

  const body = {
    phone: normalizePhone(customer?.phone),
    amount: Math.round(Number(amount)),
    shop: config.feexpay.shopId,
    first_name: customer?.firstName || 'Client',
    last_name: customer?.lastName || 'ParisPromax',
    email: fallbackEmail(customer),
    type_card: 'VISA', // la page hébergée accepte VISA/MASTERCARD
    currency: 'XOF',
  };

  const { data } = await axios.post(
    `${config.feexpay.baseUrl}/transactions/public/initcard`,
    body,
    { headers: headers(), timeout: 20000 }
  );

  const url = data.url;
  const ref = data.transref || data.reference;
  if (!url || !/^https?:\/\//.test(String(url))) {
    throw new Error(`FeexPay: URL carte absente (${data.message || data.status || 'réponse inattendue'})`);
  }
  return {
    mode: config.feexpay.mode === 'LIVE' ? 'live' : 'test',
    paymentUrl: url,
    providerRef: ref ? String(ref) : null,
    notifyUrl,
    returnUrl,
  };
}

// Mappe un statut FeexPay -> notre statut interne.
function mapStatus(status) {
  switch (String(status || '').toUpperCase()) {
    case 'SUCCESSFUL':
    case 'SUCCESS':
      return 'success';
    case 'FAILED':
    case 'TIMEOUT':
    case 'INSUFFICIENT_FUNDS':
    case 'CANCELLED':
      return 'failed';
    default: // PENDING / vide
      return 'pending';
  }
}

// Vérifie le vrai statut d'une transaction (payment.providerRef = reference).
// Endpoint public (pas d'auth). Fonctionne pour mobile money ET carte.
async function verifyPayment(payment) {
  if (!isConfigured()) return { status: 'mock', method: null, raw: null };
  const ref = payment && payment.providerRef;
  if (!ref) return { status: 'pending', method: null, raw: null };

  const { data } = await axios.get(
    `${config.feexpay.baseUrl}/transactions/getrequesttopay/integration/${encodeURIComponent(ref)}`,
    { timeout: 15000 }
  );
  return { status: mapStatus(data.status), method: payment.method || 'feexpay', raw: data };
}

module.exports = {
  initiatePayment,
  verifyPayment,
  requestMobilePayment,
  isConfigured,
  mapStatus,
  operatorsForCountry,
  mapReseau,
  NETWORKS_BY_COUNTRY,
};
