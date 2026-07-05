/* eslint-disable no-console */
// Self-contained geny.com crawler for the backend (uses backend's axios+cheerio).
// Returns a payload object (does NOT write files). Used by the ingest job and
// the admin "scrape now" endpoint.

const axios = require('axios');
const cheerio = require('cheerio');
const { findRunnersTable, cell } = require('../scraper/columnMapper');
const { parseMusique, formScoreFromParsed } = require('../scraper/musique');

const BASE = 'https://www.geny.com';
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 4;

const HTTP = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; ParisPromaxBot/1.0; +https://parispromax.app)',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(url) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await HTTP.get(url);
    } catch (e) {
      lastErr = e;
      const status = e.response && e.response.status;
      if (status === 429 || status >= 500 || !status) {
        await sleep(REQUEST_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw e;
    }
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

  // Discipline dominante déduite des musiques (trot attelé/monté vs plat/obstacle).
  const specCount = {};
  horses.forEach((h) => {
    const s = h.musiqueParsed && h.musiqueParsed.specialite_predominante;
    if (s) specCount[s] = (specCount[s] || 0) + 1;
  });
  const discipline = Object.keys(specCount).sort((a, b) => specCount[b] - specCount[a])[0] || null;

  return {
    id: `c${course.id}`,
    number: '',
    name: raceName,
    time: '',
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
  } catch {
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
  } catch {
    return null;
  }
}

// Main entry — returns a payload object in the app schema.
async function scrapeProgramme(date, { maxReunions = 8, maxCourses = 4 } = {}) {
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
        await sleep(REQUEST_DELAY_MS);
        const odds = await fetchOdds(course);
        race.horses.forEach((h) => {
          // La page /cotes/ donne la cote live la plus fraîche : elle prime.
          if (odds[h.number] != null) {
            h.odds = odds[h.number];
            h.coteFloat = odds[h.number];
          }
        });
        race.number = `C${i + 1}`;
        if (race.horses.length) races.push(race);
        await sleep(REQUEST_DELAY_MS);
      } catch (e) {
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

module.exports = { scrapeProgramme, fetchResult };
