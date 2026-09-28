// MODULE 3 — Client du micro-service IA (FastAPI) avec cache Redis.
//
// getPredictions(externalId) :
//   1. tente le cache Redis  course:predictions:<id>  (TTL court),
//   2. sinon construit le payload depuis les Runner (M1) et appelle /predict,
//   3. met le résultat en cache (EX) pour absorber les rafales de requêtes des
//      utilisateurs mobiles dans les minutes qui précèdent le départ.

const axios = require('axios');
const IORedis = require('ioredis');
const prisma = require('../db');

const IA_URL = process.env.IA_URL || 'http://localhost:8100';
// Jeton Bearer exigé par l'IA quand PPM_IA_TOKEN y est défini (même valeur).
const IA_TOKEN = process.env.IA_TOKEN || '';
const REDIS_URL = process.env.REDIS_URL;
const CACHE_TTL = Number(process.env.PPM_PRED_TTL || 60); // secondes
let unavailableUntil = 0;

const redis = REDIS_URL ? new IORedis(REDIS_URL, {
  lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000,
  retryStrategy: () => null,
}) : null;
redis?.on('error', () => {});

function distanceM(d) {
  const m = String(d || '').match(/(\d{3,4})/);
  return m ? parseFloat(m[1]) : null;
}

// Construit le corps /predict à partir des lignes Runner normalisées.
async function buildPayload(race) {
  const runners = await prisma.runner.findMany({ where: { raceId: race.id } });
  let excluded = [];
  try { excluded = JSON.parse(race.nonPartants || '[]'); } catch {}
  const nonPartants = new Set(excluded.map(Number));
  let activeNumbers = null;
  try {
    const raw = JSON.parse(race.raw || '{}');
    if (Array.isArray(raw.horses)) activeNumbers = new Set(raw.horses.map((horse) => Number(horse.number)));
  } catch {}
  return {
    race_id: race.externalId,
    runners: runners.filter((r) => !nonPartants.has(r.number) && (!activeNumbers || activeNumbers.has(r.number))).map((r) => ({
      number: r.number,
      name: r.name,
      cote: r.coteFloat,
      cote_open: r.coteOpen,
      gains: r.gains,
      chrono: r.chrono,
      deferrage: r.deferrage,
      jockey_rating: r.jockeyRating,
      trainer_rating: r.trainerRating,
      derniere_performance: r.musiqueParsed ? r.musiqueParsed.derniere_performance : null,
      taux_top3_recent: r.musiqueParsed ? r.musiqueParsed.taux_top3_recent : null,
      distance_m: distanceM(race.distance),
    })),
  };
}

// Prédictions IA d'une course (cache -> IA). `force` ignore le cache (worker).
async function getPredictions(externalId, { force = false } = {}) {
  const key = `course:predictions:${externalId}`;
  if (!force && redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return { source: 'cache', ...JSON.parse(cached) };
    } catch (e) {
      /* cache indisponible -> on continue vers l'IA */
    }
  }
  const race = await prisma.race.findUnique({ where: { externalId } });
  if (!race) return null;

  const payload = await buildPayload(race);
  if (!payload.runners.length) return { race_id: externalId, predictions: [] };

  const headers = IA_TOKEN ? { Authorization: `Bearer ${IA_TOKEN}` } : {};
  if (Date.now() < unavailableUntil) throw new Error('IA temporairement indisponible');
  let data;
  try {
    ({ data } = await axios.post(`${IA_URL}/predict`, payload, { timeout: 10000, headers }));
    unavailableUntil = 0;
  } catch (error) {
    unavailableUntil = Date.now() + 30000;
    throw error;
  }
  try {
    if (redis) await redis.set(key, JSON.stringify(data), 'EX', CACHE_TTL);
  } catch (e) {
    /* cache best-effort */
  }
  return { source: 'ia', ...data };
}

module.exports = { getPredictions, buildPayload, redis };
