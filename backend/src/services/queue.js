// MODULE 3 — File d'attente Redis (BullMQ) pour le calcul IA asynchrone.
//
// Quand une course est scrapée ou que ses cotes changent, on POUSSE un job.
// Un WORKER de fond consomme le job, appelle le micro-service IA (via iaClient,
// qui met en cache), puis DIFFUSE le résultat en temps réel (WebSocket). Le
// thread des requêtes utilisateur n'est jamais bloqué par le calcul IA.

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { getPredictions } = require('./iaClient');
const { broadcastPredictions } = require('./realtime');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'predictions';

// BullMQ exige maxRetriesPerRequest: null sur la connexion.
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const predictionsQueue = new Queue(QUEUE_NAME, { connection });

// Producteur — à appeler après un scrape/une MAJ de cotes.
async function enqueuePrediction(externalId) {
  await predictionsQueue.add(
    'refresh',
    { externalId },
    { removeOnComplete: 200, removeOnFail: 100, attempts: 2, backoff: { type: 'exponential', delay: 2000 } }
  );
}

// Worker — recalcule via l'IA (force = ignore le cache) puis diffuse.
function startPredictionWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { externalId } = job.data;
      const result = await getPredictions(externalId, { force: true });
      if (result) broadcastPredictions(externalId, result);
      return { ok: true, externalId };
    },
    { connection, concurrency: 4 }
  );
  worker.on('failed', (job, err) => console.error('[queue] job failed', job && job.id, err.message));
  console.log('[queue] prediction worker started');
  return worker;
}

module.exports = { predictionsQueue, enqueuePrediction, startPredictionWorker };
