const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../auth');
const cinetpay = require('../services/cinetpay');
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
        provider: 'cinetpay',
        transactionId,
        amount,
        currency: 'XOF',
        plan: plan.id,
        method: req.body.method || null,
        status: 'pending',
        description: `Abonnement ParisPromax — ${plan.label}`,
      },
    });

    const init = await cinetpay.initiatePayment({
      transactionId,
      amount,
      currency: 'XOF',
      description: payment.description,
      customer: { id: req.userId, phone: user?.phone },
      channels: req.body.channels || 'ALL',
    });

    res.json({
      transactionId,
      paymentUrl: init.paymentUrl,
      mode: init.mode,
      amount,
      currency: 'XOF',
      plan: plan.id,
    });
  } catch (e) {
    console.error('initiate error', e.message);
    res.status(500).json({ error: "Échec de l'initialisation du paiement" });
  }
});

// Shared: mark a payment successful + activate subscription (idempotent).
async function finalizeSuccess(transactionId, { method, raw } = {}) {
  const payment = await prisma.payment.findUnique({ where: { transactionId } });
  if (!payment) return null;
  if (payment.status === 'success') return payment; // idempotent

  const updated = await prisma.payment.update({
    where: { transactionId },
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

// POST /payments/cinetpay/webhook  (public — called by CinetPay)
// We re-verify the transaction with CinetPay before trusting it.
router.post('/cinetpay/webhook', async (req, res) => {
  const transactionId =
    req.body.cpm_trans_id || req.body.transaction_id || req.query.transaction_id;
  if (!transactionId) return res.status(400).send('missing transaction id');

  try {
    const verify = await cinetpay.verifyPayment(transactionId);
    if (verify.status === 'success') {
      await finalizeSuccess(transactionId, { method: verify.method, raw: verify.raw });
    } else if (verify.status === 'failed') {
      await prisma.payment.updateMany({
        where: { transactionId },
        data: { status: 'failed', rawPayload: JSON.stringify(verify.raw || req.body) },
      });
    }
    // Always 200 so the PSP stops retrying.
    res.status(200).send('OK');
  } catch (e) {
    console.error('webhook error', e);
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

// --- MOCK checkout (only used when CinetPay keys are not configured) -------
// A tiny page that lets you simulate a successful or failed payment.
router.get('/mock/:txn', (req, res) => {
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

router.post('/mock/:txn/complete', express.urlencoded({ extended: true }), async (req, res) => {
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
router.get('/status/:txn', requireAuth, async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { transactionId: req.params.txn } });
  if (!payment || payment.userId !== req.userId) {
    return res.status(404).json({ error: 'Introuvable' });
  }
  res.json({ status: payment.status, transactionId: payment.transactionId });
});

module.exports = router;
