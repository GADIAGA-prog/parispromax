'use strict';

// UTC slots: start at midnight, retry early publications each hour, then odds.
function refreshSlot(now) {
  const date = new Date(now);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const slots = [0, 60, 120, 180, 240, 300, 360, 660, 930];
  return `${date.toISOString().slice(0, 10)}:${slots.filter((slot) => slot <= minutes).pop()}`;
}

function createDailyRefresh({ refresh, now = Date.now, logger = console }) {
  let running = null;
  let completedSlot = null;
  let lastAttempt = null;
  let attemptedDate = null;
  let timer = null;

  function trigger({ force = false } = {}) {
    const timestamp = now();
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const slot = refreshSlot(timestamp);
    if (running) return { started: false, reason: 'already-running', task: running };
    if (!force && completedSlot === slot) return { started: false, reason: 'up-to-date' };
    if (!force && attemptedDate === date && lastAttempt !== null && timestamp - lastAttempt < 15 * 60000) {
      return { started: false, reason: 'cooldown' };
    }
    lastAttempt = timestamp;
    attemptedDate = date;
    running = Promise.resolve().then(() => refresh(date)).then((result) => {
      if (result?.programmeReady) completedSlot = slot;
      return result;
    }).catch((error) => {
      logger.error('[daily-refresh]', error.message);
      return { programmeReady: false };
    }).finally(() => { running = null; });
    return { started: true, task: running };
  }

  function start() {
    if (timer) return;
    // Recover immediately after restart; align subsequent ticks to UTC minutes.
    const tick = () => {
      trigger();
      timer = setTimeout(tick, 60000 - (now() % 60000));
      timer.unref?.();
    };
    tick();
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  return { trigger, start, stop };
}

module.exports = { createDailyRefresh, refreshSlot };
