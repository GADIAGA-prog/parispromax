const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../auth');
const cinetpay = require('../services/cinetpay');
const fedapay = require('../services/fedapay');
const psp = require('../services/paymentProvider'); // active provider (config)
const { activateSubscription } = require('../services/subscription');
const { getPlan } = require('../plans');

const router = express.Router();

function genTxnId() {
  return `PPM-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// POST /payments/initiate  (auth)  { planId, method?, channels? }
// Creates a pending Payment for a plan and returns the PSP payment URL.
router.post('/initiate', requireAuth, async (req, res) => {
  try {
    const plan = getPlan(req.body.planId);
    if (!plan) return res.status(400).json({ error: 'Plan invalide' });

    const amount = plan.pricePromo;
    const transactionId = genTxnId();
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    const payment = await prisma.payment.create({
      data: {
        userId: req.userId,
        provider: psp.name,
        transactionId,
        amount,
        currency: 'XOF',
        plan: plan.id,
        method: req.body.method || null,
        status: 'pending',
        description: `Abonnement ParisPromax — ${plan.label}`,
      },
    });

    const init = await psp.initiatePayment({
      transactionId,
      amount,
      currency: 'XOF',
      description: payment.description,
      customer: { id: req.userId, phone: user?.phone },
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
      provider: psp.name,
      amount,
      currency: 'XOF',
      plan: plan.id,
    });
  } catch (e) {
    const pdata = e.response?.data;
    console.error('initiate error', pdata || e.message);
    // TEMP diagnostic: expose the provider's (non-secret) error so we can debug
    // the live config. Remove once payments are confirmed working.
    res.status(500).json({
      error: "Échec de l'initialisation du paiement",
      providerStatus: e.response?.status || null,
      providerError:
        typeof pdata === 'object' ? pdata : pdata ? String(pdata).slice(0, 300) : e.message,
    });
  }
});

// Mark a payment successful + activate subscription (idempotent).
async function finalizePaymentSuccess(payment, { method, raw } = {}) {
  if (!payment) return null;
  if (payment.status === 'success') return payment; // idempotent

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'success',
      method: method || payment.method,
      rawPayload: raw ? JSON.stringify(raw) : payment.rawPayload,
    },
  });
  if (payment.userId) {
    const plan = getPlan(payment.plan) || { days: 30, id: payment.plan };
    await activateSubscription(payment.userId, plan.days, plan.id);
  }
  return updated;
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
  const provider = payment.provider === 'cinetpay' ? cinetpay : fedapay;
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

// POST /payments/cinetpay/webhook  (public — called by CinetPay)
// We re-verify the transaction with CinetPay before trusting it.
router.post('/cinetpay/webhook', async (req, res) => {
  const transactionId =
    req.body.cpm_trans_id || req.body.transaction_id || req.query.transaction_id;
  if (!transactionId) return res.status(400).send('missing transaction id');

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
const config = require('../config');
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
