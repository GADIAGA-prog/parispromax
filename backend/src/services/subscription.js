const prisma = require('../db');
const { getPlan } = require('../plans');

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

function referralRewardDays(purchasedDays) {
  const days = Number(purchasedDays);
  return Number.isFinite(days) && days > 0 ? days / 2 : 0;
}

// Reward a sponsor exactly once, using the referred user's FIRST successful
// subscription payment. A later renewal can never change the reward duration.
async function rewardSponsorForFirstSubscription(
  referredId,
  db = prisma,
  activate = activateSubscription
) {
  const referral = await db.referral.findUnique({ where: { referredId } });
  if (referral?.status !== 'pending') return null;

  const firstPayment = await db.payment.findFirst({
    where: { userId: referredId, status: 'success' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!firstPayment) return null;

  const firstPlan = getPlan(firstPayment.plan) || { days: 30 };
  const rewardDays = referralRewardDays(firstPlan.days);
  if (!rewardDays) return null;

  const claimed = await db.referral.updateMany({
    where: { id: referral.id, status: 'pending' },
    data: { status: 'rewarded', rewardedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  await activate(referral.sponsorId, rewardDays, 'referral-bonus', db);
  return { firstPaymentId: firstPayment.id, rewardDays };
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

module.exports = {
  activateSubscription,
  referralRewardDays,
  rewardSponsorForFirstSubscription,
  getAccess,
};
