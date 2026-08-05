const express = require('express');
const prisma = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { getAccess } = require('../services/subscription');
const {
  groupPicks: buildGroups,
  preRacePredictionPicks,
} = require('../services/predictionSelection');
const { getNationalGame } = require('../../../shared/nationalGameRules');
const { buildNationalBetProposal } = require('../../../shared/nationalBetProposal');
const { getEcdProfile, ecdPredictionFormat } = require('../../../shared/ecdRules');
const { formatRaceReference } = require('../../../shared/raceReference');
const { evaluateGrandCarnet } = require('../../../shared/grandCarnetOutcome');
const {
  evaluateEcdTickets,
  payoutRowsForCountry,
  playablePayoutRows,
  validateOfficialPayouts,
} = require('../../../shared/ecdTicketOutcome');
const {
  groupSelectedRaces,
} = require('../services/ecdProgram');
const {
  syncOfficialEcdProgram,
  raceParts,
  raceRunnerCount,
} = require('../services/ecdOfficialSource');
const { parisStartIso, gmtTimeLabel } = require('../services/raceTime');
const { resolveCanonicalPrediction } = require('../services/predictionResolver');
const { triggerOfficialCatchup } = require('../services/officialCatchup');
const { storedNationalReport } = require('../services/nationalOfficialSource');

const router = express.Router();

function parse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function grandCarnetOfficialReport(report, { operator = null } = {}) {
  // No stored rows means that the operator has not published (or we have not
  // fetched) a report yet. It is pending, not a partially parsed publication.
  if (!report || report.status === 'pending') return null;
  const firstRow = report.payouts?.[0] || null;
  return {
    status: report.status,
    payouts: report.payouts,
    arrivals: report.arrivals,
    operator: firstRow?.operator || operator,
    sourceUrl: firstRow?.sourceUrl || null,
  };
}

// GET /races — list of today's (latest) races, grouped by track. Public.
router.get('/', async (req, res) => {
  let date = req.query.date;
  if (!date) {
    const latest = await prisma.race.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
    date = latest?.date;
  }
  const where = date ? { date } : {};
  const races = await prisma.race.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { result: true },
  });

  // Group by track, expose only public fields (no AI picks here).
  const byTrack = {};
  for (const r of races) {
    if (!byTrack[r.track]) {
      byTrack[r.track] = {
        id: r.track.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: r.track,
        condition: r.condition,
        discipline: r.discipline,
        races: [],
      };
    }
    const full = parse(r.raw, {});
    byTrack[r.track].races.push({
      id: r.externalId,
      number: formatRaceReference({ ...full, id: r.externalId }),
      name: r.name,
      distance: r.distance,
      time: gmtTimeLabel(r.date, full.time),
      date: r.date,
      startsAt: parisStartIso(r.date, full.time),
      result: r.result ? { winners: parse(r.result.winners, []) } : null,
      prize: full.prize ?? null,
      bets: full.bets || [],
      isQuinte: Boolean(full.isQuinte),
      type: full.type || r.discipline || null,
      autostart: Boolean(full.autostart),
      runners: (full.horses || []).length,
    });
  }
  res.json({ meta: { date: date || null }, racetracks: Object.values(byTrack) });
});

// GET /races/full — complete dataset (tracks -> races -> horses) in the app's
// schema, so the mobile app can render + compute AI locally. Public.
router.get('/full', async (req, res) => {
  let date = req.query.date;
  // No date specified -> use the most recent race date available (so a fresh
  // live scrape supersedes older/demo data instead of mixing with it).
  if (!date) {
    const latest = await prisma.race.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
    date = latest?.date;
  }
  const where = date ? { date } : {};
  const races = await prisma.race.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 300, include: { result: true },
  });

  const byTrack = {};
  for (const r of races) {
    const full = parse(r.raw, {});
    if (!byTrack[r.track]) {
      byTrack[r.track] = {
        id: r.track.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: r.track,
        condition: r.condition,
        discipline: r.discipline,
        prizePool: full.prizePool || null,
        races: [],
      };
    }
    byTrack[r.track].races.push({
      id: r.externalId,
      number: formatRaceReference({ ...full, id: r.externalId }),
      name: r.name,
      distance: r.distance,
      time: gmtTimeLabel(r.date, full.time),
      date: r.date,
      startsAt: parisStartIso(r.date, full.time),
      result: r.result ? { winners: parse(r.result.winners, []) } : null,
      prize: full.prize ?? null,
      bets: full.bets || [],
      isQuinte: Boolean(full.isQuinte),
      type: full.type || r.discipline || null,
      autostart: Boolean(full.autostart),
      condition: r.condition,
      runners: (full.horses || []).length,
      horses: full.horses || [],
    });
  }

  res.json({
    meta: { source: 'backend', date: date || null },
    racetracks: Object.values(byTrack),
  });
});

// GET /races/national?country=bf&date=YYYY-MM-DD — LA course support des paris
// PMU du pays (Quarté LONAB au Burkina, LONACI en CI…), désignée chaque jour
// depuis le back-office, + le journal hippique national à télécharger. Public.
router.get('/national', optionalAuth, async (req, res) => {
  const country = String(req.query.country || '').trim().toLowerCase();
  if (!country) return res.status(400).json({ error: 'country requis' });
  let date = req.query.date;
  if (!date) {
    const latest = await prisma.race.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
    date = latest?.date || new Date().toISOString().slice(0, 10);
  }

  const pick = await prisma.nationalPick.findUnique({
    where: { date_country: { date, country } },
  });
  const game = getNationalGame(country, date, { betType: pick?.betType });
  if (!pick) return res.json({ country, date, game, pick: null });

  const race = await prisma.race.findUnique({
    where: { externalId: pick.externalId },
    include: { predictions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const full = race ? parse(race.raw, {}) : {};
  const betType = game?.label || pick.betType || 'Course du jour';
  const nonPartants = race?.nonPartants ? parse(race.nonPartants, []) : [];
  let predictionCandidates = [];
  let predictionSource = 'market-ranking';
  const horseCandidates = (full.horses || [])
    .slice()
    .sort((a, b) => {
      const oddsA = Number(a.odds);
      const oddsB = Number(b.odds);
      return (Number.isFinite(oddsA) && oddsA > 0 ? oddsA : 999)
        - (Number.isFinite(oddsB) && oddsB > 0 ? oddsB : 999);
    });
  const access = req.userId ? await getAccess(req.userId) : { hasAccess: false };
  if (access.hasAccess && race) {
    const resolved = await resolveCanonicalPrediction(race);
    predictionCandidates = resolved.picks;
    if (predictionCandidates.length) predictionSource = resolved.source;
  }
  const proposal = access.hasAccess && game
    ? buildNationalBetProposal(game, [...predictionCandidates, ...horseCandidates], {
        nonPartants,
        source: predictionSource,
      })
    : null;
  const nationalGame = game ? { ...game, proposal } : null;
  res.json({
    country,
    date,
    game: nationalGame,
    pick: {
      betType,
      journalUrl: pick.journalUrl || null,
      race: race
        ? {
            id: race.externalId,
            track: race.track,
            name: race.name,
            number: formatRaceReference({ ...full, id: race.externalId }),
            time: gmtTimeLabel(race.date, full.time),
            startsAt: parisStartIso(race.date, full.time),
            prize: full.prize ?? null,
            betType,
            bets: full.bets || [],
            isQuinte: Boolean(full.isQuinte),
            type: full.type || race.discipline || null,
            autostart: Boolean(full.autostart),
            distance: race.distance,
            discipline: race.discipline,
            runners: (full.horses || []).length,
          }
        : null,
    },
  });
});

// GET /races/ecd?country=bf&date=YYYY-MM-DD
// Programme complet des autres courses proposées pour le pays. Une sélection
// ECD validée dans le back-office reste prioritaire, puis toutes les autres
// courses éligibles du jour sont ajoutées afin que le programme soit complet.
router.get('/ecd', async (req, res) => {
  const country = String(req.query.country || '').trim().toLowerCase();
  if (!country) return res.status(400).json({ error: 'country requis' });
  const profile = getEcdProfile(country);
  if (!profile) return res.status(400).json({ error: 'country invalide' });

  let date = req.query.date;
  if (!date) {
    const latest = await prisma.race.findFirst({
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    date = latest?.date || new Date().toISOString().slice(0, 10);
  }

  let officialProgram = null;
  try {
    officialProgram = await syncOfficialEcdProgram(country, date);
  } catch (error) {
    console.warn(`[ecd] source officielle ${country}/${date}:`, error.message);
  }

  const [configuredPicks, races] = await Promise.all([
    prisma.ecdPick.findMany({
      where: { date, country },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.race.findMany({
      where: { date },
      orderBy: { createdAt: 'asc' },
      include: { result: true },
      take: 300,
    }),
  ]);

  const raceById = new Map(races.map((race) => [race.externalId, race]));
  const configuredRaces = configuredPicks
    .map((pick) => raceById.get(pick.externalId))
    .filter(Boolean);
  const selectedRaces = configuredRaces;
  const journalUrl = configuredPicks.find((pick) => pick.journalUrl)?.journalUrl || null;
  const journals = configuredPicks
    .filter((pick) => pick.journalUrl)
    .map((pick) => {
      const parts = raceParts(raceById.get(pick.externalId));
      return { meeting: parts?.meeting || null, url: pick.journalUrl };
    })
    .filter((journal, index, all) => all.findIndex((item) => item.url === journal.url) === index)
    .sort((a, b) => Number(a.meeting || 999) - Number(b.meeting || 999));
  const selectionMode = officialProgram?.meetings?.length
    ? 'official-country-program'
    : configuredRaces.length
      ? 'country-validated'
      : 'country-program-pending';

  res.json({
    country,
    date,
    profile,
    selectionMode,
    operator: officialProgram?.operator || null,
    meetings: officialProgram?.meetings || journals.map((journal) => journal.meeting).filter(Boolean),
    journalUrl,
    journals,
    racetracks: groupSelectedRaces(selectedRaces, profile),
  });
});

// GET /races/history — finished races with our AI prediction + the actual
// arrival + whether our #1 pick placed (top 3). Public. Drives the app's
// History screen so users compare pronostic vs résultat.
router.get('/history', optionalAuth, async (req, res) => {
  const access = req.userId ? await getAccess(req.userId) : { hasAccess: false };
  const country = String(req.query.country || 'bf').trim().toLowerCase();
  const ecdProfile = getEcdProfile(country);
  if (!ecdProfile) return res.status(400).json({ error: 'country invalide' });
  // Select the country's products before loading Result rows. A global Result
  // limit could otherwise hide a quiet country's entire history behind races
  // ingested for other markets.
  const [ecdPicks, nationalPicks] = await Promise.all([
    prisma.ecdPick.findMany({
      where: { country },
      orderBy: { date: 'desc' },
      take: 300,
      select: { date: true, externalId: true },
    }),
    prisma.nationalPick.findMany({
      where: { country },
      orderBy: { date: 'desc' },
      take: 300,
      select: { date: true, externalId: true, betType: true },
    }),
  ]);
  const relevantExternalIds = [...new Set(
    [...ecdPicks, ...nationalPicks].map((pick) => pick.externalId).filter(Boolean)
  )];
  const resultQuery = {
    where: { race: { externalId: { in: relevantExternalIds } } },
    orderBy: [{ race: { date: 'desc' } }, { createdAt: 'desc' }],
    take: 600,
    include: {
      race: { include: { predictions: { orderBy: { createdAt: 'desc' }, take: 50 } } },
    },
  };
  const results = relevantExternalIds.length ? await prisma.result.findMany(resultQuery) : [];
  const nationalById = new Map(
    nationalPicks.map((pick) => [`${pick.date}:${pick.externalId}`, pick.betType])
  );
  const ecdIds = new Set(
    ecdPicks.map((pick) => `${pick.date}:${pick.externalId}`)
  );

  // Retry only dates whose expected official product report is actually
  // absent or incomplete. Include picks without a Result so older pending
  // dates do not disappear behind an arbitrary seven-date window.
  const resultById = new Map(results.map((result) => [result.race.externalId, result]));
  const pendingDates = [];
  if (ecdProfile.verified) {
    for (const pick of ecdPicks) {
      const result = resultById.get(pick.externalId);
      if (!result) {
        pendingDates.push(pick.date);
        continue;
      }
      const rows = payoutRowsForCountry(parse(result.payouts, []), country, 'bf', 'ecd');
      const storedPodium = Number(rows.find((row) => Number(row?.podium))?.podium);
      const podium = [2, 3].includes(storedPodium)
        ? storedPodium
        : ecdPredictionFormat(raceRunnerCount(result.race)).podium;
      if (!podium || validateOfficialPayouts({ payouts: rows, arrival: parse(result.winners, []), podiumSize: podium }).status !== 'complete') {
        pendingDates.push(pick.date);
      }
    }
  }
  if (country === 'bf') {
    for (const pick of nationalPicks) {
      const result = resultById.get(pick.externalId);
      const game = getNationalGame(country, pick.date, { betType: pick.betType });
      const report = storedNationalReport(
        parse(result?.payouts, []),
        country,
        pick.date,
        Number(game?.podium) || null
      );
      if (!result || report.status !== 'complete') pendingDates.push(pick.date);
    }
  }
  triggerOfficialCatchup({
    country,
    dates: [...new Set(pendingDates.filter(Boolean))].sort().reverse().slice(0, 30),
  });

  const history = results.map((r) => {
    const winners = parse(r.winners, []).map(Number).filter(Number.isFinite);
    const full = parse(r.race.raw, {});
    const snapshot = parse(r.predictionSnapshot, null);
    const identity = `${r.race.date}:${r.race.externalId}`;
    const isNational = nationalById.has(identity);
    const isEcd = ecdIds.has(identity);
    const category = isNational ? 'national' : isEcd ? 'ecd' : null;
    if (!category) return null;
    const game = isNational
      ? getNationalGame(country, r.race.date, { betType: nationalById.get(identity) })
      : null;
    // For legacy rows without a snapshot, only a ranking published before the
    // scheduled start is eligible; a later recalculation must never rewrite history.
    const historicalPicks = preRacePredictionPicks(r.race);
    const ranking = Array.isArray(snapshot?.ranking) && snapshot.ranking.length
      ? snapshot.ranking
      : historicalPicks.length
        ? historicalPicks
        : snapshot?.topPicks || [];
    const storedPayouts = parse(r.payouts, []);
    const storedEcdPayouts = isEcd
      ? payoutRowsForCountry(storedPayouts, country, 'bf', 'ecd')
      : [];
    const storedEcdPodium = Number(storedEcdPayouts.find((row) => Number(row?.podium))?.podium);
    const nationalPlaces = game?.verified && Number.isInteger(Number(game?.podium))
      ? Number(game.podium)
      : null;
    const ecdPlaces = isEcd && ecdProfile.verified
      ? ([2, 3].includes(storedEcdPodium)
          ? storedEcdPodium
          : ecdPredictionFormat(raceRunnerCount(r.race)).podium)
      : null;
    const places = isNational ? nationalPlaces : ecdPlaces;
    const nationalGroups = isNational && nationalPlaces
      ? buildGroups(ranking, r.race, nationalPlaces)
      : null;
    const ecdGroups = isEcd && ecdPlaces ? buildGroups(ranking, r.race, ecdPlaces) : null;
    const groups = nationalGroups || ecdGroups || null;
    const topPicks = groups?.selected || ranking.slice(0, 5);
    const ecdTopPicks = ecdGroups?.selected || [];
    const aiHit = topPicks[0] && places && winners.length >= places
      ? winners.slice(0, places).includes(Number(topPicks[0].number))
      : null;
    const ecdAiHit = ecdTopPicks[0] && ecdPlaces && winners.length >= ecdPlaces
      ? winners.slice(0, ecdPlaces).includes(Number(ecdTopPicks[0].number))
      : null;
    const countryPayouts = isEcd && ecdProfile.verified && ecdPlaces
      ? storedEcdPayouts
      : [];
    let reportValidation;
    if (!isEcd) reportValidation = { status: 'not-ecd' };
    else if (!ecdProfile.verified) reportValidation = { status: 'rules-unverified' };
    else if (!ecdPlaces) reportValidation = { status: 'format-unavailable' };
    else {
      reportValidation = validateOfficialPayouts({
        payouts: countryPayouts,
        arrival: winners,
        podiumSize: ecdPlaces,
      });
    }
    // A partial parse must never be exposed as a final report. Once the full
    // PDF shape is validated, only variants actually playable for this field
    // size are shown and used in the illustrative balance.
    const payouts = reportValidation.status === 'complete'
      ? playablePayoutRows(countryPayouts, ecdPlaces)
      : [];
    const nationalReportData = isNational && nationalPlaces
      ? storedNationalReport(storedPayouts, country, r.race.date, nationalPlaces)
      : null;
    const nationalReportRow = nationalReportData?.payouts?.[0] || null;
    const nationalOutcomeReport = grandCarnetOfficialReport(nationalReportData, {
      operator: country === 'bf' ? 'LONAB' : null,
    });
    const grandCarnetOutcome = country === 'bf' && game?.verified
      ? evaluateGrandCarnet(game, topPicks, winners, {
          officialReport: nationalOutcomeReport,
        })
      : null;
    const ecdTicketOutcome = isEcd && ecdProfile.verified && ecdPlaces
      ? evaluateEcdTickets({
          payouts,
          predictions: ecdTopPicks,
          podiumSize: ecdPlaces,
          officialArrival: winners,
          reportStatus: reportValidation.status,
          unitStake: ecdProfile.unitStake,
          currency: ecdProfile.currency,
        })
      : null;
    const nationalArrivalComplete = isNational && nationalPlaces
      ? winners.length >= nationalPlaces
      : null;
    const ecdArrivalComplete = isEcd && ecdPlaces ? winners.length >= ecdPlaces : null;
    const arrivalComplete = category === 'national' ? nationalArrivalComplete : ecdArrivalComplete;
    return {
      id: r.id,
      raceId: r.race.externalId,
      track: r.race.track,
      race: r.race.name,
      number: formatRaceReference({ ...full, id: r.race.externalId }),
      date: r.race.date,
      payouts: access.hasAccess ? payouts : [],
      winners, // finishing order [num, num, ...]
      category,
      isEcd,
      arrivalComplete,
      nationalArrivalComplete,
      ecdArrivalComplete,
      officialResultStatus: arrivalComplete === true
        ? 'complete'
        : arrivalComplete === false
          ? 'partial'
          : 'unknown',
      ...(access.hasAccess ? {
        ranking,
        topPicks,
        groups,
        aiHit,
        nationalTopPicks: nationalGroups?.selected || [],
        nationalGroups,
        nationalAiHit: nationalGroups ? aiHit : null,
        ecdTopPicks,
        ecdGroups,
        ecdAiHit: ecdGroups ? ecdAiHit : null,
        ecdReport: isEcd ? {
          status: reportValidation.status,
          country,
          operator: countryPayouts.find((row) => row?.operator)?.operator || (country === 'bf' ? 'LONAB' : null),
        } : null,
        nationalReport: isNational ? {
          status: nationalReportData?.status || 'pending',
          country,
          operator: nationalReportRow?.operator || (country === 'bf' ? 'LONAB' : null),
          sourceUrl: nationalReportRow?.sourceUrl || null,
        } : null,
        grandCarnetOutcome,
        ecdTicketOutcome,
      } : {}),
    };
  }).filter(Boolean);

  res.json({ country, history });
});

// GET /races/:externalId/non-partants — live scratchings for a race, consumed
// by the Python ML daemon before it re-scores the field. Public (read-only).
// Returns { race_id, non_partants: [numbers] }.
router.get('/:externalId/non-partants', async (req, res) => {
  const race = await prisma.race.findUnique({
    where: { externalId: req.params.externalId },
    select: { nonPartants: true },
  });
  if (!race) return res.status(404).json({ error: 'Course introuvable' });
  const np = race.nonPartants ? parse(race.nonPartants, []) : [];
  res.json({ race_id: req.params.externalId, non_partants: Array.isArray(np) ? np : [] });
});

// GET /races/:externalId — race detail with runners (public, no AI scores).
// Exposes the full public data we hold on each runner so the app can display
// rich cards (trainer, career earnings, unshod status, odds trend…).
router.get('/:externalId', async (req, res) => {
  const race = await prisma.race.findUnique({
    where: { externalId: req.params.externalId },
    include: { result: true },
  });
  if (!race) return res.status(404).json({ error: 'Course introuvable' });
  const full = parse(race.raw, {});
  const nonPartants = race.nonPartants ? parse(race.nonPartants, []) : [];
  res.json({
    id: race.externalId,
    track: race.track,
    name: race.name,
    date: race.date,
    time: gmtTimeLabel(race.date, full.time),
    startsAt: parisStartIso(race.date, full.time),
    discipline: race.discipline,
    type: full.type || race.discipline || null, // Trot Attelé / Plat / Obstacle…
    autostart: Boolean(full.autostart),
    condition: race.condition,
    distance: race.distance,
    prize: full.prize ?? null, // allocation de la course (euros)
    prizePool: full.prizePool || null,
    nonPartants: Array.isArray(nonPartants) ? nonPartants : [],
    result: race.result ? { winners: parse(race.result.winners, []) } : null,
    horses: (full.horses || []).map((h) => ({
      number: h.number,
      name: h.name,
      jockey: h.jockey,
      trainer: h.trainer || null,
      odds: h.odds ?? null,
      coteOpen: h.coteOpen ?? null,
      form: h.form,
      gains: Number.isFinite(Number(h.gains)) ? Number(h.gains) : null,
      chrono: h.chrono ?? null,
      deferrage: h.deferrage || null,
      nonPartant: Array.isArray(nonPartants) && nonPartants.includes(Number(h.number)),
    })),
  });
});

// Canonical prediction contract: number/name/aiScore/rank + probabilities.
// GET /races/:externalId/prediction — AI top picks. GATED: requires an active
// subscription or trial. Serves the trained LTR model when the IA microservice
// is enabled (IA_URL), and falls back to the stored JS-engine predictions.
router.get('/:externalId/prediction', requireAuth, async (req, res) => {
  const access = await getAccess(req.userId);
  if (!access.hasAccess) {
    return res.status(402).json({ error: 'Abonnement requis', locked: true });
  }
  const race = await prisma.race.findUnique({
    where: { externalId: req.params.externalId },
    include: { predictions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!race) return res.status(404).json({ error: 'Pronostic indisponible' });

  // The same canonical provider also feeds the national proposal: trained LTR
  // when available, then stored ranking, then a persisted raw-data fallback.
  const resolved = await resolveCanonicalPrediction(race);
  if (!resolved.picks.length) {
    return res.status(404).json({ error: 'Pronostic indisponible' });
  }
  const source = resolved.source === 'stored' ? 'js' : resolved.source;
  res.json({
    raceId: race.externalId,
    source,
    topPicks: resolved.picks,
    groups: buildGroups(resolved.picks, race),
  });
});

router._test = { grandCarnetOfficialReport };

module.exports = router;
