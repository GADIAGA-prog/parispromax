function runnerNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function excludedRunnerNumbers(race) {
  return new Set(
    (Array.isArray(race?.nonPartants) ? race.nonPartants : [])
      .map(runnerNumber)
      .filter(Boolean)
  );
}

// A "partant" is a unique, valid runner that has not been scratched. List
// endpoints may already expose an active count, while detail endpoints return
// every declared horse plus the non-partants list. Prefer the detailed field
// whenever it exists so hydration cannot turn seven active runners back into
// eight declared runners.
export function countActiveRunners(race = {}) {
  const horses = Array.isArray(race?.horses) ? race.horses : [];
  const excluded = excludedRunnerNumbers(race);

  if (horses.length) {
    const seen = new Set();
    for (const horse of horses) {
      const number = runnerNumber(horse?.number);
      if (!number || seen.has(number) || excluded.has(number) || horse?.nonPartant === true) continue;
      seen.add(number);
    }
    return seen.size;
  }

  const declared = Number(race?.runners);
  if (!Number.isFinite(declared) || declared <= 0) return 0;
  return Math.max(0, Math.trunc(declared) - excluded.size);
}

export function hasVerifiedEcdRules(race) {
  return race?.ecdProfile?.verified === true || race?.ecd?.verified === true;
}

export default { countActiveRunners, hasVerifiedEcdRules };
