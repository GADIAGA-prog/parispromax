// File d'attente Redis (BullMQ) pour le calcul IA asynchrone.
//
// Redis est une optimisation, pas une dépendance du serveur HTTP. Aucune
// connexion n'est donc créée au chargement de ce module. Le worker et le
// producteur ne sont construits qu'après une sonde Redis courte et bornée.

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { broadcastPredictions } = require('./realtime');

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const DEFAULT_PROBE_TIMEOUT_MS = 1500;
const MAX_RECONNECT_ATTEMPTS = 3;
const QUEUE_NAME = 'predictions';

let activeWorker = null;
let workerConnection = null;
let workerStartPromise = null;
let activeQueue = null;
let queueConnection = null;
let unavailableWarningLogged = false;

function redisUrl() {
  return process.env.REDIS_URL || DEFAULT_REDIS_URL;
}

function connectionOptions({ worker = false, connectTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  return {
    connectTimeout: connectTimeoutMs,
    maxRetriesPerRequest: worker ? null : 1,
    // BullMQ peut mettre en attente ses commandes pendant la connexion initiale,
    // mais IORedis abandonne définitivement après quelques reconnexions.
    enableOfflineQueue: true,
    retryStrategy(attempt) {
      if (attempt > MAX_RECONNECT_ATTEMPTS) return null;
      return Math.min(attempt * 200, 600);
    },
    reconnectOnError() {
      return false;
    },
  };
}

function probeOptions(timeoutMs) {
  return {
    ...connectionOptions({ connectTimeoutMs: timeoutMs }),
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy() {
      return null;
    },
  };
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis probe timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Sonde silencieuse : une indisponibilité Redis attendue ne doit pas saturer les
// logs. L'appelant décide s'il faut émettre un unique avertissement synthétique.
async function probeRedis({
  url = redisUrl(),
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  RedisClass = IORedis,
} = {}) {
  const client = new RedisClass(url, probeOptions(timeoutMs));
  if (typeof client.on === 'function') client.on('error', () => {});

  try {
    await withTimeout(
      (async () => {
        await client.connect();
        const pong = await client.ping();
        if (String(pong).toUpperCase() !== 'PONG') {
          throw new Error('Unexpected Redis PING response');
        }
      })(),
      timeoutMs
    );
    return true;
  } catch {
    return false;
  } finally {
    if (typeof client.disconnect === 'function') client.disconnect();
  }
}

function createRedisConnection({
  url = redisUrl(),
  worker = false,
  RedisClass = IORedis,
} = {}) {
  return new RedisClass(url, connectionOptions({ worker }));
}

function warnUnavailableOnce(logger) {
  if (unavailableWarningLogged) return;
  unavailableWarningLogged = true;
  logger.warn(
    '[queue] Redis indisponible : worker et file désactivés; HTTP et IA directe restent disponibles.'
  );
}

function logErrorOnce(logger, prefix) {
  let logged = false;
  return (error) => {
    if (logged) return;
    logged = true;
    logger.error(prefix, error && error.message ? error.message : String(error));
  };
}

async function ensurePredictionsQueue({
  probeRedisFn = probeRedis,
  connectionFactory = createRedisConnection,
  QueueClass = Queue,
  logger = console,
} = {}) {
  if (activeQueue) return activeQueue;

  const available = await probeRedisFn();
  if (!available) {
    warnUnavailableOnce(logger);
    return null;
  }

  queueConnection = connectionFactory({ worker: false });
  if (typeof queueConnection.on === 'function') {
    queueConnection.on('error', logErrorOnce(logger, '[queue] producer Redis error:'));
  }
  activeQueue = new QueueClass(QUEUE_NAME, { connection: queueConnection });
  if (typeof activeQueue.on === 'function') {
    activeQueue.on('error', logErrorOnce(logger, '[queue] producer error:'));
  }
  return activeQueue;
}

// Producteur — à appeler après un scrape/une mise à jour de cotes. En mode
// dégradé, l'absence de Redis est signalée sans faire tomber le traitement HTTP.
async function enqueuePrediction(externalId, options = {}) {
  const queue = await ensurePredictionsQueue(options);
  if (!queue) return { queued: false, reason: 'redis-unavailable' };

  try {
    return await queue.add(
      'refresh',
      { externalId },
      {
        removeOnComplete: 200,
        removeOnFail: 100,
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
      }
    );
  } catch {
    // Redis a pu tomber entre la sonde et l'ajout du job. La file est remise à
    // zéro pour qu'un prochain appel puisse la recréer après rétablissement.
    activeQueue = null;
    if (queueConnection && typeof queueConnection.disconnect === 'function') {
      queueConnection.disconnect();
    }
    queueConnection = null;
    warnUnavailableOnce(options.logger || console);
    return { queued: false, reason: 'redis-unavailable' };
  }
}

// Worker — la sonde doit réussir avant toute construction de Worker/BullMQ.
async function startPredictionWorker({
  probeRedisFn = probeRedis,
  connectionFactory = createRedisConnection,
  WorkerClass = Worker,
  logger = console,
} = {}) {
  if (activeWorker) return activeWorker;
  if (workerStartPromise) return workerStartPromise;

  workerStartPromise = (async () => {
    const available = await probeRedisFn();
    if (!available) {
      warnUnavailableOnce(logger);
      return null;
    }

    const connection = connectionFactory({ worker: true });
    workerConnection = connection;
    if (typeof connection.on === 'function') {
      connection.on('error', logErrorOnce(logger, '[queue] worker Redis error:'));
    }

    const worker = new WorkerClass(
      QUEUE_NAME,
      async (job) => {
        // Chargement différé : le client de cache IA n'essaie jamais Redis tant
        // qu'un job n'est pas réellement consommé.
        const { getPredictions } = require('./iaClient');
        const { externalId } = job.data;
        const result = await getPredictions(externalId, { force: true });
        if (result) broadcastPredictions(externalId, result);
        return { ok: true, externalId };
      },
      { connection, concurrency: 4 }
    );

    activeWorker = worker;
    if (typeof worker.on === 'function') {
      worker.on('failed', (job, error) => {
        logger.error('[queue] job failed', job && job.id, error.message);
      });
      const reportWorkerError = logErrorOnce(logger, '[queue] worker error:');
      worker.on('error', (error) => {
        reportWorkerError(error);
        // Une fois IORedis arrivé au bout de ses tentatives bornées, arrêter le
        // worker empêche BullMQ de relancer sa boucle interne indéfiniment.
        if (activeWorker !== worker) return;
        activeWorker = null;
        if (typeof connection.disconnect === 'function') {
          connection.disconnect();
        }
        if (workerConnection === connection) {
          workerConnection = null;
        }
        if (typeof worker.close === 'function') {
          void worker.close(true).catch(() => {});
        }
      });
    }

    logger.log('[queue] prediction worker started');
    return worker;
  })();

  try {
    return await workerStartPromise;
  } finally {
    workerStartPromise = null;
  }
}

async function stopPredictionWorker() {
  const worker = activeWorker;
  const queue = activeQueue;
  activeWorker = null;
  activeQueue = null;

  if (worker && typeof worker.close === 'function') {
    await worker.close(true);
  }
  if (queue && typeof queue.close === 'function') {
    await queue.close();
  }
  if (workerConnection && typeof workerConnection.disconnect === 'function') {
    workerConnection.disconnect();
  }
  if (queueConnection && typeof queueConnection.disconnect === 'function') {
    queueConnection.disconnect();
  }
  workerConnection = null;
  queueConnection = null;
}

// Façade rétrocompatible sans connexion eager. Les usages internes passent par
// enqueuePrediction, mais un ancien appel predictionsQueue.add reste fonctionnel.
const predictionsQueue = {
  async add(...args) {
    const queue = await ensurePredictionsQueue();
    if (!queue) throw new Error('Redis unavailable');
    return queue.add(...args);
  },
  async close() {
    await stopPredictionWorker();
  },
};

module.exports = {
  predictionsQueue,
  enqueuePrediction,
  startPredictionWorker,
  stopPredictionWorker,
  probeRedis,
  connectionOptions,
};
