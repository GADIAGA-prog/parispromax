/* eslint-disable no-console */
// Self-contained geny.com crawler for the backend (uses backend's axios+cheerio).
// Returns a payload object (does NOT write files). Used by the ingest job and
// the admin "scrape now" endpoint.

const axios = require('axios');
const cheerio = require('cheerio');
const { findRunnersTable, cell } = require('../scraper/columnMapper');
const { parseMusique, formScoreFromParsed } = require('../scraper/musique');
const { scrapeProgrammePmu } = require('./scrapePmu');

const BASE = 'https://www.geny.com';
const REQUEST_INTERVAL_MS = Math.max(1000, Number(process.env.SCRAPER_REQUEST_INTERVAL_MS) || 2500);
const BASE_RETRY_DELAY_MS = Math.max(1000, Number(process.env.SCRAPER_RETRY_DELAY_MS) || 5000);
const MAX_RETRY_DELAY_MS = 120000;
const MAX_RETRY_BUDGET_MS = Math.max(30000, Number(process.env.SCRAPER_RETRY_BUDGET_MS) || 90000);
const MAX_RETRIES = 5;

const HTTP = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; ParisPromaxBot/1.0; +https://parispromax.app)',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// All Geny traffic in this Node process shares one request slot. This prevents
// the admin scrape and the results cron from bursting concurrently from the
// same Render IP.
let nextRequestAt = 0;

async function waitForRequestSlot() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + REQUEST_INTERVAL_MS;
  if (scheduledAt > now) await sleep(scheduledAt - now);
}

function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function retryDelay(error, attempt, random = Math.random) {
  const header = error.response && error.response.headers && error.response.headers['retry-after'];
  const requested = parseRetryAfter(header);
  if (requested != null) return Math.min(requested, MAX_RETRY_DELAY_MS);
  const exponential = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt), MAX_RETRY_DELAY_MS);
  return exponential + Math.floor(random() * Math.min(1000, exponential * 0.2));
}

function upstreamRateLimitError(error, delayMs) {
  const wrapped = new Error('Geny limite temporairement les requêtes. Réessayez dans quelques minutes.');
  wrapped.code = 'UPSTREAM_RATE_LIMIT';
  wrapped.upstreamStatus = 429;
  wrapped.retryAfterSeconds = Math.max(30, Math.ceil((delayMs || BASE_RETRY_DELAY_MS) / 1000));
  wrapped.cause = error;
  return wrapped;
}

function isRetryableNetworkError(error) {
  const code = String(error && error.code || '').toUpperCase();
  // Certificate/configuration failures will not heal with backoff. Retrying
  // them only keeps the admin request open for more than a minute.
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return false;
  return true;
}

async function getWithRetry(url) {
  let lastErr;
  let lastDelay = BASE_RETRY_DELAY_MS;
  const startedAt = Date.now();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await waitForRequestSlot();
      return await HTTP.get(url);
    } catch (e) {
      lastErr = e;
      const status = e.response && e.response.status;
      if (status === 429 || status >= 500 || (!status && isRetryableNetworkError(e))) {
        if (attempt === MAX_RETRIES - 1) break;
        lastDelay = retryDelay(e, attempt);
        // Keep synchronous admin requests below the hosting proxy timeout. If
        // Retry-After exceeds the remaining budget, report it to the caller
        // instead of violating it or leaving the HTTP request open for minutes.
        if (Date.now() - startedAt + lastDelay > MAX_RETRY_BUDGET_MS) break;
        nextRequestAt = Math.max(nextRequestAt, Date.now() + lastDelay);
        console.warn(`[scrape] ${status || 'network'} from Geny; retry ${attempt + 2}/${MAX_RETRIES} in ${Math.ceil(lastDelay / 1000)}s`);
        await sleep(lastDelay);
        continue;
      }
      throw e;
    }
  }
  if (lastErr && lastErr.response && lastErr.response.status === 429) {
    throw upstreamRateLimitError(lastErr, lastDelay);
  }
  throw lastErr;
}

function slugToTitle(slug) {
  return slug.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parseCourseUrl(href) {
  const m = href.match(/\/partants-pmu\/(\d{4}-\d{2}-\d{2})-(.+?)-pmu-(.+?)_c(\d+)/);
  if (!m) return null;
  const [, date, hippoSlug, prixSlug, id] = m;
  return {
    id,
    date,
    hippoSlug,
    hippo: slugToTitle(hippoSlug),
    prix: slugToTitle(prixSlug),
    partantsUrl: BASE + href,
    cotesUrl: BASE + href.replace('/partants-pmu/', '/cotes/'),
  };
}

// "5,3" / "18.4" / "12" -> 5.3 / 18.4 / 12 (cote décimale valide sinon null).
function parseCote(raw) {
  const m = String(raw || '').replace(',', '.').match(/(\d{1,3}(?:\.\d)?)/);
  const v = m ? parseFloat(m[1]) : null;
  return v != null && v >= 1 && v < 1000 ? v : null;
}

// Réduction kilométrique trot "1'14"5" -> secondes (approx, tenths ignorés).
function parseChrono(raw) {
  const c = String(raw || '');
  const m = c.match(/(\d)\s*['’]\s*(\d{1,2})/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const f = parseFloat(c.replace(',', '.'));
  return Number.isFinite(f) && f > 0 ? f : 0;
}

// Déferrage (trot) : colonne dédiée ou suffixe "D4/DA/DP" collé au nom.
function detectDeferrage(name, deferrageCell) {
  const src = `${deferrageCell || ''} ${name || ''}`.toLowerCase().replace(/\s+/g, '');
  const m = src.match(/(d4|dpp|dpa|dp|da)/);
  return m ? m[1].toUpperCase() : null;
}

function mapCondition(text) {
  const t = (text || '').toLowerCase();
  if (/lourd|collant|tr[èe]s souple/.test(t)) return 'heavy';
  if (/souple/.test(t)) return 'soft';
  if (/bon|sec|l[ée]ger/.test(t)) return 'dry';
  return 'dry';
}

async function fetchProgramme(date) {
  const { data } = await getWithRetry(`${BASE}/reunions-courses-pmu?date=${date}`);
  const $ = cheerio.load(data);
  const seen = new Set();
  const byHippo = new Map();
  $('a[href*="/partants-pmu/"]').each((_, el) => {
    const parsed = parseCourseUrl($(el).attr('href'));
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      if (!byHippo.has(parsed.hippoSlug)) byHippo.set(parsed.hippoSlug, []);
      byHippo.get(parsed.hippoSlug).push(parsed);
    }
  });
  return byHippo;
}

async function fetchCourse(course) {
  const { data } = await getWithRetry(course.partantsUrl);
  const $ = cheerio.load(data);
  const raceName = ($('.nomCourse').first().text().trim() || course.prix).replace(/\s+/g, ' ');
  const infoCourse = $('.infoCourse, .conditionCourse').first().text().trim();
  const distMatch = infoCourse.match(/(\d{3,4})\s?m/);

  // Heure de départ ("Départ à 20h15" / "20 h 15") — cherchée dans le bloc info
  // puis, à défaut, dans l'en-tête de page.
  const headText = `${infoCourse} ${$('.nomCourse').parent().text()}`.replace(/\s+/g, ' ');
  const timeMatch = headText.match(/(?:d[ée]part[^0-9]{0,12})?(\d{1,2})\s*h\s*(\d{2})/i);
  const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '';

  // Allocation ("68.000 €", "68 000 Euros") -> montant entier en euros.
  const prizeMatch = headText.match(/([\d]{2,3}(?:[\s.,]\d{3})+|\d{4,7})\s*(?:€|euros?)/i);
  const prize = prizeMatch ? parseInt(prizeMatch[1].replace(/\D/g, ''), 10) : null;

  // Type de course (Attelé / Monté / Plat / Haies / Steeple / Cross) + départ
  // autostart, lus dans le descriptif de la course.
  const lowInfo = headText.toLowerCase();
  let type = null;
  if (/attel/.test(lowInfo)) type = 'Trot Attelé';
  else if (/mont[ée]/.test(lowInfo)) type = 'Trot Monté';
  else if (/steeple/.test(lowInfo)) type = 'Obstacle — Steeple';
  else if (/haies/.test(lowInfo)) type = 'Obstacle — Haies';
  else if (/cross/.test(lowInfo)) type = 'Cross';
  else if (/plat/.test(lowInfo)) type = 'Plat';
  const autostart = /autostart/i.test(headText);

  // M1 — détecte dynamiquement la table de partants + la position de chaque
  // colonne (jockey/musique/cote…) au lieu d'index fixes fragiles.
  const found = findRunnersTable($);
  const horses = [];
  if (found) {
    const { table, map } = found;
    $(table)
      .find('tr')
      .each((_, tr) => {
        const cells = $(tr)
          .find('td')
          .map((j, td) => $(td).text().trim().replace(/\s+/g, ' '))
          .get();
        if (!cells.length) return; // ligne d'en-tête (th) ou vide
        const number = parseInt(cell(cells, map, 'number'), 10);
        const name = cell(cells, map, 'name');
        if (!Number.isFinite(number) || !name) return;

        const musiqueRaw = cell(cells, map, 'musique');
        const musiqueParsed = parseMusique(musiqueRaw);
        const coteFloat = parseCote(cell(cells, map, 'cote'));

        horses.push({
          number,
          name,
          jockey: cell(cells, map, 'jockey') || '',
          trainer: cell(cells, map, 'trainer') || '',
          // Rétro-compat avec l'existant (aiEngine, ingest) :
          form: musiqueRaw || '',
          formScore: formScoreFromParsed(musiqueParsed),
          odds: coteFloat, // complété par /cotes/ dans scrapeProgramme
          chrono: parseChrono(cell(cells, map, 'chrono')),
          winRate: musiqueParsed.taux_top3_recent,
          jockeyRating: null,
          gains: parseInt(cell(cells, map, 'gains').replace(/\D/g, ''), 10) || null,
          // Nouveaux champs structurés (M1) :
          coteFloat,
          musiqueRaw: musiqueRaw || '',
          musiqueParsed,
          deferrage: detectDeferrage(name, cell(cells, map, 'deferrage')),
        });
      });
  }

  // Discipline dominante déduite des musiques (trot attelé/monté vs plat/obstacle)
  // — repli quand le descriptif ne donne pas le type.
  const specCount = {};
  horses.forEach((h) => {
    const s = h.musiqueParsed && h.musiqueParsed.specialite_predominante;
    if (s) specCount[s] = (specCount[s] || 0) + 1;
  });
  const discipline = Object.keys(specCount).sort((a, b) => specCount[b] - specCount[a])[0] || null;
  const TYPE_FROM_SPEC = { attele: 'Trot Attelé', monte: 'Trot Monté', plat: 'Plat', obstacle: 'Obstacle' };

  return {
    id: `c${course.id}`,
    number: '',
    name: raceName,
    time,
    prize, // allocation en euros (null si non trouvée)
    type: type || TYPE_FROM_SPEC[discipline] || null,
    autostart,
    distance: distMatch ? `${distMatch[1]}m` : '',
    discipline,
    condition: mapCondition(infoCourse),
    runners: horses.length,
    horses,
  };
}

async function fetchOdds(course) {
  try {
    const { data } = await getWithRetry(course.cotesUrl);
    const $ = cheerio.load(data);
    const odds = {};
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('td').map((j, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();
      if (cells.length < 2) return;
      const num = parseInt(cells[0], 10);
      if (!Number.isFinite(num)) return;
      let cote = null;
      for (let i = 1; i < cells.length; i++) {
        const mm = cells[i].match(/^(\d{1,3})[.,](\d)$/);
        if (mm) { cote = parseFloat(`${mm[1]}.${mm[2]}`); break; }
      }
      if (cote != null && cote >= 1 && cote < 1000) odds[num] = cote;
    });
    return odds;
  } catch (e) {
    if (e.code === 'UPSTREAM_RATE_LIMIT') throw e;
    return {};
  }
}

// Fetch a finished race's arrival order (finishing positions -> horse numbers).
// Returns an array like [4, 6, 1, 8, 2] or null if the race isn't run yet.
async function fetchResult(courseId) {
  try {
    const { data } = await getWithRetry(`${BASE}/arrivee-et-rapports-pmu?id_course=${courseId}`);
    const $ = cheerio.load(data);
    const posToNum = new Map();
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('td').map((j, td) => $(td).text().trim()).get();
      if (cells.length < 2) return;
      const pos = parseInt(cells[0], 10);
      const num = parseInt(cells[1], 10);
      if (Number.isFinite(pos) && Number.isFinite(num) && pos >= 1 && pos <= 30 && num >= 1 && num <= 30) {
        if (!posToNum.has(pos)) posToNum.set(pos, num);
      }
    });
    // Read contiguous finishing order starting at position 1.
    const winners = [];
    for (let p = 1; posToNum.has(p); p++) winners.push(posToNum.get(p));
    return winners.length >= 3 ? winners : null;
  } catch (e) {
    if (e.code === 'UPSTREAM_RATE_LIMIT') throw e;
    return null;
  }
}

// Main entry — returns a payload object in the app schema.
async function scrapeProgrammeGeny(date, { maxReunions = 8, maxCourses = 4 } = {}) {
  const byHippo = await fetchProgramme(date);
  const racetracks = [];
  const hippos = [...byHippo.entries()].slice(0, maxReunions);

  for (const [hippoSlug, courses] of hippos) {
    const races = [];
    const slice = courses.slice(0, maxCourses);
    for (let i = 0; i < slice.length; i++) {
      const course = slice[i];
      try {
        const race = await fetchCourse(course);
        // The runners page often already contains usable odds. Only request
        // the dedicated odds page when none were parsed, cutting normal Geny
        // traffic almost in half.
        const hasOdds = race.horses.some((horse) => horse.odds != null);
        const odds = hasOdds ? {} : await fetchOdds(course);
        race.horses.forEach((h) => {
          // La page /cotes/ donne la cote live la plus fraîche : elle prime.
          if (odds[h.number] != null) {
            h.odds = odds[h.number];
            h.coteFloat = odds[h.number];
          }
        });
        race.number = `C${i + 1}`;
        if (race.horses.length) races.push(race);
      } catch (e) {
        // Continuing with dozens of other pages after a 429 only extends the
        // upstream ban. Abort this scrape and preserve the existing DB data.
        if (e.code === 'UPSTREAM_RATE_LIMIT') throw e;
        console.warn(`[scrape] course ${course.id} failed:`, e.message);
      }
    }
    if (races.length) {
      racetracks.push({
        id: hippoSlug,
        name: courses[0].hippo,
        discipline: 'PMU',
        condition: races[0].condition || 'dry',
        prizePool: null,
        country: 'FR',
        races,
      });
    }
  }

  return {
    meta: { source: 'geny.com', date, generatedAt: new Date().toISOString(), currency: 'XOF' },
    racetracks,
  };
}

// PMU provides structured data without consuming Geny's heavily rate-limited
// HTML pages. Keep Geny as a transparent fallback while the PMU endpoint,
// which is public but undocumented, is validated on every scrape.
async function scrapeProgramme(date, options = {}) {
  const source = String(process.env.RACE_DATA_SOURCE || 'pmu').trim().toLowerCase();
  if (source !== 'geny') {
    try {
      const payload = await scrapeProgrammePmu(date, options);
      console.log(`[scrape] source PMU: ${payload.racetracks.length} reunion(s)`);
      return payload;
    } catch (error) {
      console.warn(`[scrape] source PMU indisponible (${error.code || error.message})`);
      if (source === 'pmu-only') throw error;
      console.warn('[scrape] bascule automatique vers Geny');
    }
  }
  return scrapeProgrammeGeny(date, options);
}

module.exports = {
  scrapeProgramme,
  scrapeProgrammeGeny,
  fetchResult,
  _test: { parseRetryAfter, retryDelay, isRetryableNetworkError },
};
