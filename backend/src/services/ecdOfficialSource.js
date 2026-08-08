'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse');
const prisma = require('../db');
const { formatRaceReference } = require('../../../shared/raceReference');
const { ecdPodiumSize } = require('../../../shared/ecdRules');
const {
  payoutRowsForCountry,
  validateOfficialPayouts,
} = require('../../../shared/ecdTicketOutcome');
const {
  buildPredictionSnapshot,
  preRacePredictionPicks,
} = require('./predictionSelection');
const {
  arrivalsCompatible,
  mergeCompatibleArrival,
  serializableTransaction,
} = require('./officialResultState');

const HTTP = axios.create({
  timeout: 25000,
  headers: {
    'User-Agent': 'ParisPromax/1.0 (+https://www.parispromax.com)',
    Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  },
});

const DEFAULT_SOURCES = Object.freeze({
  bf: Object.freeze({
    operator: 'LONAB',
    programUrl: 'https://www.lonab.bf/programme-ecd',
    resultsUrl: 'https://www.lonab.bf/resultats-gains-ecd',
    payoutFormat: 'lonab-pdf',
  }),
});

const discoveryCache = new Map();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DISCOVERY_MAX_PAGES = Math.max(
  4,
  Math.min(16, Number.parseInt(process.env.ECD_RESULTS_MAX_PAGES || '10', 10) || 10)
);
const documentPageCache = new Map();

function officialSource(countryValue) {
  const country = String(countryValue || '').trim().toLowerCase();
  if (!country) return null;
  const code = country.toUpperCase();
  const defaults = DEFAULT_SOURCES[country] || {};
  const programUrl = process.env[`ECD_PROGRAM_URL_${code}`] || defaults.programUrl;
  if (!programUrl) return null;
  return {
    country,
    operator: process.env[`ECD_OPERATOR_${code}`] || defaults.operator || code,
    programUrl,
    resultsUrl: process.env[`ECD_RESULTS_URL_${code}`] || defaults.resultsUrl || null,
    payoutFormat: defaults.payoutFormat || null,
  };
}

function documentIdentity(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const numericDate = normalized.match(/(\d{1,2})\s*[-_\/.]\s*(\d{1,2})\s*[-_\/.]\s*(\d{4})/);
  const frenchDate = normalized.match(
    /(\d{1,2})\s+(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE)\s+(\d{4})/
  );
  const meetingMatch = normalized.match(/(?:REUNION|\bR)\s*[-_:]?\s*(\d+)/);
  if ((!numericDate && !frenchDate) || !meetingMatch) return null;
  const months = [
    'JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
    'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE',
  ];
  const day = Number(numericDate?.[1] || frenchDate[1]);
  const month = Number(numericDate?.[2] || months.indexOf(frenchDate[2]) + 1);
  const year = Number(numericDate?.[3] || frenchDate[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    meeting: Number(meetingMatch[1]),
  };
}

function parseDocumentLinks(html, pageUrl, date, kind) {
  const $ = cheerio.load(String(html || ''));
  const documents = [];
  $('a[href]').each((_index, link) => {
    const container = $(link).closest('tr, article, li, .views-row');
    const title = (container.length ? container.text() : $(link).parent().text())
      .replace(/\s+/g, ' ')
      .trim();
    const href = $(link).attr('href');
    if (!href) return;
    const identity = documentIdentity(`${title} ${href}`);
    if (!identity || (date && identity.date !== date)) return;
    let url;
    try { url = new URL(href, pageUrl).toString(); }
    catch { return; }
    documents.push({ ...identity, kind, title, url });
  });
  return documents
    .filter((document, index, all) => all.findIndex(
      (candidate) => candidate.meeting === document.meeting && candidate.url === document.url
    ) === index)
    .sort((a, b) => a.meeting - b.meeting);
}

function paginatedDocumentUrl(baseUrl, page) {
  const url = new URL(baseUrl);
  if (page > 0) url.searchParams.set('page', String(page));
  else url.searchParams.delete('page');
  return url.toString();
}

async function cachedDocumentPage(url, { force = false, http = HTTP } = {}) {
  const cached = documentPageCache.get(url);
  if (!force && cached && Date.now() - cached.savedAt < DISCOVERY_TTL_MS) return cached.html;
  const response = await http.get(url);
  const html = String(response.data || '');
  documentPageCache.set(url, { savedAt: Date.now(), html });
  return html;
}

async function discoverPaginatedDocuments(baseUrl, date, kind, {
  force = false,
  http = HTTP,
  maxPages = DEFAULT_DISCOVERY_MAX_PAGES,
} = {}) {
  if (!baseUrl) return [];
  const limit = Math.max(1, Math.min(16, Number(maxPages) || DEFAULT_DISCOVERY_MAX_PAGES));
  const seenPages = new Set();
  for (let page = 0; page < limit; page += 1) {
    const url = paginatedDocumentUrl(baseUrl, page);
    const documents = parseDocumentLinks(
      await cachedDocumentPage(url, { force, http }),
      url,
      null,
      kind
    );
    const signature = documents.map((document) => document.url).sort().join('|');
    if (page > 0 && (!documents.length || seenPages.has(signature))) break;
    if (signature) seenPages.add(signature);
    const matches = documents.filter((document) => document.date === date);
    if (matches.length) return matches;
  }
  return [];
}

function meetingOneCandidate(document) {
  if (!document || Number(document.meeting) === 1 || !document.url) return null;
  let url;
  try {
    const parsed = new URL(document.url);
    const nextPath = parsed.pathname.replace(/([_-]R)\d+(?=\.pdf$)/i, (_match, prefix) => `${prefix}1`);
    if (nextPath === parsed.pathname) return null;
    parsed.pathname = nextPath;
    url = parsed.toString();
  } catch {
    return null;
  }
  return {
    ...document,
    meeting: 1,
    title: String(document.title || '').replace(/\bR\s*\d+\b/i, 'R1'),
    url,
    inferredFromOfficialUrl: true,
  };
}

async function includePublishedMeetingOne(documents, http = HTTP) {
  if (!documents?.length || documents.some((document) => document.meeting === 1)) return documents;
  for (const document of documents) {
    const candidate = meetingOneCandidate(document);
    if (!candidate) continue;
    try {
      const response = await http.head(candidate.url);
      if (response.status >= 200 && response.status < 300) {
        return [candidate, ...documents].sort((a, b) => a.meeting - b.meeting);
      }
    } catch {
      // La LONAB n'a pas publié de document R1 compagnon à cette adresse.
    }
  }
  return documents;
}

async function discoverOfficialDocuments(countryValue, date, {
  force = false,
  http = HTTP,
  maxPages = DEFAULT_DISCOVERY_MAX_PAGES,
} = {}) {
  const source = officialSource(countryValue);
  if (!source) return null;
  const cacheKey = `${source.country}:${date}`;
  const cached = discoveryCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.savedAt < DISCOVERY_TTL_MS) return cached.value;

  const [programDocuments, reportDocuments] = await Promise.all([
    discoverPaginatedDocuments(source.programUrl, date, 'program', { force, http, maxPages }),
    source.resultsUrl
      ? discoverPaginatedDocuments(source.resultsUrl, date, 'report', { force, http, maxPages })
        .catch(() => [])
      : Promise.resolve([]),
  ]);
  let programs = programDocuments;
  if (source.operator === 'LONAB') programs = await includePublishedMeetingOne(programs, http);
  let reports = reportDocuments;
  // The operator page has occasionally exposed only R3 even though the
  // companion R1 PDF was already online. Apply the same verified HEAD lookup
  // to reports so a missing index link cannot leave valid gains pending.
  if (source.operator === 'LONAB') reports = await includePublishedMeetingOne(reports, http);
  const value = {
    source,
    programs,
    reports,
  };
  discoveryCache.set(cacheKey, { savedAt: Date.now(), value });
  return value;
}

function raceParts(race = {}) {
  let full = {};
  try { full = JSON.parse(race.raw || '{}'); }
  catch { full = {}; }
  const reference = formatRaceReference({ ...full, id: race.externalId });
  const match = String(reference).match(/R(\d+)C(\d+)/i);
  return match
    ? { meeting: Number(match[1]), course: Number(match[2]), reference }
    : null;
}

function selectOfficialRaces(races, meetings) {
  const allowed = new Set((meetings || []).map(Number));
  return (races || [])
    .map((race) => ({ race, parts: raceParts(race) }))
    .filter(({ parts }) => parts && allowed.has(parts.meeting))
    .sort((a, b) => a.parts.meeting - b.parts.meeting || a.parts.course - b.parts.course)
    .map(({ race }) => race);
}

async function syncOfficialEcdProgram(country, date, { db = prisma, force = false } = {}) {
  const documents = await discoverOfficialDocuments(country, date, { force });
  if (!documents) return { available: false, country, date, meetings: [] };
  const meetings = documents.programs.map((document) => document.meeting);
  if (!meetings.length) {
    return {
      available: true,
      operator: documents.source.operator,
      country,
      date,
      meetings: [],
      status: 'program-not-published',
    };
  }

  const races = await db.race.findMany({ where: { date }, orderBy: { createdAt: 'asc' } });
  const selected = selectOfficialRaces(races, meetings);
  if (!selected.length) {
    return {
      available: true,
      operator: documents.source.operator,
      country,
      date,
      meetings,
      status: 'races-not-ingested',
      journals: documents.programs,
    };
  }

  const programByMeeting = new Map(
    documents.programs.map((document) => [document.meeting, document])
  );
  const desired = selected.map((race, priority) => {
    const parts = raceParts(race);
    return {
      externalId: race.externalId,
      priority,
      journalUrl: programByMeeting.get(parts.meeting)?.url || null,
    };
  });
  const existing = await db.ecdPick.findMany({
    where: { date, country },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  const signature = (rows) => rows
    .map((row) => `${row.externalId}|${row.priority}|${row.journalUrl || ''}`)
    .join('\n');
  const changed = signature(existing) !== signature(desired);
  if (changed) {
    await db.$transaction([
      db.ecdPick.deleteMany({ where: { date, country } }),
      ...desired.map((row) => db.ecdPick.create({ data: { date, country, ...row } })),
    ]);
  }

  return {
    available: true,
    operator: documents.source.operator,
    country,
    date,
    meetings,
    status: changed ? 'synchronized' : 'current',
    count: desired.length,
    journals: documents.programs,
    reports: documents.reports,
  };
}

function normalizedReportLines(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function uniqueRunnerNumbers(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) return [];
    seen.add(number);
    return [number];
  });
}

function raceRunnerCount(race) {
  let full = {};
  let nonPartants = [];
  try { full = JSON.parse(race?.raw || '{}'); }
  catch { full = {}; }
  try { nonPartants = JSON.parse(race?.nonPartants || '[]'); }
  catch { nonPartants = []; }
  const excluded = new Set(uniqueRunnerNumbers(nonPartants));
  return uniqueRunnerNumbers((full.horses || []).map((horse) => horse?.number))
    .filter((number) => !excluded.has(number))
    .length;
}

function mergeOfficialArrival(official, existing) {
  return mergeCompatibleArrival(existing, official).arrival;
}

function taggedPayoutRows(rows, {
  country,
  operator,
  reportDate = null,
  sourceUrl = null,
  podiumSize = null,
  arrival = [],
} = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    country: String(country || '').trim().toLowerCase(),
    context: 'ecd',
    operator: String(operator || '').trim() || null,
    reportStatus: 'complete',
    reportDate,
    sourceUrl,
    podium: Number(podiumSize) || null,
    arrivals: arrival?.length ? [uniqueRunnerNumbers(arrival)] : [],
  }));
}

function mergeCountryPayoutRows(existingRows, replacementRows, countryValue) {
  const country = String(countryValue || '').trim().toLowerCase();
  const preserved = (Array.isArray(existingRows) ? existingRows : []).filter((row) => {
    // Untagged historical rows are LONAB/Burkina Faso rows.
    const rowCountry = String(row?.country || 'bf').trim().toLowerCase();
    const rowContext = String(row?.context || 'ecd').trim().toLowerCase();
    return rowCountry !== country || rowContext !== 'ecd';
  });
  return [...preserved, ...(Array.isArray(replacementRows) ? replacementRows : [])];
}

function officialReportValidation(race, country) {
  let payouts = [];
  let winners = [];
  try { payouts = JSON.parse(race?.result?.payouts || '[]'); }
  catch { payouts = []; }
  try { winners = JSON.parse(race?.result?.winners || '[]'); }
  catch { winners = []; }
  const countryRows = payoutRowsForCountry(payouts, country, 'bf', 'ecd');
  const storedPodium = Number(countryRows.find((row) => Number(row?.podium))?.podium);
  const podiumSize = [2, 3].includes(storedPodium)
    ? storedPodium
    : ecdPodiumSize(raceRunnerCount(race));
  return validateOfficialPayouts({ payouts: countryRows, arrival: winners, podiumSize });
}

function parseArrivalLine(line) {
  const match = String(line || '').match(
    /^(\d+)(?:ere|ère|ieme|ième)\s+(\d+)\s*-\s*(\d+)\s*-\s*(?:(\d+)\s+)?\3\s+\d+(?:\s+\d{3})*\s+\d+/i
  );
  if (!match) return null;
  return {
    course: Number(match[1]),
    arrival: uniqueRunnerNumbers([
      Number(match[2]),
      Number(match[3]),
      match[4] ? Number(match[4]) : null,
    ]),
  };
}

function parseLonabReportText(text) {
  const lines = normalizedReportLines(text);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^GAGNANT\s+\d+/i.test(lines[index])) continue;
    const blockLines = lines.slice(index, index + 7);
    const arrivalInfo = blockLines.map(parseArrivalLine).find(Boolean);
    if (!arrivalInfo) continue;
    blocks.push({
      course: arrivalInfo.course,
      arrival: arrivalInfo.arrival,
      lines: blockLines,
    });
  }
  return blocks.filter((block, index, all) => all.findIndex(
    (candidate) => candidate.course === block.course
  ) === index);
}

function regexNumber(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function money(value) {
  return Number(String(value || '').replace(/\s+/g, '')) || 0;
}

function payoutRowsFromBlock(block, arrivalValue) {
  const arrival = uniqueRunnerNumbers(arrivalValue?.length ? arrivalValue : block?.arrival || []);
  const [first, second, third] = arrival;
  if (!block || !first || !second) return [];
  const lines = block.lines || [];
  const amount = '(\\d+(?:\\s+\\d{3})*)';
  const count = '(\\d+)';
  const pair = (a, b) => `${regexNumber(a)}\\s*-\\s*${regexNumber(b)}`;
  const rows = [];
  const push = (bet, numbers, amountValue, countValue) => rows.push({
    bet,
    numbers: String(numbers),
    amount: money(amountValue),
    winnerCount: Number(countValue) || 0,
  });

  const win = lines[0]?.match(new RegExp(
    `^GAGNANT\\s+${first}\\s+${amount}\\s+${count}\\s+JUM GAGNANT\\s+${pair(first, second)}\\s+${amount}\\s+${count}$`,
    'i'
  ));
  if (win) {
    push('Gagnant', first, win[1], win[2]);
    push('Jumelé gagnant', `${first} - ${second}`, win[3], win[4]);
  }

  const firstPlace = lines[1]?.match(new RegExp(
    `^${first}\\s+${amount}\\s+${count}\\s+${pair(first, second)}\\s+${amount}\\s+${count}$`,
    'i'
  ));
  if (firstPlace) {
    push('Placé', first, firstPlace[1], firstPlace[2]);
    push('Jumelé placé', `${first} - ${second}`, firstPlace[3], firstPlace[4]);
  }

  const ordinalLine = lines.find((line) => parseArrivalLine(line));
  if (ordinalLine) {
    const rightPair = third ? pair(first, third) : `${regexNumber(first)}\\s*-`;
    const secondPlace = ordinalLine.match(new RegExp(
      `\\s${second}\\s+${amount}\\s+${count}\\s+${rightPair}\\s+${amount}\\s+${count}$`,
      'i'
    ));
    if (secondPlace) {
      push('Placé', second, secondPlace[1], secondPlace[2]);
      if (third) push('Jumelé placé', `${first} - ${third}`, secondPlace[3], secondPlace[4]);
    }
  }

  if (third) {
    const thirdLine = lines.find((line) => new RegExp(
      `^${third}\\s+${amount}\\s+${count}\\s+${pair(second, third)}\\s+${amount}\\s+${count}$`,
      'i'
    ).test(line));
    const thirdPlace = thirdLine?.match(new RegExp(
      `^${third}\\s+${amount}\\s+${count}\\s+${pair(second, third)}\\s+${amount}\\s+${count}$`,
      'i'
    ));
    if (thirdPlace) {
      push('Placé', third, thirdPlace[1], thirdPlace[2]);
      push('Jumelé placé', `${second} - ${third}`, thirdPlace[3], thirdPlace[4]);
    }
  }

  const orderLine = lines.find((line) => /^JUM ORDRE/i.test(line));
  const order = orderLine?.match(new RegExp(
    `^JUM ORDRE\\s+${pair(first, second)}\\s+${amount}\\s+${count}(?:\\s+TRIO\\s+ARRIV[EÉ]E\\s+${amount}\\s+${count})?$`,
    'i'
  ));
  if (order) {
    push('Jumelé ordre', `${first} - ${second}`, order[1], order[2]);
    if (third && order[3]) push('Trio', arrival.slice(0, 3).join(' - '), order[3], order[4]);
  }
  return rows;
}

async function pdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

function predictionSnapshot(race, winners) {
  let frozen = null;
  try { frozen = JSON.parse(race.result?.predictionSnapshot || 'null'); }
  catch { frozen = null; }
  let picks = [];
  if (Array.isArray(frozen?.ranking) && frozen.ranking.length) picks = frozen.ranking;
  else if (Array.isArray(frozen?.topPicks) && frozen.topPicks.length) picks = frozen.topPicks;
  else picks = preRacePredictionPicks(race);
  if (!picks.length) return { predicted: false, snapshot: null };
  const places = ecdPodiumSize(raceRunnerCount(race));
  const top = picks[0];
  return {
    predicted: top ? winners.slice(0, places).includes(Number(top.number)) : false,
    snapshot: JSON.stringify(buildPredictionSnapshot(picks, race, places)),
  };
}

async function stampOfficialFinishPositions(db, raceId, winnersValue, { preserveLaterPlaces = true } = {}) {
  const winners = uniqueRunnerNumbers(winnersValue);
  const where = preserveLaterPlaces && winners.length
    ? { raceId, finishPos: { lte: winners.length } }
    : { raceId };
  await db.runner.updateMany({ where, data: { finishPos: null } });
  for (let index = 0; index < winners.length; index += 1) {
    await db.runner.updateMany({
      where: { raceId, number: winners[index] },
      data: { finishPos: index + 1 },
    });
  }
  return winners.length;
}

async function syncOfficialEcdPayouts(country, date, { db = prisma, force = false } = {}) {
  const documents = await discoverOfficialDocuments(country, date, { force });
  if (!documents?.reports?.length || documents.source.payoutFormat !== 'lonab-pdf') {
    return { country, date, reports: 0, updated: 0 };
  }
  const races = await db.race.findMany({
    where: { date },
    include: {
      result: true,
      predictions: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  let updated = 0;
  const failures = [];
  for (const report of documents.reports) {
    try {
      const meetingRaces = races.filter((race) => raceParts(race)?.meeting === report.meeting);
      const reportsAlreadyStored = meetingRaces.length > 0
        && meetingRaces.every((race) => officialReportValidation(race, country).status === 'complete');
      if (!force && reportsAlreadyStored) continue;
      const response = await HTTP.get(report.url, { responseType: 'arraybuffer' });
      const blocks = parseLonabReportText(await pdfText(response.data));
      const byCourse = new Map(blocks.map((block) => [block.course, block]));
      for (const race of meetingRaces) {
        try {
          const parts = raceParts(race);
          const block = byCourse.get(parts.course);
          if (!block?.arrival?.length) continue;
          let existingArrival = [];
          try { existingArrival = JSON.parse(race.result?.winners || '[]'); }
          catch { existingArrival = []; }
          const podiumSize = ecdPodiumSize(raceRunnerCount(race));
          const officialArrival = uniqueRunnerNumbers(block.arrival).slice(0, podiumSize);
          if (officialArrival.length !== podiumSize) {
            failures.push({
              meeting: report.meeting,
              raceId: race.externalId,
              error: `arrivee officielle incomplete (${officialArrival.length}/${podiumSize})`,
            });
            continue;
          }
          const payouts = payoutRowsFromBlock(block, officialArrival);
          const validation = validateOfficialPayouts({
            payouts,
            arrival: officialArrival,
            podiumSize,
          });
          if (validation.status !== 'complete') {
            failures.push({
              meeting: report.meeting,
              raceId: race.externalId,
              error: `rapport officiel ${validation.status} (${payouts.length}/${validation.expectedRows})`,
            });
            continue;
          }
          const taggedRows = taggedPayoutRows(payouts, {
            country,
            operator: documents.source.operator,
            reportDate: date,
            sourceUrl: report.url,
            podiumSize,
            arrival: officialArrival,
          });
          await serializableTransaction(db, async (tx) => {
            const current = await tx.result.findUnique({ where: { raceId: race.id } });
            let currentArrival = existingArrival;
            let currentPayouts = [];
            try { currentArrival = JSON.parse(current?.winners || '[]'); }
            catch { currentArrival = existingArrival; }
            try { currentPayouts = JSON.parse(current?.payouts || '[]'); }
            catch { currentPayouts = []; }
            if (!arrivalsCompatible(currentArrival, officialArrival)) {
              throw new Error('arrivee ECD incompatible avec l\'arrivee deja enregistree');
            }
            const arrivalState = mergeCompatibleArrival(currentArrival, officialArrival);
            const winners = arrivalState.arrival;
            const mergedPayouts = mergeCountryPayoutRows(currentPayouts, taggedRows, country);
            const prediction = predictionSnapshot({ ...race, result: current }, winners);
            const updateWithoutArrival = {
              payouts: JSON.stringify(mergedPayouts),
              predictionSnapshot: prediction.snapshot,
              predicted: prediction.predicted,
            };
            const arrivalNeedsWrite = arrivalState.changed;
            if (!current) {
              await tx.result.upsert({
                where: { raceId: race.id },
                // If another writer created the row after our read, never
                // replace its potentially longer arrival from this ECD prefix.
                update: updateWithoutArrival,
                create: {
                  raceId: race.id,
                  winners: JSON.stringify(winners),
                  ...updateWithoutArrival,
                },
              });
            } else if (arrivalNeedsWrite) {
              const changed = await tx.result.updateMany({
                where: { id: current.id, winners: current.winners },
                data: { ...updateWithoutArrival, winners: JSON.stringify(winners) },
              });
              if (!changed.count) {
                // A concurrent result completion won the compare-and-set. Keep
                // that arrival and update only the report metadata.
                await tx.result.update({
                  where: { id: current.id },
                  data: updateWithoutArrival,
                });
              }
            } else {
              await tx.result.update({
                where: { id: current.id },
                data: updateWithoutArrival,
              });
            }
            await stampOfficialFinishPositions(tx, race.id, officialArrival);
          });
          updated += 1;
        } catch (error) {
          failures.push({ meeting: report.meeting, raceId: race.externalId, error: error.message });
        }
      }
    } catch (error) {
      failures.push({ meeting: report.meeting, error: error.message });
    }
  }
  return {
    country,
    date,
    reports: documents.reports.length,
    updated,
    failed: failures.length,
    failures: failures.slice(0, 10),
  };
}

async function syncOfficialEcdData({ dates = [], countries = ['bf'], force = false } = {}) {
  const results = [];
  for (const date of dates) {
    for (const country of countries) {
      if (!officialSource(country)) continue;
      try {
        const program = await syncOfficialEcdProgram(country, date, { force });
        const payouts = await syncOfficialEcdPayouts(country, date, { force });
        results.push({ country, date, program, payouts });
      } catch (error) {
        results.push({ country, date, error: error.message });
      }
    }
  }
  return results;
}

module.exports = {
  officialSource,
  documentIdentity,
  parseDocumentLinks,
  paginatedDocumentUrl,
  discoverPaginatedDocuments,
  meetingOneCandidate,
  discoverOfficialDocuments,
  raceParts,
  selectOfficialRaces,
  syncOfficialEcdProgram,
  uniqueRunnerNumbers,
  raceRunnerCount,
  mergeOfficialArrival,
  taggedPayoutRows,
  mergeCountryPayoutRows,
  officialReportValidation,
  parseArrivalLine,
  parseLonabReportText,
  payoutRowsFromBlock,
  predictionSnapshot,
  stampOfficialFinishPositions,
  syncOfficialEcdPayouts,
  syncOfficialEcdData,
  _test: {
    discoveryCache,
    documentPageCache,
    resetCachesForTests() {
      discoveryCache.clear();
      documentPageCache.clear();
    },
  },
};
