/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// PARISPROMAX — Backend turf scraper (geny.com)
//
// Node.js script (run OUTSIDE the app, e.g. on a cron / server) that crawls the
// public geny.com PMU programme and writes ../services/live_races.json, which
// the app consumes and caches for offline use.
//
//   Usage:  node src/backend-scraper/scraper.js [YYYY-MM-DD]
//
// Flow:
//   1. GET /reunions-courses-pmu?date=YYYY-MM-DD  -> daily programme.
//   2. Extract /partants-pmu/<date>-<hippo>-pmu-<prix>_c<id> links, grouped by
//      hippodrome (réunion).
//   3. For each course, GET the partants page -> table of runners
//      (N°, Cheval, Driver, Entraîneur, Musique, Gains, Dist.).
//   4. GET the matching /cotes/ page -> odds per runner number.
//   5. Derive an AI "formScore" from the musique, map terrain -> condition,
//      and write the app schema. The on-device aiEngine then scores everything.
//
// If scraping fails or yields nothing, the existing live_races.json is kept
// (the app keeps serving last-good data).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const OUTPUT = process.env.PPM_OUTPUT
  ? path.resolve(process.env.PPM_OUTPUT)
  : path.resolve(__dirname, '../services/live_races.json');
const BASE = 'https://www.geny.com';

// Politeness / safety limits to avoid hammering the source (geny rate-limits).
// Overridable via env for quick test runs.
const MAX_REUNIONS = Number(process.env.PPM_MAX_REUNIONS) || 8;
const MAX_COURSES_PER_REUNION = Number(process.env.PPM_MAX_COURSES) || 4;
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 4;

const HTTP = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; ParisPromaxBot/1.0; +https://parispromax.app)',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET with exponential backoff on 429 / transient errors.
async function getWithRetry(url) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await HTTP.get(url);
    } catch (e) {
      lastErr = e;
      const status = e.response && e.response.status;
      if (status === 429 || status >= 500 || !status) {
        const wait = REQUEST_DELAY_MS * Math.pow(2, attempt); // 1.5s, 3s, 6s, 12s
        await sleep(wait);
        continue;
      }
      throw e; // non-retryable (404 etc.)
    }
  }
  throw lastErr;
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function slugToTitle(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Parse a partants URL: /partants-pmu/2026-06-30-vichy-pmu-prix-xxx_c1663633
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

// "1aDa2a1a4a" -> 0..100 recent-form score.
function musiqueToFormScore(musique) {
  if (!musique) return null;
  const tokens = musique.match(/(\d+|[A-Za-z])/g) || [];
  const placings = [];
  for (let i = 0; i < tokens.length && placings.length < 5; i++) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) placings.push(parseInt(t, 10));
    else if (/^[DTAR]$/i.test(t)) placings.push(99); // Disqualified/Tombé/Arrêté
  }
  if (!placings.length) return null;
  const valueOf = (p) => {
    if (p === 1) return 100;
    if (p === 2) return 86;
    if (p === 3) return 72;
    if (p === 4) return 58;
    if (p === 5) return 48;
    if (p >= 6 && p < 99) return 32;
    return 12; // 0 / disqualified
  };
  const avg = placings.reduce((s, p) => s + valueOf(p), 0) / placings.length;
  return Math.round(avg);
}

function mapCondition(text) {
  const t = (text || '').toLowerCase();
  if (/lourd|collant|tr[èe]s souple/.test(t)) return 'heavy';
  if (/souple/.test(t)) return 'soft';
  if (/bon|sec|l[ée]ger/.test(t)) return 'dry';
  return 'dry';
}

async function fetchProgramme(date) {
  const url = `${BASE}/reunions-courses-pmu?date=${date}`;
  const { data } = await getWithRetry(url);
  const $ = cheerio.load(data);

  const courses = [];
  const seen = new Set();
  $('a[href*="/partants-pmu/"]').each((_, el) => {
    const href = $(el).attr('href');
    const parsed = parseCourseUrl(href);
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      courses.push(parsed);
    }
  });

  // Group by hippodrome (réunion), preserving order.
  const byHippo = new Map();
  for (const c of courses) {
    if (!byHippo.has(parsed_key(c))) byHippo.set(parsed_key(c), []);
    byHippo.get(parsed_key(c)).push(c);
  }
  return byHippo;
}

const parsed_key = (c) => c.hippoSlug;

async function fetchCourse(course) {
  const { data } = await getWithRetry(course.partantsUrl);
  const $ = cheerio.load(data);

  const raceName =
    ($('.nomCourse').first().text().trim() || course.prix).replace(/\s+/g, ' ');
  const infoCourse = $('.infoCourse, .conditionCourse').first().text().trim();
  const distMatch = infoCourse.match(/(\d{3,4})\s?m/);
  const distance = distMatch ? `${distMatch[1]}m` : '';
  const condition = mapCondition(infoCourse);

  // Parse the partants table.
  const horses = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((j, td) => $(td).text().trim().replace(/\s+/g, ' '))
      .get();
    if (cells.length < 6) return;
    const number = parseInt(cells[0], 10);
    if (!Number.isFinite(number)) return;

    const name = cells[1];
    // Heuristic column mapping from observed header:
    // N° | Cheval | SA | Dist. | Driver | Entraîneur | Musique | Gains
    const jockey = cells[4] || '';
    const trainer = cells[5] || '';
    const musique = cells[6] || '';
    const gains = parseInt((cells[7] || '').replace(/\D/g, ''), 10) || null;

    if (!name) return;
    horses.push({
      number,
      name,
      jockey,
      trainer,
      form: musique,
      odds: null, // filled from /cotes/
      formScore: musiqueToFormScore(musique),
      chrono: 0,
      winRate: null,
      jockeyRating: null,
      gains,
    });
  });

  return {
    id: `c${course.id}`,
    number: '',
    name: raceName,
    time: '',
    distance,
    condition,
    runners: horses.length,
    horses,
  };
}

async function fetchOdds(course) {
  try {
    const { data } = await getWithRetry(course.cotesUrl);
    const $ = cheerio.load(data);
    const odds = {}; // number -> cote
    $('table tr').each((_, tr) => {
      const cells = $(tr)
        .find('td')
        .map((j, td) => $(td).text().trim().replace(/\s+/g, ' '))
        .get();
      if (cells.length < 2) return;
      const num = parseInt(cells[0], 10);
      if (!Number.isFinite(num)) return;
      // A real cote is a decimal token like "5,3" / "18.4" — NOT the bare
      // integer in the N° column. Require an explicit decimal separator.
      let cote = null;
      for (let i = 1; i < cells.length; i++) {
        const m = cells[i].match(/^(\d{1,3})[.,](\d)$/);
        if (m) {
          cote = parseFloat(`${m[1]}.${m[2]}`);
          break;
        }
      }
      if (cote != null && cote >= 1 && cote < 1000) odds[num] = cote;
    });
    return odds;
  } catch {
    return {};
  }
}

async function scrape(date) {
  console.log(`[scraper] geny.com programme for ${date}…`);
  let byHippo;
  try {
    byHippo = await fetchProgramme(date);
  } catch (e) {
    console.warn('[scraper] programme fetch failed:', e.message);
    keepLastGood();
    return;
  }

  const racetracks = [];
  const hippos = [...byHippo.entries()].slice(0, MAX_REUNIONS);

  for (const [hippoSlug, courses] of hippos) {
    const hippoName = courses[0].hippo;
    const races = [];
    const slice = courses.slice(0, MAX_COURSES_PER_REUNION);

    for (let i = 0; i < slice.length; i++) {
      const course = slice[i];
      try {
        const race = await fetchCourse(course);
        await sleep(REQUEST_DELAY_MS);
        const odds = await fetchOdds(course);
        race.horses.forEach((h) => {
          if (odds[h.number] != null) h.odds = odds[h.number];
        });
        race.number = `R-C${i + 1}`;
        if (race.horses.length) races.push(race);
        await sleep(REQUEST_DELAY_MS);
      } catch (e) {
        console.warn(`[scraper]   course ${course.id} failed:`, e.message);
      }
    }

    if (races.length) {
      racetracks.push({
        id: hippoSlug,
        name: hippoName,
        discipline: 'PMU',
        condition: races[0].condition || 'dry',
        prizePool: null,
        country: 'FR',
        races,
      });
      console.log(`[scraper]   ${hippoName}: ${races.length} courses`);
    }
  }

  if (!racetracks.length) {
    console.warn('[scraper] No usable data. Keeping last-good live_races.json.');
    keepLastGood();
    return;
  }

  const payload = {
    meta: {
      source: 'geny.com',
      generatedAt: new Date().toISOString(),
      date,
      successRateQuinte: 74,
      currency: 'XOF',
    },
    racetracks,
    history: readExistingHistory(),
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `[scraper] Wrote ${OUTPUT} — ${racetracks.length} hippodromes, ` +
      `${racetracks.reduce((s, t) => s + t.races.length, 0)} courses.`
  );
}

function readExistingHistory() {
  try {
    const existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    return Array.isArray(existing.history) ? existing.history : [];
  } catch {
    return [];
  }
}

function keepLastGood() {
  process.exitCode = 1;
}

const dateArg = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2])
  ? process.argv[2]
  : todayISO();

scrape(dateArg).catch((e) => {
  console.error('[scraper] Fatal:', e);
  process.exitCode = 1;
});
