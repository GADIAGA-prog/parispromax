function raceReferenceParts(race = {}) {
  const reference = String(race.number || race.id || '');
  const match = reference.match(/R(\d+)C(\d+)/i);
  return match
    ? { meeting: Number(match[1]), course: Number(match[2]) }
    : { meeting: Number.POSITIVE_INFINITY, course: Number.POSITIVE_INFINITY };
}

function trackKey(track = {}) {
  return String(track.name || track.id || '').trim().toLowerCase();
}

function sortedRaces(races = []) {
  return [...races].sort((left, right) => {
    const a = raceReferenceParts(left);
    const b = raceReferenceParts(right);
    return a.meeting - b.meeting || a.course - b.course;
  });
}

function trackMeeting(track = {}) {
  return (track.races || []).reduce(
    (minimum, race) => Math.min(minimum, raceReferenceParts(race).meeting),
    Number.POSITIVE_INFINITY
  );
}

// The generic programme contains every PMU race while the country ECD payload
// contains only the meetings officially playable for that market. Merge the
// ECD metadata onto matching races without dropping the rest of the day.
export function mergeRacePrograms(
  programTracks = [],
  ecdTracks = [],
  { programDate = null, ecdDate = null } = {}
) {
  const datesMatch = !programDate || !ecdDate || String(programDate) === String(ecdDate);
  const safeEcdTracks = datesMatch ? ecdTracks : [];
  const officialById = new Map();
  const officialTracks = new Map();

  for (const track of Array.isArray(safeEcdTracks) ? safeEcdTracks : []) {
    officialTracks.set(trackKey(track), track);
    for (const race of track.races || []) {
      if (race?.id != null) officialById.set(String(race.id), race);
    }
  }

  const seenRaceIds = new Set();
  const merged = (Array.isArray(programTracks) ? programTracks : []).map((track) => {
    const officialTrack = officialTracks.get(trackKey(track));
    const races = (track.races || []).map((race) => {
      const id = String(race?.id ?? '');
      if (id) seenRaceIds.add(id);
      const official = officialById.get(id);
      return official ? { ...race, ...official } : race;
    });

    // Keep an official race if two concurrent refreshes briefly observed
    // slightly different snapshots of the programme.
    for (const race of officialTrack?.races || []) {
      const id = String(race?.id ?? '');
      if (!id || seenRaceIds.has(id)) continue;
      seenRaceIds.add(id);
      races.push(race);
    }

    return {
      ...officialTrack,
      ...track,
      races: sortedRaces(races),
    };
  });

  for (const track of Array.isArray(safeEcdTracks) ? safeEcdTracks : []) {
    const races = (track.races || []).filter((race) => {
      const id = String(race?.id ?? '');
      if (!id || seenRaceIds.has(id)) return false;
      seenRaceIds.add(id);
      return true;
    });
    if (races.length) merged.push({ ...track, races: sortedRaces(races) });
  }

  return merged.sort(
    (left, right) => trackMeeting(left) - trackMeeting(right)
      || String(left.name || '').localeCompare(String(right.name || ''), 'fr')
  );
}

export default { mergeRacePrograms };
