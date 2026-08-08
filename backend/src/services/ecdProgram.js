'use strict';

const { availableVariants } = require('../../../shared/ecdRules');
const { formatRaceReference } = require('../../../shared/raceReference');
const { parisStartIso, gmtTimeLabel } = require('./raceTime');

function parse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function activeRunnerCount(race, full) {
  const nonPartants = parse(race?.nonPartants, []);
  const excluded = new Set(
    (Array.isArray(nonPartants) ? nonPartants : []).map(Number).filter(Number.isFinite)
  );
  const seen = new Set();
  return (full?.horses || []).reduce((count, horse) => {
    const number = Number(horse?.number);
    if (!Number.isInteger(number) || number <= 0 || excluded.has(number) || seen.has(number)) {
      return count;
    }
    seen.add(number);
    return count + 1;
  }, 0);
}

function raceSummary(race, profile) {
  const full = parse(race.raw, {});
  const runners = activeRunnerCount(race, full);
  const variants = availableVariants(profile, runners);
  return {
    id: race.externalId,
    number: formatRaceReference({ ...full, id: race.externalId }),
    name: race.name,
    distance: race.distance,
    time: gmtTimeLabel(race.date, full.time),
    date: race.date,
    startsAt: parisStartIso(race.date, full.time),
    result: race.result ? { winners: parse(race.result.winners, []) } : null,
    prize: full.prize ?? null,
    bets: full.bets || [],
    isQuinte: Boolean(full.isQuinte),
    type: full.type || race.discipline || null,
    autostart: Boolean(full.autostart),
    runners,
    ecd: {
      variants,
      unitStake: profile?.unitStake ?? null,
      currency: profile?.currency || 'FCFA',
    },
  };
}

function groupSelectedRaces(races, profile) {
  const byTrack = new Map();
  for (const race of races) {
    if (!byTrack.has(race.track)) {
      byTrack.set(race.track, {
        id: race.track.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: race.track,
        condition: race.condition,
        discipline: race.discipline,
        races: [],
      });
    }
    byTrack.get(race.track).races.push(raceSummary(race, profile));
  }
  return [...byTrack.values()];
}

function automaticSelection(races, profile, nationalRaceId) {
  const eligible = (races || []).filter((race) => {
    if (!race || race.externalId === nationalRaceId) return false;
    const full = parse(race.raw, {});
    return (full.horses || []).length >= 4;
  });

  const meetings = new Map();
  for (const race of eligible) {
    if (!meetings.has(race.track)) meetings.set(race.track, []);
    meetings.get(race.track).push(race);
  }

  const rankedMeetings = [...meetings.entries()]
    .map(([track, items]) => ({
      track,
      items: items.slice().sort((a, b) => {
        const aFull = parse(a.raw, {});
        const bFull = parse(b.raw, {});
        return String(aFull.time || '').localeCompare(String(bFull.time || ''));
      }),
      runnerScore: items.reduce((sum, item) => sum + (parse(item.raw, {}).horses || []).length, 0),
    }))
    .sort((a, b) => b.runnerScore - a.runnerScore || a.track.localeCompare(b.track));

  const meetingLimit = Math.max(1, Number(profile?.maxMeetings) || 2);
  const raceLimit = Math.max(1, Number(profile?.maxRacesPerMeeting) || 5);
  return rankedMeetings
    .slice(0, meetingLimit)
    .flatMap((meeting) => meeting.items.slice(0, raceLimit));
}

module.exports = {
  activeRunnerCount,
  raceSummary,
  groupSelectedRaces,
  automaticSelection,
};
