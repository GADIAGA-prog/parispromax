/* eslint-disable no-console */
// Self-contained geny.com crawler for the backend (uses backend's axios+cheerio).
// Returns a payload object (does NOT write files). Used by the ingest job and
// the admin "scrape now" endpoint.

const axios = require('axios');
const cheerio = require('cheerio');

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

function musiqueToFormScore(musique) {
  if (!musique) return null;
  const tokens = musique.match(/(\d+|[A-Za-z])/g) || [];
  const placings = [];
  for (let i = 0; i < tokens.length && placings.length < 5; i++) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) placings.push(parseInt(t, 10));
    else if (/^[DTAR]$/i.test(t)) placings.push(99);
  }
  if (!placings.length) return null;
  const valueOf = (p) => {
    if (p === 1) return 100;
    if (p === 2) return 86;
    if (p === 3) return 72;
    if (p === 4) return 58;
    if (p === 5) return 48;
    if (p >= 6 && p < 99) return 32;
    return 12;
  };
  return Math.round(placings.reduce((s, p) => s + valueOf(p), 0) / placings.length);
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
  const horses = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td').map((j, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();
    if (cells.length < 6) return;
    const number = parseInt(cells[0], 10);
    if (!Number.isFinite(number)) return;
    const name = cells[1];
    if (!name) return;
    horses.push({
      number,
      name,
      jockey: cells[4] || '',
      trainer: cells[5] || '',
      form: cells[6] || '',
      odds: null,
      formScore: musiqueToFormScore(cells[6] || ''),
      chrono: 0,
      winRate: null,
      jockeyRating: null,
    });
  });
  return {
    id: `c${course.id}`,
    number: '',
    name: raceName,
    time: '',
    distance: distMatch ? `${distMatch[1]}m` : '',
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
        race.horses.forEach((h) => { if (odds[h.number] != null) h.odds = odds[h.number]; });
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

module.exports = { scrapeProgramme };
