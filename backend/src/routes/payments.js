const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
const cinetpay = require('../services/cinetpay');
const fedapay = require('../services/fedapay');
const paydunya = require('../services/paydunya');
const ligdicash = require('../services/ligdicash');
const feexpay = require('../services/feexpay');
const pawapay = require('../services/pawapay');
const { getProvider, availableProviders, defaultName } = require('../services/paymentProvider');
const { activateSubscription } = require('../services/subscription');
const { getPlan } = require('../plans');
const { safeEqual } = require('../security');

const router = express.Router();

// Diagnostic detail on provider errors, only for callers holding the cron token.
function diagAllowed(req) {
  return Boolean(req.query.diag && config.cronToken && safeEqual(String(req.query.diag), config.cronToken));
}

// GET /payments/providers — the payment options the app should offer (only the
// ones actually usable right now). Public.
router.get('/providers', (_req, res) => {
  res.json({ providers: availableProviders(), default: defaultName });
});

function genTxnId() {
  return `PPM-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function priceForUser(userId, plan) {
  const [referral, successes, discountedPending] = await Promise.all([
    prisma.referral.findUnique({ where: { referredId: userId } }),
    prisma.payment.count({ where: { userId, status: 'success' } }),
    prisma.payment.count({
      where: {
        userId, status: 'pending', referralDiscount: { gt: 0 },
        createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
      },
    }),
  ]);
  const eligible = referral?.status === 'pending' && successes === 0 && discountedPending === 0;
  const discount = eligible ? Math.round(plan.pricePromo * config.referral.discountPercent / 100) : 0;
  return { amount: Math.max(0, plan.pricePromo - discount), discount };
}

// POST /payments/initiate  (auth)  { planId, method?, channels? }
// Creates a pending Payment for a plan and returns the PSP payment URL.
router.post('/initiate', requireAuth, async (req, res) => {
  try {
    const plan = getPlan(req.body.planId);
    if (!plan) return res.status(400).json({ error: 'Plan invalide' });

    // Pick a usable provider: the requested one if available, else the default.
    const avail = availableProviders();
    const chosenId =
      req.body.provider && avail.some((p) => p.id === req.body.provider)
        ? req.body.provider
        : avail.find((p) => p.id === defaultName)?.id || avail[0]?.id;
    if (!chosenId) return res.status(400).json({ error: 'Aucun moyen de paiement disponible' });
    const provider = getProvider(chosenId);

    const { amount, discount } = await priceForUser(req.userId, plan);
    const transactionId = genTxnId();
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    const payment = await prisma.payment.create({
      data: {
        userId: req.userId,
        provider: provider.name,
        transactionId,
        amount,
        baseAmount: plan.pricePromo,
        referralDiscount: discount,
        currency: 'XOF',
        plan: plan.id,
        method: req.body.method || null,
        status: 'pending',
        description: `Abonnement ParisPromax — ${plan.label}`,
      },
    });

    const init = await provider.initiatePayment({
      transactionId,
      amount,
      currency: 'XOF',
      description: payment.description,
      customer: { id: req.userId, phone: user?.phone, country: user?.country },
      channels: req.body.channels || 'ALL',
    });

    // Persist the provider's own reference (e.g. FedaPay transaction id) so
    // webhook + polling can reconcile it back to this payment.
    if (init.providerRef) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { providerRef: init.providerRef },
      });
    }

    res.json({
      transactionId,
      paymentUrl: init.paymentUrl,
      mode: init.mode,
      provider: provider.name,
      amount,
      currency: 'XOF',
      plan: plan.id,
    });
  } catch (e) {
    console.error('initiate error', e.response?.data || e.message);
    const body = { error: "Échec de l'initialisation du paiement" };
    // Provider error detail, gated behind the admin/cron token (safe in prod).
    if (diagAllowed(req)) {
      const pdata = e.response?.data;
      body.providerStatus = e.response?.status || null;
      body.providerError =
        typeof pdata === 'object' ? pdata : pdata ? String(pdata).slice(0, 500) : e.message;
    }
    res.status(500).json(body);
  }
});

// Mark a payment successful + activate subscription (idempotent). The
// updateMany with a status filter is the atomic guard: when a webhook and the
// status poller race, only ONE caller flips pending -> success, so the
// subscription can never be activated (and extended) twice for one payment.
async function finalizePaymentSuccess(payment, { method, raw } = {}) {
  if (!payment) return null;
  if (payment.status === 'success') return payment;
  await prisma.$transaction(async (tx) => {
    const flipped = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: 'success' } },
      data: {
        status: 'success', method: method || payment.method,
        rawPayload: raw ? JSON.stringify(raw) : payment.rawPayload,
      },
    });
    if (flipped.count !== 1 || !payment.userId) return;
    const plan = getPlan(payment.plan) || { days: 30, id: payment.plan };
    await activateSubscription(payment.userId, plan.days, plan.id, tx);
    if (payment.referralDiscount > 0) {
      const referral = await tx.referral.findUnique({ where: { referredId: payment.userId } });
      if (referral?.status === 'pending') {
        await tx.referral.update({ where: { id: referral.id }, data: { status: 'rewarded', rewardedAt: new Date() } });
        await activateSubscription(referral.sponsorId, config.referral.rewardDays, 'referral-bonus', tx);
      }
    }
  });
  return prisma.payment.findUnique({ where: { id: payment.id } });
}

async function markFailed(payment, raw) {
  if (!payment || payment.status === 'success') return;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'failed', rawPayload: raw ? JSON.stringify(raw) : payment.rawPayload },
  });
}

// By our transaction id (used by mock + CinetPay which key on our id).
async function finalizeSuccess(transactionId, opts) {
  const payment = await prisma.payment.findUnique({ where: { transactionId } });
  return finalizePaymentSuccess(payment, opts);
}

// Re-verify a pending payment with its provider and finalize accordingly.
// Returns the (possibly updated) payment. Safe no-op in mock mode.
async function reconcile(payment) {
  if (!payment || payment.status !== 'pending') return payment;
  const provider = getProvider(payment.provider); // resolves by stored provider name
  if (!provider.isConfigured()) return payment; // mock: trust stored status
  try {
    const verify = await provider.verifyPayment(payment);
    if (verify.status === 'success') {
      return (await finalizePaymentSuccess(payment, { method: verify.method, raw: verify.raw })) || payment;
    }
    if (verify.status === 'failed') {
      await markFailed(payment, verify.raw);
      return prisma.payment.findUnique({ where: { id: payment.id } });
    }
  } catch (e) {
    console.error('reconcile error', e.response?.data || e.message);
  }
  return payment;
}

// POST /payments/cinetpay/webhook  (public — CinetPay notify_url)
// We re-verify the transaction with CinetPay before trusting it. Accepts both
// the new API (merchant_transaction_id) and legacy (cpm_trans_id) field names,
// JSON or form-encoded.
router.post('/cinetpay/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  const b = req.body || {};
  const transactionId =
    b.merchant_transaction_id || b.cpm_trans_id || b.transaction_id ||
    b.data?.merchant_transaction_id || req.query.transaction_id;
  if (!transactionId) return res.status(200).send('OK'); // nothing to reconcile

  try {
    const payment = await prisma.payment.findUnique({ where: { transactionId } });
    if (payment) {
      const verify = await cinetpay.verifyPayment(payment);
      if (verify.status === 'success') {
        await finalizePaymentSuccess(payment, { method: verify.method, raw: verify.raw });
      } else if (verify.status === 'failed') {
        await markFailed(payment, verify.raw || req.body);
      }
    }
    res.status(200).send('OK'); // always 200 so the PSP stops retrying
  } catch (e) {
    console.error('cinetpay webhook error', e);
    res.status(200).send('OK');
  }
});

// POST /payments/fedapay/webhook  (public — called by FedaPay)
// FedaPay identifies the transaction by its own id (entity.id); we look up our
// payment by providerRef and re-verify against the FedaPay API before trusting.
router.post('/fedapay/webhook', async (req, res) => {
  try {
    const entity = req.body?.entity || req.body?.data || req.body || {};
    const fedaId = entity.id || entity.transaction_id;
    if (fedaId) {
      const payment = await prisma.payment.findFirst({
        where: { providerRef: String(fedaId) },
      });
      if (payment) {
        const verify = await fedapay.verifyPayment(payment);
        if (verify.status === 'success') {
          await finalizePaymentSuccess(payment, { method: verify.method, raw: verify.raw });
        } else if (verify.status === 'failed') {
          await markFailed(payment, verify.raw || req.body);
        }
      }
    }
    res.status(200).send('OK'); // always 200 so FedaPay stops retrying
  } catch (e) {
    console.error('fedapay webhook error', e);
    res.status(200).send('OK');
  }
});

// POST /payments/paydunya/webhook  (public — PayDunya IPN, form-urlencoded)
// PayDunya posts data[invoice][token] + data[status]; we look up by token and
// re-verify against the PayDunya API before trusting it.
router.post('/paydunya/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const d = req.body?.data || {};
    const token = d.invoice?.token || d.token;
    if (token) {
      const payment = await prisma.payment.findFirst({ where: { providerRef: String(token) } });
      if (payment) {
        const verify = await paydunya.verifyPayment(payment);
        if (verify.status === 'success') {
          await finalizePaymentSuccess(payment, { method: verify.method, raw: verify.raw });
        } else if (verify.status === 'failed') {
          await markFailed(payment, verify.raw || req.body);
        }
      }
    }
    res.status(200).send('OK'); // always 200 so PayDunya stops retrying
  } catch (e) {
    console.error('paydunya webhook error', e);
    res.status(200).send('OK');
  }
});

// POST /payments/ligdicash/webhook  (public — LigdiCash callback_url)
// LigdiCash renvoie le token de la facture (+ custom_data/external_id). On
// retrouve le paiement par token (providerRef), sinon par notre external_id
// (transactionId), puis on RE-VÉRIFIE le statut via l'API avant d'y croire.
router.post('/ligdicash/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const b = req.body || {};
    const token = b.token || b.invoiceToken || b.invoice_token || b.data?.token || req.query.token;
    const externalId =
      b.external_id || b.custom_data?.transaction_id || b.data?.external_id || req.query.external_id;

    let payment = null;
    if (token) payment = await prisma.payment.findFirst({ where: { providerRef: String(token) } });
    if (!payment && externalId) {
      payment = await prisma.payment.findUnique({ where: { transactionId: String(externalId) } });
    }

    if (payment) {
      const verify = await ligdicash.verifyPayment(payment);
      if (verify.status === 'success') {
        await finalizePaymentSuccess(payment, { method: verify.method, raw: verify.raw });
      } else if (verify.status === 'failed') {
        await markFailed(payment, verify.raw || req.body);
      }
    }
    res.status(200).send('OK'); // toujours 200 pour que LigdiCash arrête de réessayer
  } catch (e) {
    console.error('ligdicash webhook error', e);
    res.status(200).send('OK');
  }
});

// GET /payments/feexpay/operators?country=bf — opérateurs mobile money que
// FeexPay supporte pour un pays (ISO2). Public — alimente le sélecteur de l'app.
// `otpRequired` indique les opérateurs pour lesquels l'app doit demander un
// code OTP au client (Orange Sénégal, Coris Bénin). `redirectRequired` indique
// ceux dont la validation se poursuit sur une page sécurisée FeexPay.
router.get('/feexpay/operators', (req, res) => {
  const country = String(req.query.country || '').toLowerCase();
  const operators = feexpay.operatorsForCountry(country);
  res.json({
    country,
    operators,
    otpRequired: operators.filter((op) => feexpay.requiresOtp(country, op)),
    redirectRequired: operators.filter((op) => feexpay.usesRedirect(country, op)),
  });
});

// POST /payments/feexpay/mobile  (auth)  { planId, phone, network, country? }
// Mobile money FeexPay : selon l'opérateur, FeexPay pousse une confirmation sur
// le téléphone ou renvoie une page sécurisée à ouvrir. On crée un Payment en
// attente, on déclenche requesttopay, puis l'app suit /payments/status/:txn.
router.post('/feexpay/mobile', requireAuth, async (req, res) => {
  try {
    if (!feexpay.isConfigured() && !config.allowMock) {
      return res.status(400).json({ error: 'FeexPay non disponible' });
    }
    const plan = getPlan(req.body.planId);
    if (!plan) return res.status(400).json({ error: 'Plan invalide' });
    const phone = String(req.body.phone || '').trim();
    const network = String(req.body.network || '').trim();
    if (!phone || !network) return res.status(400).json({ error: 'Numéro et opérateur requis' });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    const country = String(req.body.country || user?.country || 'bf').toLowerCase();
    const { amount, discount } = await priceForUser(req.userId, plan);
    const transactionId = genTxnId();

    const payment = await prisma.payment.create({
      data: {
        userId: req.userId,
        provider: 'feexpay',
        transactionId,
        amount,
        baseAmount: plan.pricePromo,
        referralDiscount: discount,
        currency: 'XOF',
        plan: plan.id,
        method: `mobile:${network.toUpperCase()}`,
        status: 'pending',
        description: `Abonnement ParisPromax — ${plan.label}`,
      },
    });

    // MOCK (dev uniquement) : simule la confirmation Mobile Money après ~8 s,
    // pour tester tout le parcours (demande -> polling -> activation) sans
    // clés FeexPay. Jamais actif en production (config.allowMock).
    if (!feexpay.isConfigured()) {
      setTimeout(() => {
        finalizeSuccess(transactionId, { method: payment.method, raw: { mock: true } }).catch((e) =>
          console.error('mock feexpay finalize error', e)
        );
      }, 8000);
      return res.json({
        transactionId,
        reference: `MOCK-${transactionId}`,
        status: 'pending',
        mode: 'mock',
        provider: 'feexpay',
        amount,
        referralDiscount: discount,
        currency: 'XOF',
        plan: plan.id,
      });
    }

    const result = await feexpay.requestMobilePayment({
      transactionId,
      amount,
      description: payment.description,
      phone,
      network,
      country,
      otp: req.body.otp, // requis par Orange Sénégal / Coris Bénin uniquement
      customer: { id: req.userId, phone: user?.phone, country, ip: req.ip },
    });

    await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: result.reference } });

    // FeexPay peut déjà renvoyer un statut terminal (sandbox -> SUCCESSFUL direct).
    if (result.status === 'success') {
      await finalizePaymentSuccess(payment, { method: payment.method, raw: result.raw });
    } else if (result.status === 'failed') {
      await markFailed(payment, result.raw);
    }

    res.json({
      transactionId,
      reference: result.reference,
      status: result.status,
      // Selon l'opérateur : soit une page de validation à ouvrir (Wave CI…),
      // soit un message d'instruction du PSP (Orange/Moov BF : code USSD).
      paymentUrl: result.paymentUrl || null,
      redirectExpected: result.redirectExpected,
      providerMessage: result.providerMessage || null,
      provider: 'feexpay',
      amount,
      currency: 'XOF',
      plan: plan.id,
    });
  } catch (e) {
    const pdata = e.response?.data;
    console.error(
      'feexpay mobile error',
      e.response?.status || '',
      typeof pdata === 'object' ? JSON.stringify(pdata) : pdata || e.message
    );
    const body = { error: 'Échec du paiement mobile money' };
    // Motif court renvoyé à l'app : c'est un message de validation du PSP
    // (numéro invalide, opérateur indisponible…), jamais un secret. Sans lui,
    // l'utilisateur — et le support — sont aveugles.
    const reason =
      (pdata && (pdata.message || pdata.error || pdata.detail)) ||
      (typeof pdata === 'string' ? pdata : null);
    if (reason) body.reason = String(reason).slice(0, 200);
    if (diagAllowed(req)) {
      body.providerStatus = e.response?.status || null;
      body.providerError =
        typeof pdata === 'object' ? pdata : pdata ? String(pdata).slice(0, 500) : e.message;
    }
    res.status(500).json(body);
  }
});

// Vérifie le secret partagé du webhook FeexPay quand il est configuré.
// FeexPay envoie l'en-tête choisi dans son dashboard (Bearer <secret>).
// Sans secret configuré -> pas de contrôle (le statut est re-vérifié via l'API).
function feexpayWebhookAuthorized(req) {
  const secret = config.feexpay.webhookSecret;
  if (!secret) return true;
  const header = String(req.headers.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : header;
  return safeEqual(supplied, secret);
}

// POST /payments/feexpay/webhook  (public — FeexPay callback)
// On retrouve le paiement par référence (providerRef) ou par notre customId
// (transactionId, renvoyé dans callback_info), puis on RE-VÉRIFIE avant d'y croire.
router.post('/feexpay/webhook', async (req, res) => {
  if (!feexpayWebhookAuthorized(req)) {
    console.warn('[feexpay webhook] en-tête d’authentification invalide — ignoré');
    return res.status(401).send('unauthorized');
  }
  try {
    const b = req.body || {};
    const reference = b.reference || b.transref || b.transaction_id || b.data?.reference;
    const customId = b.customId || b.callback_info?.transaction_id || b.data?.customId;

    let payment = null;
    if (reference) payment = await prisma.payment.findFirst({ where: { providerRef: String(reference) } });
    if (!payment && customId) {
      payment = await prisma.payment.findUnique({ where: { transactionId: String(customId) } });
    }

    if (payment) {
      const verify = await feexpay.verifyPayment(payment);
      if (verify.status === 'success') {
        await finalizePaymentSuccess(payment, { method: verify.method, raw: verify.raw });
      } else if (verify.status === 'failed') {
        await markFailed(payment, verify.raw || req.body);
      }
    }
    res.status(200).send('OK'); // toujours 200
  } catch (e) {
    console.error('feexpay webhook error', e);
    res.status(200).send('OK');
  }
});

// POST /payments/pawapay/webhook — le callback n'est jamais cru directement :
// le statut est relu depuis l'API pawaPay avant toute activation d'abonnement.
router.post('/pawapay/webhook', async (req, res) => {
  try {
    const depositId = String(req.body?.depositId || '');
    if (!depositId) return res.status(400).send('missing depositId');
    const payment = await prisma.payment.findFirst({
      where: { provider: 'pawapay', providerRef: depositId },
    });
    if (!payment) return res.status(404).send('not found');
    const verified = await pawapay.verifyPayment(payment);
    if (verified.status === 'success') {
      await finalizePaymentSuccess(payment, { method: verified.method, raw: verified.raw });
    } else if (verified.status === 'failed') {
      await markFailed(payment, verified.raw);
    }
    return res.send('ok');
  } catch (error) {
    console.error('pawapay webhook error', error.response?.data || error.message);
    return res.status(500).send('error');
  }
});

// GET /payments/return — user is redirected here after paying.
router.get('/return', (req, res) => {
  res.send(
    '<html><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;text-align:center;padding-top:60px">' +
      '<h2>Merci !</h2><p>Votre paiement est en cours de validation.</p>' +
      '<p>Vous pouvez revenir dans l\'application ParisPromax.</p></body></html>'
  );
});

// --- MOCK checkout (only when no provider is configured, and NEVER in prod) --
// A tiny page that lets you simulate a successful or failed payment. Guarded by
// config.allowMock so it can never be used to grant free access in production.
function mockGuard(req, res, next) {
  if (!config.allowMock) return res.status(404).send('Not found');
  next();
}

router.get('/mock/:txn', mockGuard, (req, res) => {
  const { txn } = req.params;
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement (mock)</title></head>
  <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;text-align:center;padding:40px">
    <h2>💳 Paiement simulé</h2>
    <p>Transaction : <code>${txn}</code></p>
    <p style="color:#94a3b8">Mode mock (clés CinetPay non configurées)</p>
    <form method="POST" action="/payments/mock/${txn}/complete">
      <button name="result" value="success" style="background:#10b981;border:0;color:#06251c;font-weight:800;padding:14px 28px;border-radius:12px;font-size:16px;margin:8px">✅ Simuler un paiement réussi</button>
      <br/>
      <button name="result" value="failed" style="background:#ef4444;border:0;color:#fff;font-weight:800;padding:14px 28px;border-radius:12px;font-size:16px;margin:8px">❌ Simuler un échec</button>
    </form>
  </body></html>`);
});

router.post('/mock/:txn/complete', mockGuard, express.urlencoded({ extended: true }), async (req, res) => {
  const { txn } = req.params;
  const result = req.body.result;
  if (result === 'success') {
    await finalizeSuccess(txn, { method: 'mock', raw: { mock: true } });
    return res.send('<body style="background:#0f172a;color:#10b981;font-family:sans-serif;text-align:center;padding-top:60px"><h2>✅ Paiement réussi (mock)</h2><p>Abonnement activé. Revenez dans l\'app.</p></body>');
  }
  await prisma.payment.updateMany({ where: { transactionId: txn }, data: { status: 'failed' } });
  res.send('<body style="background:#0f172a;color:#ef4444;font-family:sans-serif;text-align:center;padding-top:60px"><h2>❌ Paiement échoué (mock)</h2></body>');
});

// GET /payments/me  (auth) — the logged-in user's payment history.
router.get('/me', requireAuth, async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ payments });
});

// GET /payments/status/:txn (auth) — poll a single payment's status.
// Ownership-checked: a user may only read their OWN payment (prevents IDOR).
// If still pending, we re-verify with the provider so the app gets an
// authoritative status even when no public webhook can reach the backend.
router.get('/status/:txn', requireAuth, async (req, res) => {
  let payment = await prisma.payment.findUnique({ where: { transactionId: req.params.txn } });
  if (!payment || payment.userId !== req.userId) {
    return res.status(404).json({ error: 'Introuvable' });
  }
  payment = (await reconcile(payment)) || payment;
  res.json({ status: payment.status, transactionId: payment.transactionId });
});

module.exports = router;
