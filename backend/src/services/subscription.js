const prisma = require('../db');
const config = require('../config');

// Activate (or extend) a user's paid subscription after a successful payment.
async function activateSubscription(userId) {
  const periodMs = config.subscription.periodDays * 24 * 60 * 60 * 1000;

  const existing = await prisma.subscription.findFirst({
    where: { userId, plan: 'monthly' },
    orderBy: { createdAt: 'desc' },
  });

  // Extend from the later of now / current end.
  const base =
    existing?.currentPeriodEnd && existing.currentPeriodEnd > new Date()
      ? existing.currentPeriodEnd.getTime()
      : Date.now();
  const currentPeriodEnd = new Date(base + periodMs);

  if (existing) {
    return prisma.subscription.update({
      where: { id: existing.id },
      data: { status: 'active', currentPeriodEnd },
    });
  }
  return prisma.subscription.create({
    data: { userId, plan: 'monthly', status: 'active', currentPeriodEnd },
  });
}

// Compute current access for a user: paid OR trial still valid.
async function getAccess(userId) {
  const subs = await prisma.subscription.findMany({ where: { userId } });
  const now = new Date();
  let hasPaid = false;
  let trialActive = false;
  let trialEnd = null;
  let paidEnd = null;

  for (const s of subs) {
    if (s.status === 'active' && s.currentPeriodEnd && s.currentPeriodEnd > now) {
      if (s.plan === 'monthly') {
        hasPaid = true;
        paidEnd = s.currentPeriodEnd;
      } else if (s.plan === 'trial') {
        trialActive = true;
        trialEnd = s.currentPeriodEnd;
      }
    }
  }

  return {
    hasAccess: hasPaid || trialActive,
    hasPaid,
    trialActive,
    trialEnd,
    paidEnd,
  };
}

module.exports = { activateSubscription, getAccess };
