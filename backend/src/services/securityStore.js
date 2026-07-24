const crypto = require('crypto');

let redisClient;
let redisWarningAt = 0;

function redisKey(namespace, value) {
  const digest = crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex');
  return `ppm:security:${namespace}:${digest}`;
}

function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;

  const IORedis = require('ioredis');
  redisClient = new IORedis(process.env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1000,
    retryStrategy: () => null,
  });
  redisClient.on('error', () => {
    const now = Date.now();
    if (now - redisWarningAt > 60_000) {
      redisWarningAt = now;
      console.warn('[security] Redis indisponible, limitation locale temporaire');
    }
  });
  return redisClient;
}

async function ensureConnected(client) {
  if (!client) return false;
  if (client.status === 'ready') return true;
  if (client.status === 'wait') await client.connect();
  return client.status === 'ready';
}

async function incrementWindow(namespace, value, windowMs) {
  const client = getRedisClient();
  try {
    if (!(await ensureConnected(client))) return null;
    const result = await client
      .multi()
      .incr(redisKey(namespace, value))
      .pexpire(redisKey(namespace, value), windowMs, 'NX')
      .exec();
    return Number(result?.[0]?.[1]) || null;
  } catch {
    return null;
  }
}

async function readFlag(namespace, value) {
  const client = getRedisClient();
  try {
    if (!(await ensureConnected(client))) return null;
    return (await client.exists(redisKey(namespace, value))) === 1;
  } catch {
    return null;
  }
}

async function setFlag(namespace, value, ttlMs) {
  const client = getRedisClient();
  try {
    if (!(await ensureConnected(client))) return false;
    await client.set(redisKey(namespace, value), '1', 'PX', ttlMs);
    return true;
  } catch {
    return false;
  }
}

async function clearKeys(entries) {
  const client = getRedisClient();
  try {
    if (!(await ensureConnected(client))) return false;
    const keys = entries.map(([namespace, value]) => redisKey(namespace, value));
    if (keys.length) await client.del(...keys);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  incrementWindow,
  readFlag,
  setFlag,
  clearKeys,
};
