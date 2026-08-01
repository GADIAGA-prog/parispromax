'use strict';

const { availableVariants } = require('../../../shared/ecdRules');
const { parisStartIso, gmtTimeLabel } = require('./raceTime');

function parse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function raceSummary(race, profile) {
  const full = parse(race.raw, {});
  const runners = (full.horses || []).length;
  const variants = availableVariants(profile, runners);
  return {
    id: race.externalId,
    number: full.number || '',
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

  return rankedMeetings.flatMap((meeting) =>
    meeting.items
  );
}

module.exports = {
  raceSummary,
  groupSelectedRaces,
  automaticSelection,
};
