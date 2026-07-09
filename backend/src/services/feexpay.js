const axios = require('axios');
const config = require('../config');

// FeexPay HTTP API **v2** — agrégateur mobile money + carte (Bénin/UEMOA).
// Réf. faisant autorité : SDK officiel `react-sdk-feexpay` v1.0.4 (v2), qui
// appelle https://api-v2.feexpay.me/api. Le dashboard v2 (app-v2.feexpay.me
// -> Développeurs) fournit l'« Identifiant » (shop) + la « Clé privée » (token).
// Auth : en-tête `Authorization: Bearer <token>` (+ `shop` dans le corps).
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

// Réseaux qui NE poussent PAS de confirmation sur le téléphone : FeexPay
// renvoie une `payment_url` que l'utilisateur doit ouvrir pour finaliser
// (page opérateur). Repris tel quel du SDK officiel (`iframeNetworks`).
// C'est le cas des DEUX opérateurs du Burkina Faso.
const REDIRECT_RESEAUX = new Set(['WAVE CI', 'ORANGE CI', 'MOOV BF', 'ORANGE BF']);

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

// Indicatif téléphonique par pays (ISO2) — nécessaire pour envoyer un numéro
// AU FORMAT INTERNATIONAL à FeexPay. Un numéro local ("70112233") n'atteint
// aucun opérateur : la demande de confirmation n'arrive jamais sur le mobile.
const DIAL_CODE = { bj: '229', ci: '225', bf: '226', cg: '242', sn: '221', tg: '228' };

// Longueur du numéro NATIONAL (sans indicatif). Indispensable : en Côte
// d'Ivoire et au Bénin, les numéros commencent par 0 (ex. "0102030405") et ce
// zéro fait partie du numéro — le retirer casserait l'appel.
const NATIONAL_LEN = { bj: 10, ci: 10, bf: 8, cg: 9, sn: 9, tg: 8 };

// Normalise un numéro : chiffres seulement + suppression d'un préfixe pays
// dupliqué (ex. "226226..." -> "226...") comme le fait le SDK officiel.
function normalizePhone(raw) {
  let s = String(raw || '').replace(/\D/g, '');
  if (s.length >= 8) {
    const p = s.slice(0, 3);
    if (s.startsWith(p + p)) s = s.slice(p.length);
  }
  return s;
}

// Numéro au format international attendu par FeexPay : <indicatif><numéro>,
// sans "+". Tolère toutes les saisies : "70112233", "+22670112233",
// "0022670112233", "0102030405" (CI). Sans pays connu, numéro nettoyé tel quel.
function toInternational(raw, iso2) {
  const cc = String(iso2 || '').toLowerCase();
  const dial = DIAL_CODE[cc];
  const len = NATIONAL_LEN[cc];
  let s = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  if (!dial) return normalizePhone(s);

  // Déjà à l'international (indicatif + bonne longueur nationale).
  if (s.startsWith(dial) && s.length === dial.length + len) return s;
  // Numéro national exact (le 0 initial de CI/BJ est CONSERVÉ).
  if (s.length === len) return `${dial}${s}`;
  // Ancien format avec préfixe interurbain "0" en trop (ex. BF "070112233").
  if (s.length === len + 1 && s.startsWith('0')) return `${dial}${s.slice(1)}`;
  // Cas restants : on déduplique un éventuel indicatif répété, puis on préfixe.
  s = normalizePhone(s);
  return s.startsWith(dial) ? s : `${dial}${s}`;
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
// Nom de pays FeexPay (BURKINA_FASO…) attendu par l'API v2.
function countryName(iso2) {
  return COUNTRY_NAME[String(iso2 || '').toLowerCase()] || 'BURKINA_FASO';
}

async function requestMobilePayment({ transactionId, amount, description, phone, network, country, customer }) {
  if (!isConfigured()) {
    throw new Error('FeexPay non configuré');
  }
  const reseau = mapReseau(country, network);
  // MTN rejette les caractères spéciaux dans la description.
  const desc = String(description || 'Abonnement ParisPromax').replace(/[^a-zA-Z0-9 ]/g, '');

  // Corps exigé par l'API v2 (cf. SDK react-sdk-feexpay) : `amount` en STRING,
  // `country` en toutes lettres, `custom_id` (et non `customId`), pas de
  // `token` dans le corps (il est dans l'en-tête Authorization).
  const body = {
    phoneNumber: toInternational(phone, country),
    country: countryName(country),
    amount: String(Math.round(Number(amount))),
    reseau,
    shop: config.feexpay.shopId,
    first_name: customer?.firstName || 'Client',
    email: fallbackEmail(customer),
    custom_id: transactionId, // renvoyé pour réconciliation
    otp: '',
    callback_info: { transaction_id: transactionId, user_id: customer?.id || null },
    description: desc,
    currency: 'XOF',
    payment_interface: 'API',
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
  // Réseaux à redirection (Orange/Moov BF, Orange/Wave CI) : sans ouvrir cette
  // URL, aucune confirmation n'atteint le client et le paiement expire.
  const paymentUrl = data.payment_url || null;
  return {
    reference: String(reference),
    status: mapStatus(data.status),
    paymentUrl,
    requiresRedirect: Boolean(paymentUrl) || REDIRECT_RESEAUX.has(reseau),
    raw: data,
  };
}

// --- CARTE (redirect) — interface provider standard ---------------------------
// ⚠️ FeexPay v2 : « Les paiements par cartes sont momentanément indisponibles »
// (message du SDK officiel). Le flux carte v1 (initcard) n'existe plus. On
// conserve l'interface provider pour le mock de dev, et on échoue explicitement
// en production : l'app ne doit proposer QUE le mobile money.
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
  throw new Error(
    'FeexPay: paiement par carte momentanément indisponible — utilisez le Mobile Money'
  );
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
// Fonctionne pour mobile money ET carte. Défense en profondeur : un statut
// SUCCESSFUL ne suffit pas, le MONTANT (et la devise si renvoyée) doit
// correspondre au paiement attendu — sinon on refuse d'activer l'abonnement.
async function verifyPayment(payment) {
  if (!isConfigured()) return { status: 'mock', method: null, raw: null };
  const ref = payment && payment.providerRef;
  if (!ref) return { status: 'pending', method: null, raw: null };

  // API v2 : GET /transactions/public/single/status/{reference} (Bearer).
  const { data } = await axios.get(
    `${config.feexpay.baseUrl}/transactions/public/single/status/${encodeURIComponent(ref)}`,
    { headers: headers(), timeout: 15000 }
  );

  let status = mapStatus(data.status);
  if (status === 'success') {
    // FeexPay prélève des frais (ex. 3,9 % Orange BF) : le montant renvoyé peut
    // être le montant de base OU base+frais. On refuse donc uniquement un
    // montant INFÉRIEUR à celui attendu (paiement partiel / transaction usurpée).
    const paidAmount = Number(data.amount);
    const expected = Math.round(Number(payment.amount));
    if (Number.isFinite(paidAmount) && Math.round(paidAmount) < expected) {
      console.error(
        `[feexpay] montant insuffisant sur ${ref}: reçu ${paidAmount}, attendu >= ${expected} -> refusé`
      );
      status = 'failed';
    }
    const cur = data.currency && String(data.currency).toUpperCase();
    if (cur && cur !== 'XOF') {
      console.error(`[feexpay] devise inattendue sur ${ref}: ${cur} -> refusé`);
      status = 'failed';
    }
  }
  return { status, method: payment.method || 'feexpay', raw: data };
}

module.exports = {
  initiatePayment,
  verifyPayment,
  requestMobilePayment,
  isConfigured,
  mapStatus,
  operatorsForCountry,
  mapReseau,
  toInternational,
  NETWORKS_BY_COUNTRY,
};
