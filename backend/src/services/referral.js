const crypto = require('crypto');
const prisma = require('../db');

function normalizeReferralCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function ensureReferralCode(userId, db = prisma) {
  const current = await db.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (!current) return null;
  if (current.referralCode) return current.referralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referralCode = `PPM${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    try {
      await db.user.update({ where: { id: userId }, data: { referralCode } });
      return referralCode;
    } catch (error) {
      if (error.code !== 'P2002') throw error;
    }
  }
  throw new Error('Impossible de générer un code de parrainage unique');
}

async function backfillReferralCodes() {
  const users = await prisma.user.findMany({ where: { referralCode: null }, select: { id: true } });
  for (const user of users) await ensureReferralCode(user.id);
  return users.length;
}

module.exports = { ensureReferralCode, normalizeReferralCode, backfillReferralCodes };
