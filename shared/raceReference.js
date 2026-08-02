'use strict';

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function fullReference(value) {
  const match = String(value || '').toUpperCase().match(/R\s*(\d+)\D*C\s*(\d+)/);
  if (!match) return null;
  return { meeting: Number(match[1]), course: Number(match[2]) };
}

function taggedNumber(value, tag) {
  const match = String(value || '').toUpperCase().match(new RegExp(`${tag}\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

/**
 * Returns the official PMU-style race reference (for example R1C3).
 * Explicit data wins, then encoded identifiers, then list positions supplied
 * by the caller for legacy/offline programmes.
 */
function formatRaceReference(race = {}, fallback = {}) {
  const exact = [race.reference, race.number, race.id, race.externalId]
    .map(fullReference)
    .find(Boolean);
  if (exact) return `R${exact.meeting}C${exact.course}`;

  const meeting = positiveInteger(race.meetingNumber)
    || positiveInteger(race.reunionNumber)
    || positiveInteger(fallback.meetingNumber);

  let course = positiveInteger(race.courseNumber)
    || taggedNumber(race.number, 'C')
    || positiveInteger(fallback.courseNumber);

  // Older bundled data used R1, R2... for the course ordinal.
  if (!course && meeting) course = taggedNumber(race.number, 'R');

  if (meeting && course) return `R${meeting}C${course}`;
  return String(race.number || '').trim();
}

module.exports = { formatRaceReference };
