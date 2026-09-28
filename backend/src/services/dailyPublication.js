'use strict';

const { groupPicks, preRacePredictionPicks } = require('./predictionSelection');
const { ecdPredictionFormat } = require('../../../shared/ecdRules');
const { getNationalGame } = require('../../../shared/nationalGameRules');
const { formatRaceReference } = require('../../../shared/raceReference');
const { gmtTimeLabel, parisStartIso } = require('./raceTime');

function parse(value, fallback) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function positiveNumbers(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) return [];
    seen.add(number);
    return [number];
  });
}

function activeRunnerCount(race) {
  const full = parse(race?.raw, {});
  const nonPartants = new Set(positiveNumbers(parse(race?.nonPartants, [])));
  return positiveNumbers((full.horses || []).map((horse) => horse?.number))
    .filter((number) => !nonPartants.has(number)).length;
}

function compactPick(pick) {
  return {
    number: Number(pick.number),
    name: String(pick.name || `N° ${pick.number}`),
    rank: Number(pick.rank) || null,
  };
}

function raceSummary(race) {
  const full = parse(race?.raw, {});
  const arrival = positiveNumbers(parse(race?.result?.winners, []));
  return {
    id: race.externalId,
    reference: formatRaceReference({ ...full, id: race.externalId }),
    track: race.track,
    name: race.name,
    date: race.date,
    time: gmtTimeLabel(race.date, full.time),
    startsAt: parisStartIso(race.date, full.time),
    distance: race.distance || null,
    discipline: full.type || race.discipline || null,
    runners: activeRunnerCount(race),
    result: arrival.length ? { available: true, arrival } : { available: false, arrival: [] },
  };
}

function publishedPicks(race, resolved, podium) {
  // Once an arrival exists, retain the last prediction that was actually
  // available before the scheduled start. A later model recalculation must
  // never rewrite the publication that users saw before the race.
  const start = Date.parse(raceSummary(race).startsAt || '');
  const closed = Boolean(race?.result) || (Number.isFinite(start) && Date.now() >= start);
  const snapshot = parse(race?.result?.predictionSnapshot, {});
  const frozen = snapshot.ranking || preRacePredictionPicks(race);
  const ranking = closed ? frozen : resolved?.picks || [];
  return groupPicks(ranking, race, podium).selected.map(compactPick);
}

async function buildDailyPublication({ country, date, nationalPick, ecdPicks, racesById, resolvePrediction }) {
  const ecdById = new Map((ecdPicks || []).map((pick) => [pick.externalId, pick]));
  const races = [...racesById.values()].sort((a, b) => (raceSummary(a).startsAt || '').localeCompare(raceSummary(b).startsAt || '') || a.externalId.localeCompare(b.externalId));
  const rows = new Array(races.length);
  let cursor = 0;
  // Bound upstream concurrency; one resolution per race even for hybrid games.
  await Promise.all(Array.from({ length: Math.min(4, races.length) }, async () => {
    while (cursor < races.length) {
      const index = cursor++;
      const race = races[index];
      const summary = raceSummary(race);
      const isNational = nationalPick?.externalId === race.externalId;
      const ecdPick = ecdById.get(race.externalId);
      const game = isNational ? getNationalGame(country, date, { betType: nationalPick.betType }) : null;
      const format = ecdPick ? ecdPredictionFormat(summary.runners) : { label: 'Podium', podium: 3, selectionSize: 5 };
      const podium = Number(game?.podium) || format.podium;
      const started = Number.isFinite(Date.parse(summary.startsAt)) && Date.now() >= Date.parse(summary.startsAt);
      const resolved = race.result || started ? null : await resolvePrediction(race);
      const selection = publishedPicks(race, resolved, podium);
      const arrival = summary.result.arrival;
      summary.result.complete = arrival.length >= podium;
      rows[index] = {
        label: game?.label || (isNational ? nationalPick.betType : format.label),
        contexts: [isNational ? 'Nationale' : null, ecdPick ? 'ECD' : null].filter(Boolean),
        podium, selectionSize: podium + 2,
        journalUrl: nationalPick?.externalId === race.externalId ? nationalPick.journalUrl : ecdPick?.journalUrl || null,
        race: summary, selection,
        predictionStatus: selection.length ? (started || race.result ? 'archived' : 'available') : (started || race.result ? 'not-archived' : 'pending'),
        predictionSource: resolved?.source || null,
      };
    }
  }));
  const national = rows.find((entry) => entry.race.id === nationalPick?.externalId) || null;
  const ecd = rows.filter((entry) => ecdById.has(entry.race.id)).map((entry) => {
    const race = racesById.get(entry.race.id);
    const format = ecdPredictionFormat(entry.race.runners);
    return { ...entry, label: format.label, podium: format.podium, selectionSize: format.selectionSize,
      selection: entry.selection.slice(0, format.selectionSize) };
  });
  return { country, date, updatedAt: new Date().toISOString(), national, ecd, rows,
    resultsAvailable: rows.filter((entry) => entry.race.result.available).length };
}

module.exports = { buildDailyPublication, activeRunnerCount, raceSummary, publishedPicks };
