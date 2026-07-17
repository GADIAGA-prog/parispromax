const prisma = require('../db');

// Activate (or extend) a user's subscription after a successful payment.
// `days` and `planId` come from the purchased plan.
async function activateSubscription(userId, days, planId, db = prisma) {
  const periodMs = (days || 30) * 24 * 60 * 60 * 1000;

  const existing = await db.subscription.findFirst({
    where: { userId },
    orderBy: { currentPeriodEnd: 'desc' },
  });

  // Extend from the later of now / current end (stacking remaining time).
  const base =
    existing?.currentPeriodEnd && existing.currentPeriodEnd > new Date()
      ? existing.currentPeriodEnd.getTime()
      : Date.now();
  const currentPeriodEnd = new Date(base + periodMs);

  if (existing) {
    return db.subscription.update({
      where: { id: existing.id },
      data: { status: 'active', plan: planId || existing.plan, currentPeriodEnd },
    });
  }
  return db.subscription.create({
    data: { userId, plan: planId || 'monthly', status: 'active', currentPeriodEnd },
  });
}

// Access = an active (non-expired) paid subscription. No trial anymore.
async function getAccess(userId) {
  const now = new Date();
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: 'active', currentPeriodEnd: { gt: now } },
    orderBy: { currentPeriodEnd: 'desc' },
  });

  const hasPaid = !!sub;
  return {
    hasAccess: hasPaid,
    hasPaid,
    plan: sub?.plan || null,
    paidUntil: sub?.currentPeriodEnd || null,
  };
}

module.exports = { activateSubscription, getAccess };
