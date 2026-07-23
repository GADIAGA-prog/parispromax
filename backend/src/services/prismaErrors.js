function isUniqueConstraintOn(error, field) {
  if (!error || error.code !== 'P2002') return false;

  const expected = String(field || '').trim().toLowerCase();
  if (!expected) return false;

  const target = error.meta?.target;
  const targets = Array.isArray(target) ? target : [target];
  return targets.some((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === expected || normalized.includes(`_${expected}_`);
  });
}

const TRANSIENT_DATABASE_CODES = new Set([
  'P1001', // database server unreachable
  'P1002', // database connection timed out
  'P1008', // operation timed out
  'P1017', // server closed the connection
  'P2024', // connection-pool timeout
]);

function isTransientDatabaseError(error) {
  if (!error) return false;
  if (TRANSIENT_DATABASE_CODES.has(String(error.code || '').toUpperCase())) return true;
  return ['PrismaClientInitializationError', 'PrismaClientRustPanicError'].includes(error.name);
}

module.exports = { isUniqueConstraintOn, isTransientDatabaseError };
