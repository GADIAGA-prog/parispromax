'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse');
const prisma = require('../db');
const { formatRaceReference } = require('../../../shared/raceReference');
const { buildPredictionSnapshot } = require('./predictionSelection');

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
  const dateMatch = normalized.match(/(\d{2})\s*[-_]\s*(\d{2})\s*[-_]\s*(\d{4})/);
  const meetingMatch = normalized.match(/(?:REUNION|\bR)\s*[-_:]?\s*(\d+)/);
  if (!dateMatch || !meetingMatch) return null;
  return {
    date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
    meeting: Number(meetingMatch[1]),
  };
}

function parseDocumentLinks(html, pageUrl, date, kind) {
  const $ = cheerio.load(String(html || ''));
  const documents = [];
  $('tr').each((_index, row) => {
    const title = $(row).text().replace(/\s+/g, ' ').trim();
    const href = $(row).find('a[href]').attr('href');
    if (!href) return;
    const identity = documentIdentity(`${title} ${href}`);
    if (!identity || identity.date !== date) return;
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

async function discoverOfficialDocuments(countryValue, date, { force = false } = {}) {
  const source = officialSource(countryValue);
  if (!source) return null;
  const cacheKey = `${source.country}:${date}`;
  const cached = discoveryCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.savedAt < DISCOVERY_TTL_MS) return cached.value;

  const [programResponse, resultsResponse] = await Promise.all([
    HTTP.get(source.programUrl),
    source.resultsUrl
      ? HTTP.get(source.resultsUrl).catch(() => null)
      : Promise.resolve(null),
  ]);
  const value = {
    source,
    programs: parseDocumentLinks(programResponse.data, source.programUrl, date, 'program'),
    reports: resultsResponse
      ? parseDocumentLinks(resultsResponse.data, source.resultsUrl, date, 'report')
      : [],
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

function parseArrivalLine(line) {
  const match = String(line || '').match(
    /^(\d+)(?:ere|ère|ieme|ième)\s+(\d+)\s*-\s*(\d+)\s*-\s*(?:(\d+)\s+)?\3\s+\d+(?:\s+\d{3})*\s+\d+/i
  );
  if (!match) return null;
  return {
    course: Number(match[1]),
    arrival: [Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : null]
      .filter(Number.isFinite),
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
  const arrival = (arrivalValue?.length ? arrivalValue : block?.arrival || [])
    .map(Number)
    .filter(Number.isFinite);
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
    `^JUM ORDRE\\s+${pair(first, second)}\\s+${amount}\\s+${count}\\s+TRIO\\s+ARRIV[EÉ]E\\s+${amount}\\s+${count}$`,
    'i'
  ));
  if (order) {
    push('Jumelé ordre', `${first} - ${second}`, order[1], order[2]);
    push('Trio', arrival.slice(0, 3).join(' - '), order[3], order[4]);
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
  const latest = race.predictions?.[0];
  if (!latest) return { predicted: false, snapshot: null };
  let picks = [];
  try { picks = JSON.parse(latest.topPicks || '[]'); }
  catch { picks = []; }
  const top = picks[0];
  return {
    predicted: top ? winners.slice(0, 3).includes(Number(top.number)) : false,
    snapshot: JSON.stringify(buildPredictionSnapshot(picks, race, Math.min(winners.length, 5))),
  };
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
      predictions: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  let updated = 0;
  for (const report of documents.reports) {
    const meetingRaces = races.filter((race) => raceParts(race)?.meeting === report.meeting);
    const reportsAlreadyStored = meetingRaces.length > 0 && meetingRaces.every((race) => {
      try { return JSON.parse(race.result?.payouts || '[]').length > 0; }
      catch { return false; }
    });
    if (!force && reportsAlreadyStored) continue;
    const response = await HTTP.get(report.url, { responseType: 'arraybuffer' });
    const blocks = parseLonabReportText(await pdfText(response.data));
    const byCourse = new Map(blocks.map((block) => [block.course, block]));
    for (const race of meetingRaces) {
      const parts = raceParts(race);
      const block = byCourse.get(parts.course);
      if (!block?.arrival?.length) continue;
      let existingArrival = [];
      try { existingArrival = JSON.parse(race.result?.winners || '[]'); }
      catch { existingArrival = []; }
      const winners = block.arrival.length >= 2 ? block.arrival : existingArrival;
      const payouts = payoutRowsFromBlock(block, winners);
      if (payouts.length < 4) continue;
      if (race.result) {
        await db.result.update({
          where: { id: race.result.id },
          data: { winners: JSON.stringify(winners), payouts: JSON.stringify(payouts) },
        });
      } else {
        const prediction = predictionSnapshot(race, winners);
        await db.result.create({
          data: {
            raceId: race.id,
            winners: JSON.stringify(winners),
            payouts: JSON.stringify(payouts),
            predictionSnapshot: prediction.snapshot,
            predicted: prediction.predicted,
          },
        });
      }
      updated += 1;
    }
  }
  return { country, date, reports: documents.reports.length, updated };
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
  discoverOfficialDocuments,
  raceParts,
  selectOfficialRaces,
  syncOfficialEcdProgram,
  parseArrivalLine,
  parseLonabReportText,
  payoutRowsFromBlock,
  syncOfficialEcdPayouts,
  syncOfficialEcdData,
};
