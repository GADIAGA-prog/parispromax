'use strict';

function parisStartIso(date, time) {
  const match = String(time || '').match(/(\d{1,2})[:h](\d{2})/i);
  if (!date || !match) return null;
  const [year, month, day] = String(date).split('-').map(Number);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(guess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute)
  );
  return new Date(guess - (displayedAsUtc - guess)).toISOString();
}

function gmtTimeLabel(date, time) {
  const startsAt = parisStartIso(date, time);
  if (!startsAt) return '';
  const value = new Date(startsAt);
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hours}h${minutes} GMT+0`;
}

module.exports = {
  parisStartIso,
  gmtTimeLabel,
};
