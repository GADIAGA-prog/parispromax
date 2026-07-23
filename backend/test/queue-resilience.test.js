const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  connectionOptions,
  enqueuePrediction,
  probeRedis,
  startPredictionWorker,
  stopPredictionWorker,
} = require('../src/services/queue');

function silentLogger() {
  return {
    warnings: [],
    errors: [],
    log() {},
    warn(...args) {
      this.warnings.push(args);
    },
    error(...args) {
      this.errors.push(args);
    },
  };
}

test('les connexions BullMQ abandonnent après un nombre borné de reconnexions', () => {
  const producer = connectionOptions();
  const worker = connectionOptions({ worker: true });

  assert.equal(producer.maxRetriesPerRequest, 1);
  assert.equal(worker.maxRetriesPerRequest, null);
  assert.equal(worker.retryStrategy(1), 200);
  assert.equal(worker.retryStrategy(3), 600);
  assert.equal(worker.retryStrategy(4), null);
  assert.equal(worker.reconnectOnError(new Error('READONLY')), false);
});

test('la sonde Redis rend la main après son délai même si connect ne répond jamais', async () => {
  class HangingRedis extends EventEmitter {
    constructor(_url, options) {
      super();
      this.options = options;
      this.disconnected = false;
      HangingRedis.instance = this;
    }

    connect() {
      return new Promise(() => {});
    }

    ping() {
      return Promise.resolve('PONG');
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  const startedAt = Date.now();
  const available = await probeRedis({ RedisClass: HangingRedis, timeoutMs: 20 });

  assert.equal(available, false);
  assert.equal(HangingRedis.instance.disconnected, true);
  assert.ok(Date.now() - startedAt < 250);
});

test("le worker n'est jamais construit lorsque Redis est indisponible", async () => {
  await stopPredictionWorker();
  const logger = silentLogger();
  let workerConstructions = 0;
  let connectionConstructions = 0;

  class ForbiddenWorker {
    constructor() {
      workerConstructions++;
    }
  }

  const worker = await startPredictionWorker({
    probeRedisFn: async () => false,
    connectionFactory: () => {
      connectionConstructions++;
      return new EventEmitter();
    },
    WorkerClass: ForbiddenWorker,
    logger,
  });

  assert.equal(worker, null);
  assert.equal(workerConstructions, 0);
  assert.equal(connectionConstructions, 0);
  assert.equal(logger.warnings.length, 1);
});

test('le worker démarre seulement après une sonde Redis réussie', async () => {
  await stopPredictionWorker();
  const logger = silentLogger();
  const order = [];

  class FakeConnection extends EventEmitter {
    disconnect() {
      order.push('disconnect');
    }
  }

  class FakeWorker extends EventEmitter {
    constructor(name, processor, options) {
      super();
      this.name = name;
      this.processor = processor;
      this.options = options;
      this.closed = false;
      order.push('worker');
    }

    async close() {
      this.closed = true;
      order.push('close');
    }
  }

  const worker = await startPredictionWorker({
    probeRedisFn: async () => {
      order.push('probe');
      return true;
    },
    connectionFactory: ({ worker: workerMode }) => {
      assert.equal(workerMode, true);
      order.push('connection');
      return new FakeConnection();
    },
    WorkerClass: FakeWorker,
    logger,
  });

  assert.deepEqual(order, ['probe', 'connection', 'worker']);
  assert.equal(worker.name, 'predictions');
  assert.equal(worker.options.concurrency, 4);

  await stopPredictionWorker();
  assert.equal(worker.closed, true);
});

test("l'enqueue retourne un mode dégradé au lieu de faire échouer le traitement", async () => {
  await stopPredictionWorker();
  const logger = silentLogger();
  let queueConstructions = 0;

  const result = await enqueuePrediction('R1C1', {
    probeRedisFn: async () => false,
    QueueClass: class {
      constructor() {
        queueConstructions++;
      }
    },
    logger,
  });

  assert.deepEqual(result, { queued: false, reason: 'redis-unavailable' });
  assert.equal(queueConstructions, 0);
});
