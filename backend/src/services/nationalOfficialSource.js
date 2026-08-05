'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse');
const prisma = require('../db');
const { getNationalGame } = require('../../../shared/nationalGameRules');
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
    resultsUrl: 'https://www.lonab.bf/resultats-gains-pmub',
    payoutFormat: 'lonab-pdf',
  }),
});

const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DISCOVERY_MAX_PAGES = Math.max(
  4,
  Math.min(16, Number.parseInt(process.env.NATIONAL_RESULTS_MAX_PAGES || '8', 10) || 8)
);
const pageCache = new Map();

function normalizeAscii(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[’']/g, '')
    .toUpperCase();
}

function officialNationalSource(countryValue) {
  const country = String(countryValue || '').trim().toLowerCase();
  const defaults = DEFAULT_SOURCES[country];
  if (!defaults) return null;
  const code = country.toUpperCase();
  const resultsUrl = process.env[`NATIONAL_RESULTS_URL_${code}`] || defaults.resultsUrl;
  if (!resultsUrl) return null;
  return {
    country,
    operator: process.env[`NATIONAL_OPERATOR_${code}`] || defaults.operator,
    resultsUrl,
    payoutFormat: defaults.payoutFormat,
  };
}

const MONTHS = Object.freeze([
  'JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
  'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE',
]);

function nationalDocumentDate(value) {
  const normalized = normalizeAscii(value);
  const numeric = normalized.match(/(\d{1,2})\s*[-_\/.]\s*(\d{1,2})\s*[-_\/.]\s*(\d{4})/);
  const french = normalized.match(
    /(\d{1,2})\s+(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE)\s+(\d{4})/
  );
  if (!numeric && !french) return null;
  const day = Number(numeric?.[1] || french[1]);
  const month = Number(numeric?.[2] || MONTHS.indexOf(french[2]) + 1);
  const year = Number(numeric?.[3] || french[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNationalResultLinks(html, pageUrl) {
  const $ = cheerio.load(String(html || ''));
  const documents = [];
  $('a[href]').each((_index, link) => {
    const href = $(link).attr('href');
    if (!href || !/\.pdf(?:$|[?#])/i.test(href)) return;
    const container = $(link).closest('tr, article, li, .views-row');
    const title = (container.length ? container.text() : $(link).parent().text())
      .replace(/\s+/g, ' ')
      .trim();
    const date = nationalDocumentDate(`${title} ${href}`);
    if (!date) return;
    let url;
    try { url = new URL(href, pageUrl).toString(); }
    catch { return; }
    documents.push({ date, title, url, kind: 'national-report' });
  });
  return documents.filter((document, index, all) => all.findIndex(
    (candidate) => candidate.date === document.date && candidate.url === document.url
  ) === index);
}

function pageUrl(resultsUrl, page) {
  const url = new URL(resultsUrl);
  if (page > 0) url.searchParams.set('page', String(page));
  else url.searchParams.delete('page');
  return url.toString();
}

async function cachedPage(url, { force = false, http = HTTP } = {}) {
  const cached = pageCache.get(url);
  if (!force && cached && Date.now() - cached.savedAt < PAGE_CACHE_TTL_MS) return cached.html;
  const response = await http.get(url);
  const html = String(response.data || '');
  pageCache.set(url, { savedAt: Date.now(), html });
  return html;
}

async function discoverOfficialNationalReport(countryValue, date, {
  force = false,
  http = HTTP,
  maxPages = DEFAULT_DISCOVERY_MAX_PAGES,
} = {}) {
  const source = officialNationalSource(countryValue);
  if (!source) return null;
  for (let page = 0; page < maxPages; page += 1) {
    const url = pageUrl(source.resultsUrl, page);
    const documents = parseNationalResultLinks(
      await cachedPage(url, { force, http }),
      url
    );
    const report = documents.find((document) => document.date === date);
    if (report) return { source, report, page };
    if (!documents.length) break;
  }
  return { source, report: null, page: null };
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

function reportGame(value) {
  const normalized = normalizeAscii(value).replace(/\s+/g, ' ');
  if (/\bTIERCE\b/.test(normalized)) return { label: 'Tiercé', podium: 3 };
  if (/\bQUARTE\b/.test(normalized)) return { label: 'Quarté', podium: 4 };
  if (/\b4\s*\+\s*1\b|\bQUINTE\b/.test(normalized)) return { label: '4+1', podium: 5 };
  return null;
}

function arrivalSequences(lineValue, podium) {
  const normalized = normalizeAscii(lineValue);
  const match = normalized.match(/\bARR(?:IVEE)?\s*:\s*(.+?)(?=\s+NPO\b|\s+NP\s*:|$)/);
  if (!match) return [];
  return match[1]
    .split(/\s+OU\s+/)
    .map((sequence) => uniqueRunnerNumbers(sequence.match(/\d+/g) || []).slice(0, podium))
    .filter((sequence) => sequence.length === podium)
    .filter((sequence, index, all) => all.findIndex(
      (candidate) => candidate.join('-') === sequence.join('-')
    ) === index);
}

function money(value) {
  const amount = Number(String(value ?? '').replace(/\s+/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function canonicalPayoutLabel(value) {
  const label = normalizeAscii(value).replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
  if (label === 'ORDRE') return { kind: 'order', bet: 'Ordre' };
  if (label === 'DESORDRE') return { kind: 'disorder', bet: 'Désordre' };
  if (label === 'BONUS') return { kind: 'bonus', bet: 'Bonus' };
  if (label === 'QUARTE V') return { kind: 'quarte-venant', bet: 'Quarté venant' };
  if (label === 'TIERCE V') return { kind: 'tierce-venant', bet: 'Tiercé venant' };
  if (label === 'COUPLE V') return { kind: 'couple-venant', bet: 'Couplé venant' };
  if (label === 'SIMPLE V') return { kind: 'simple-venant', bet: 'Simple venant' };
  return null;
}

function payoutRowFromLine(line) {
  const match = String(line || '').match(
    /^\s*(ORDRE|D[ÉE]SORDRE|BONUS|QUART[ÉE]\s+V\.?|TIERC[ÉE]\s+V\.?|COUPL[ÉE]\s+V\.?|SIMPLE\s+V\.?)\s*:\s*(.+)$/i
  );
  if (!match) return null;
  const identity = canonicalPayoutLabel(match[1]);
  if (!identity) return null;
  const payload = match[2].trim();
  if (/^[-–—]\s*0$/.test(payload)) {
    return { ...identity, amount: 0, winnerCount: 0 };
  }
  // Both values use French thousands groups but the PDF has no separator
  // besides a space. Capturing the two complete numbers in one anchored match
  // avoids merging `270 000 217` into the fictitious gain 270 000 217.
  const values = payload.match(
    /^(\d+(?:\s+\d{3})*)\s+(\d+(?:\s+\d{3})*)$/
  );
  if (!values) return null;
  const amount = money(values[1]);
  if (amount == null) return null;
  const winnerCount = money(values[2]);
  return { ...identity, amount, winnerCount };
}

function validateNationalReport(report, { expectedDate = null, expectedPodium = null } = {}) {
  const missing = [];
  if (!report?.date || (expectedDate && report.date !== expectedDate)) missing.push('date');
  if (!Number.isInteger(report?.podium) || (expectedPodium && report.podium !== expectedPodium)) {
    missing.push('game');
  }
  if (!Array.isArray(report?.arrivals) || !report.arrivals.some(
    (arrival) => arrival.length === report.podium
  )) missing.push('arrival');
  const kinds = new Set((report?.payouts || []).map((row) => row.kind));
  ['order', 'disorder'].forEach((kind) => { if (!kinds.has(kind)) missing.push(kind); });
  if (report?.podium === 5 && !kinds.has('bonus')) missing.push('bonus');
  return { status: missing.length ? 'partial' : 'complete', missing };
}

function parseNationalReportText(text) {
  const lines = normalizedReportLines(text);
  const joined = lines.join(' ');
  // Read the product from the title, not from the whole PDF: Quarté and 4+1
  // reports can legitimately contain a lower-rank "Tiercé venant" row.
  const header = lines.find((line) => /\b(?:TIERC[ÉE]|QUART[ÉE]|4\s*\+\s*1|QUINT[ÉE])\b.*\bDU\b/i.test(line)) || '';
  const game = reportGame(header);
  const date = nationalDocumentDate(joined);
  const arrivals = game ? arrivalSequences(joined, game.podium) : [];
  const payouts = lines.map(payoutRowFromLine).filter(Boolean).filter((row, index, all) => (
    all.findIndex((candidate) => candidate.kind === row.kind) === index
  ));
  const report = {
    date,
    gameLabel: game?.label || null,
    podium: game?.podium || null,
    arrivals,
    arrival: arrivals[0] || [],
    payouts,
  };
  return { ...report, ...validateNationalReport(report) };
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

function nationalRowsForCountry(payouts, countryValue, dateValue = null) {
  const country = String(countryValue || '').trim().toLowerCase();
  return (Array.isArray(payouts) ? payouts : []).filter((row) => (
    String(row?.country || '').trim().toLowerCase() === country
      && row?.context === 'national'
      && (!dateValue || row?.reportDate === dateValue)
  ));
}

function storedNationalReport(payouts, country, date, expectedPodium) {
  const rows = nationalRowsForCountry(payouts, country, date);
  if (!rows.length) {
    return {
      date,
      podium: expectedPodium || null,
      gameLabel: null,
      arrivals: [],
      arrival: [],
      payouts: [],
      status: 'pending',
      missing: [],
    };
  }
  const arrivals = rows.find((row) => Array.isArray(row?.arrivals))?.arrivals || [];
  const report = {
    date,
    podium: Number(rows[0]?.podium) || expectedPodium || null,
    gameLabel: rows[0]?.gameLabel || null,
    arrivals,
    arrival: arrivals[0] || [],
    payouts: rows,
  };
  return { ...report, ...validateNationalReport(report, { expectedDate: date, expectedPodium }) };
}

function taggedNationalRows(report, { country, operator, sourceUrl } = {}) {
  return (report?.payouts || []).map((row) => ({
    ...row,
    numbers: (report.arrival || []).join(' - '),
    country: String(country || '').trim().toLowerCase(),
    context: 'national',
    operator: String(operator || '').trim() || null,
    reportStatus: 'complete',
    reportDate: report.date,
    gameLabel: report.gameLabel,
    podium: report.podium,
    arrivals: report.arrivals,
    sourceUrl: sourceUrl || null,
  }));
}

function mergeNationalRows(existingRows, replacementRows, countryValue) {
  const country = String(countryValue || '').trim().toLowerCase();
  const preserved = (Array.isArray(existingRows) ? existingRows : []).filter((row) => !(
    String(row?.country || '').trim().toLowerCase() === country && row?.context === 'national'
  ));
  return [...preserved, ...(Array.isArray(replacementRows) ? replacementRows : [])];
}

function selectOfficialArrival(arrivals, existing) {
  const candidates = Array.isArray(arrivals) ? arrivals : [];
  return candidates.find((arrival) => arrivalsCompatible(arrival, existing)) || null;
}

function mergeOfficialArrival(official, existing) {
  return mergeCompatibleArrival(existing, official).arrival;
}

function frozenPrediction(race, winners, podium) {
  let frozen = null;
  try { frozen = JSON.parse(race?.result?.predictionSnapshot || 'null'); }
  catch { frozen = null; }
  const ranking = Array.isArray(frozen?.ranking) && frozen.ranking.length
    ? frozen.ranking
    : preRacePredictionPicks(race);
  if (!ranking.length) {
    return {
      predicted: Boolean(race?.result?.predicted),
      snapshot: race?.result?.predictionSnapshot || null,
    };
  }
  const topNumber = Number(ranking[0]?.number);
  return {
    predicted: Number.isFinite(topNumber) && winners.slice(0, podium).includes(topNumber),
    snapshot: race?.result?.predictionSnapshot
      || JSON.stringify(buildPredictionSnapshot(ranking, race, podium)),
  };
}

async function stampFinishPositions(db, raceId, winnersValue) {
  const winners = uniqueRunnerNumbers(winnersValue);
  await db.runner.updateMany({
    where: { raceId, finishPos: { lte: winners.length } },
    data: { finishPos: null },
  });
  for (let index = 0; index < winners.length; index += 1) {
    await db.runner.updateMany({
      where: { raceId, number: winners[index] },
      data: { finishPos: index + 1 },
    });
  }
}

async function syncOfficialNationalPayouts(countryValue, date, {
  db = prisma,
  force = false,
  http = HTTP,
  extractPdfText = pdfText,
} = {}) {
  const country = String(countryValue || '').trim().toLowerCase();
  const source = officialNationalSource(country);
  if (!source) return { available: false, country, date, status: 'source-unavailable' };
  const pick = await db.nationalPick.findUnique({
    where: { date_country: { date, country } },
  });
  if (!pick) return { available: true, country, date, status: 'national-pick-missing' };
  const game = getNationalGame(country, date, { betType: pick.betType });
  if (!game?.verified || !Number.isInteger(Number(game.podium))) {
    return { available: true, country, date, status: 'rules-unverified' };
  }
  const race = await db.race.findUnique({
    where: { externalId: pick.externalId },
    include: {
      result: true,
      predictions: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  if (!race) return { available: true, country, date, status: 'race-not-ingested' };

  let existingRows = [];
  try { existingRows = JSON.parse(race.result?.payouts || '[]'); }
  catch { existingRows = []; }
  const current = storedNationalReport(existingRows, country, date, Number(game.podium));
  if (!force && current.status === 'complete') {
    return { available: true, country, date, status: 'current', updated: 0 };
  }

  const discovery = await discoverOfficialNationalReport(country, date, { force, http });
  if (!discovery?.report) {
    return { available: true, country, date, status: 'report-not-published', updated: 0 };
  }
  const response = await http.get(discovery.report.url, { responseType: 'arraybuffer' });
  const parsed = parseNationalReportText(await extractPdfText(response.data));
  const validation = validateNationalReport(parsed, {
    expectedDate: date,
    expectedPodium: Number(game.podium),
  });
  if (validation.status !== 'complete') {
    return {
      available: true,
      country,
      date,
      status: 'report-partial',
      updated: 0,
      failed: 1,
      missing: validation.missing,
    };
  }
  const taggedRows = taggedNationalRows(parsed, {
    country,
    operator: source.operator,
    sourceUrl: discovery.report.url,
  });

  try {
    await serializableTransaction(db, async (tx) => {
      const result = await tx.result.findUnique({ where: { raceId: race.id } });
      let existingArrival = [];
      let persistedRows = [];
      try { existingArrival = JSON.parse(result?.winners || '[]'); }
      catch { existingArrival = []; }
      try { persistedRows = JSON.parse(result?.payouts || '[]'); }
      catch { persistedRows = []; }
      const officialArrival = selectOfficialArrival(parsed.arrivals, existingArrival);
      if (!officialArrival) {
        throw new Error('arrivée nationale incompatible avec l’arrivée déjà enregistrée');
      }
      const arrivalState = mergeCompatibleArrival(existingArrival, officialArrival);
      const winners = arrivalState.arrival;
      const prediction = frozenPrediction({ ...race, result }, winners, Number(game.podium));
      const payouts = mergeNationalRows(persistedRows, taggedRows, country);
      const updateWithoutArrival = {
        payouts: JSON.stringify(payouts),
        predictionSnapshot: prediction.snapshot,
        predicted: prediction.predicted,
      };
      const arrivalNeedsWrite = arrivalState.changed;
      if (!result) {
        await tx.result.upsert({
          where: { raceId: race.id },
          update: updateWithoutArrival,
          create: {
            raceId: race.id,
            winners: JSON.stringify(winners),
            ...updateWithoutArrival,
          },
        });
      } else if (arrivalNeedsWrite) {
        const changed = await tx.result.updateMany({
          where: { id: result.id, winners: result.winners },
          data: { ...updateWithoutArrival, winners: JSON.stringify(winners) },
        });
        if (!changed.count) {
          await tx.result.update({
            where: { id: result.id },
            data: updateWithoutArrival,
          });
        }
      } else {
        await tx.result.update({
          where: { id: result.id },
          data: updateWithoutArrival,
        });
      }
      await stampFinishPositions(tx, race.id, officialArrival);
    });
  } catch (error) {
    return {
      available: true,
      country,
      date,
      status: 'sync-failed',
      updated: 0,
      failed: 1,
      error: error.message,
    };
  }

  return {
    available: true,
    country,
    date,
    operator: source.operator,
    status: 'synchronized',
    reportUrl: discovery.report.url,
    updated: 1,
    failed: 0,
  };
}

async function syncOfficialNationalData({ dates = [], countries = ['bf'], force = false } = {}) {
  const results = [];
  for (const date of dates) {
    for (const country of countries) {
      try {
        results.push(await syncOfficialNationalPayouts(country, date, { force }));
      } catch (error) {
        results.push({ country, date, status: 'sync-failed', failed: 1, error: error.message });
      }
    }
  }
  return results;
}

function resetCachesForTests() {
  pageCache.clear();
}

module.exports = {
  officialNationalSource,
  nationalDocumentDate,
  parseNationalResultLinks,
  discoverOfficialNationalReport,
  reportGame,
  arrivalSequences,
  canonicalPayoutLabel,
  payoutRowFromLine,
  validateNationalReport,
  parseNationalReportText,
  nationalRowsForCountry,
  storedNationalReport,
  taggedNationalRows,
  mergeNationalRows,
  arrivalsCompatible,
  selectOfficialArrival,
  syncOfficialNationalPayouts,
  syncOfficialNationalData,
  _test: { pageCache, resetCachesForTests },
};
