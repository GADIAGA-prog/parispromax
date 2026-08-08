'use strict';

const { syncOfficialEcdData } = require('./ecdOfficialSource');
const { syncOfficialNationalData } = require('./nationalOfficialSource');

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const inFlight = new Map();
const lastStartedAt = new Map();

function normalizeDates(values) {
  return [...new Set((values || []).map(String).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))]
    .sort();
}

function syncHasFailures(value) {
  if (Array.isArray(value)) return value.some(syncHasFailures);
  if (!value || typeof value !== 'object') return false;
  if (value.error || Number(value.failed || 0) > 0 || Number(value?.payouts?.failed || 0) > 0) {
    return true;
  }
  return Object.values(value).some((entry) => (
    entry && typeof entry === 'object' ? syncHasFailures(entry) : false
  ));
}

function collectFailedDates(value, failed = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectFailedDates(entry, failed));
    return failed;
  }
  if (!value || typeof value !== 'object') return failed;
  if (value.date && syncHasFailures(value)) failed.add(String(value.date));
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object') collectFailedDates(entry, failed);
  });
  return failed;
}

// A race may be both ECD and the national support. Sequential synchronization
// prevents two payout read/modify/write cycles from overwriting one another.
async function syncOfficialResultsData(options = {}) {
  const ecd = await syncOfficialEcdData(options);
  const national = await syncOfficialNationalData(options);
  return { ecd, national };
}

function triggerOfficialCatchup({
  country,
  dates,
  syncFn = syncOfficialResultsData,
  logger = console,
  now = Date.now,
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
  const normalizedCountry = String(country || '').trim().toLowerCase();
  const normalizedDates = normalizeDates(dates);
  if (!normalizedCountry || !normalizedDates.length) {
    return { started: false, reason: 'nothing-to-sync', task: null };
  }

  const currentTime = Number(now());
  const runningTasks = new Set();
  const startableDates = [];
  for (const date of normalizedDates) {
    const key = `${normalizedCountry}:${date}`;
    if (inFlight.has(key)) {
      runningTasks.add(inFlight.get(key));
      continue;
    }
    const previous = lastStartedAt.get(key);
    if (!Number.isFinite(previous) || currentTime - previous >= cooldownMs) {
      startableDates.push(date);
    }
  }
  if (!startableDates.length) {
    return runningTasks.size
      ? { started: false, reason: 'already-running', task: Promise.all([...runningTasks]) }
      : { started: false, reason: 'cooldown', task: null };
  }

  const keys = startableDates.map((date) => `${normalizedCountry}:${date}`);
  keys.forEach((key) => lastStartedAt.set(key, currentTime));
  const task = Promise.resolve()
    .then(() => syncFn({ dates: startableDates, countries: [normalizedCountry], force: false }))
    .then((result) => {
      if (syncHasFailures(result)) {
        const failedDates = collectFailedDates(result);
        keys.forEach((key) => {
          const date = key.slice(normalizedCountry.length + 1);
          if (!failedDates.size || failedDates.has(date)) lastStartedAt.delete(key);
        });
        logger.error?.('[history] rattrapage des rapports officiels incomplet; nouvelle tentative autorisée');
      }
      return result;
    })
    .catch((error) => {
      keys.forEach((key) => lastStartedAt.delete(key));
      logger.error?.(`[history] rattrapage des rapports officiels: ${error.message}`);
      return null;
    })
    .finally(() => keys.forEach((key) => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }));
  keys.forEach((key) => inFlight.set(key, task));
  return { started: true, reason: 'started', task };
}

// Compatibility for code/tests deployed with the previous ECD-only name.
const triggerOfficialEcdCatchup = triggerOfficialCatchup;

function resetForTests() {
  inFlight.clear();
  lastStartedAt.clear();
}

module.exports = {
  syncOfficialResultsData,
  triggerOfficialCatchup,
  triggerOfficialEcdCatchup,
  _test: {
    normalizeDates,
    syncHasFailures,
    collectFailedDates,
    resetForTests,
    inFlight,
    lastStartedAt,
  },
};
