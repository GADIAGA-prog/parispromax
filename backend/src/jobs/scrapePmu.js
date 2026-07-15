/* eslint-disable no-console */
// Free structured PMU feed adapter. The endpoint is public but undocumented,
// so every response is validated and Geny remains the fallback in scrape.js.

const axios = require('axios');
const { parseMusique, formScoreFromParsed } = require('../scraper/musique');

const BASE = process.env.PMU_API_BASE || 'https://offline.turfinfo.api.pmu.fr/rest/client/7/programme';
const REQUEST_INTERVAL_MS = Math.max(250, Number(process.env.PMU_REQUEST_INTERVAL_MS) || 750);
const MAX_RETRIES = 3;

const HTTP = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': 'ParisPromax/1.0 (+https://parispromax.app)',
    Accept: 'application/json',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDate(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Date PMU invalide: ${date}`);
  return `${match[3]}${match[2]}${match[1]}`;
}

function retryAfterMs(error, attempt) {
  const value = error.response && error.response.headers && error.response.headers['retry-after'];
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60000);
  return 1500 * Math.pow(2, attempt);
}

async function getJson(path) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data } = await HTTP.get(`${BASE}${path}`);
      return data;
    } catch (error) {
      lastError = error;
      const status = error.response && error.response.status;
      const retryable = status === 429 || status >= 500 || (!status && !/CERT|TLS|SSL|SELF_SIGNED/i.test(String(error.code || '')));
      if (!retryable || attempt === MAX_RETRIES - 1) break;
      await sleep(retryAfterMs(error, attempt));
    }
  }
  const wrapped = new Error(`Source PMU indisponible: ${lastError ? lastError.message : 'réponse inconnue'}`);
  wrapped.code = 'PMU_SOURCE_UNAVAILABLE';
  wrapped.cause = lastError;
  throw wrapped;
}

function personName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return [value.prenom, value.nom].filter(Boolean).join(' ').trim();
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDeferrage(value) {
  const text = String(value || '').toUpperCase();
  if (/4|QUATRE/.test(text)) return 'D4';
  if (/ANTERIEUR|ANTÉRIEUR|DA\b/.test(text)) return 'DA';
  if (/POSTERIEUR|POSTÉRIEUR|DP\b/.test(text)) return 'DP';
  return text && text !== 'AUCUN' && text !== 'FERRE' ? text : null;
}

function raceTime(timestamp) {
  const value = numeric(timestamp);
  if (value == null) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function betLabel(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return [value.typePari, value.libelle, value.libelleCourt, value.codePari]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function normalizeParticipant(raw) {
  const musiqueRaw = String(raw.musique || '');
  const musiqueParsed = parseMusique(musiqueRaw);
  const directOdds = numeric(raw.dernierRapportDirect && raw.dernierRapportDirect.rapport);
  const referenceOdds = numeric(raw.dernierRapportReference && raw.dernierRapportReference.rapport);
  const gains = raw.gainsParticipant || {};

  return {
    number: numeric(raw.numPmu),
    name: String(raw.nom || '').trim(),
    jockey: personName(raw.driver || raw.jockey),
    trainer: personName(raw.entraineur),
    form: musiqueRaw,
    formScore: formScoreFromParsed(musiqueParsed),
    odds: directOdds ?? referenceOdds,
    chrono: 0,
    winRate: musiqueParsed.taux_top3_recent,
    jockeyRating: null,
    gains: numeric(gains.gainsCarriere) || 0,
    coteFloat: directOdds ?? referenceOdds,
    coteOpen: referenceOdds,
    musiqueRaw,
    musiqueParsed,
    deferrage: normalizeDeferrage(raw.deferre),
  };
}

function normalizeRace(date, reunionNumber, raw, participants) {
  const courseNumber = numeric(raw.numOrdre) || numeric(raw.numExterne);
  const horses = participants
    .filter((participant) => String(participant.statut || 'PARTANT').toUpperCase() !== 'NON_PARTANT')
    .map(normalizeParticipant)
    .filter((horse) => horse.number != null && horse.name);
  const specialite = String(raw.specialite || raw.discipline || '').replace(/_/g, ' ');
  const bets = (Array.isArray(raw.paris) ? raw.paris : [])
    .map(betLabel)
    .filter(Boolean);

  return {
    id: `pmu-${date}-R${reunionNumber}-C${courseNumber}`,
    number: `C${courseNumber}`,
    name: String(raw.libelle || raw.libelleCourt || `Course ${courseNumber}`).trim(),
    time: raceTime(raw.heureDepart),
    prize: numeric(raw.montantPrix) || numeric(raw.montantTotalOffert) || null,
    bets,
    isQuinte: bets.some((bet) => /QUINT[EÉ]/i.test(bet)),
    type: specialite || null,
    autostart: /AUTOSTART/i.test(String(raw.typeDepart || '')),
    distance: raw.distance ? `${raw.distance}m` : '',
    discipline: specialite || null,
    condition: 'dry',
    runners: horses.length,
    horses,
  };
}

async function scrapeProgrammePmu(date, { maxReunions = 8, maxCourses = 4 } = {}) {
  const pmuDate = formatDate(date);
  const rawProgramme = await getJson(`/${pmuDate}`);
  const reunions = rawProgramme && rawProgramme.programme && rawProgramme.programme.reunions;
  if (!Array.isArray(reunions)) {
    const error = new Error('Le flux PMU ne contient pas de liste de réunions valide.');
    error.code = 'PMU_SCHEMA_INVALID';
    throw error;
  }

  const racetracks = [];
  for (const reunion of reunions.slice(0, maxReunions)) {
    const reunionNumber = numeric(reunion.numOfficiel) || numeric(reunion.numExterne);
    if (reunionNumber == null) continue;
    const races = [];
    for (const course of (reunion.courses || []).slice(0, maxCourses)) {
      const courseNumber = numeric(course.numOrdre) || numeric(course.numExterne);
      if (courseNumber == null || /ANNULE/i.test(String(course.statut || ''))) continue;
      const participantPayload = await getJson(`/${pmuDate}/R${reunionNumber}/C${courseNumber}/participants`);
      const participants = participantPayload && participantPayload.participants;
      if (Array.isArray(participants)) {
        const race = normalizeRace(date, reunionNumber, course, participants);
        if (race.horses.length) races.push(race);
      }
      await sleep(REQUEST_INTERVAL_MS);
    }
    if (!races.length) continue;
    const hippodrome = reunion.hippodrome || {};
    const name = String(hippodrome.libelleLong || hippodrome.libelleCourt || `Réunion ${reunionNumber}`).trim();
    racetracks.push({
      id: `pmu-r${reunionNumber}`,
      name,
      discipline: 'PMU',
      condition: races[0].condition,
      prizePool: null,
      country: String((reunion.pays && (reunion.pays.code || reunion.pays)) || 'FR').toUpperCase(),
      races,
    });
  }

  if (!racetracks.length) {
    const error = new Error('Aucune course exploitable dans le flux PMU.');
    error.code = 'PMU_EMPTY';
    throw error;
  }
  return {
    meta: { source: 'pmu.fr', date, generatedAt: new Date().toISOString(), currency: 'XOF' },
    racetracks,
  };
}

function finishPosition(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const match = String(candidate == null ? '' : candidate).match(/\d+/);
  return match ? Number(match[0]) : null;
}

async function fetchPmuResult(date, reunionNumber, courseNumber) {
  const payload = await getJson(`/${formatDate(date)}/R${reunionNumber}/C${courseNumber}/participants`);
  const finishers = (payload.participants || [])
    .map((participant) => ({ number: numeric(participant.numPmu), position: finishPosition(participant.ordreArrivee) }))
    .filter((entry) => entry.number != null && entry.position != null && entry.position > 0)
    .sort((a, b) => a.position - b.position);
  return finishers.length >= 3 ? finishers.map((entry) => entry.number) : null;
}

module.exports = {
  scrapeProgrammePmu,
  fetchPmuResult,
  _test: { formatDate, normalizeParticipant, normalizeRace, finishPosition, normalizeDeferrage, betLabel },
};
