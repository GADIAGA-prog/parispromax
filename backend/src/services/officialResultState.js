'use strict';

const DEFAULT_MAX_ATTEMPTS = 4;

function uniqueRunnerNumbers(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) return [];
    seen.add(number);
    return [number];
  });
}

function arrivalsCompatible(leftValue, rightValue) {
  const left = uniqueRunnerNumbers(leftValue);
  const right = uniqueRunnerNumbers(rightValue);
  const overlap = Math.min(left.length, right.length);
  return overlap === 0 || left.slice(0, overlap).every((number, index) => number === right[index]);
}

function mergeCompatibleArrival(currentValue, incomingValue) {
  const current = uniqueRunnerNumbers(currentValue);
  const incoming = uniqueRunnerNumbers(incomingValue);
  if (!arrivalsCompatible(current, incoming)) {
    return { arrival: current, compatible: false, changed: false };
  }
  const arrival = incoming.length > current.length ? incoming : current;
  return {
    arrival,
    compatible: true,
    changed: arrival.length !== current.length,
  };
}

function retryableTransactionError(error) {
  return error?.code === 'P2034';
}

// Result is a shared row: ECD, national, the generic result job and the admin
// may all complete it. Serializable isolation turns a concurrent stale write
// into P2034; retrying then rebuilds the merge from the latest committed row.
async function serializableTransaction(db, operation, { maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  const attempts = Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === attempts) throw error;
    }
  }
  throw new Error('transaction officielle non finalisee');
}

module.exports = {
  uniqueRunnerNumbers,
  arrivalsCompatible,
  mergeCompatibleArrival,
  retryableTransactionError,
  serializableTransaction,
};
