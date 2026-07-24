// Real-time odds are available to authenticated members. Paid predictions use
// a separate room that is joined only after a server-side subscription check.

let io = null;

function initRealtime(httpServer) {
  const { Server } = require('socket.io');
  const config = require('../config');
  const { authenticateToken } = require('../auth');
  const { browserOriginAllowed } = require('./corsOrigins');
  const { getAccess } = require('./subscription');

  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (browserOriginAllowed(origin, config.corsOrigins)) return callback(null, true);
        return callback(new Error('Origine non autorisée'));
      },
    },
  });

  io.use(async (socket, next) => {
    const header = String(socket.handshake.headers.authorization || '');
    const token = String(
      socket.handshake.auth?.token ||
      (header.startsWith('Bearer ') ? header.slice(7) : '')
    );
    try {
      const identity = await authenticateToken(token);
      socket.data.userId = identity.userId;
      return next();
    } catch {
      return next(new Error('Authentification requise'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('subscribe:race', async (externalId, acknowledge) => {
      const safeId = String(externalId || '').trim().slice(0, 160);
      if (!safeId) return;

      socket.join(`race-public:${safeId}`);
      const access = await getAccess(socket.data.userId);
      if (access.hasAccess) socket.join(`race-premium:${safeId}`);
      if (typeof acknowledge === 'function') {
        acknowledge({ ok: true, premium: access.hasAccess });
      }
    });

    socket.on('unsubscribe:race', (externalId) => {
      const safeId = String(externalId || '').trim().slice(0, 160);
      if (!safeId) return;
      socket.leave(`race-public:${safeId}`);
      socket.leave(`race-premium:${safeId}`);
    });
  });

  console.log('[realtime] socket.io authenticated');
  return io;
}

function broadcastPredictions(externalId, data) {
  if (io) {
    io.to(`race-premium:${externalId}`).emit('predictions:update', {
      race_id: externalId,
      ...data,
    });
  }
}

function broadcastOdds(externalId, odds) {
  if (io) {
    io.to(`race-public:${externalId}`).emit('odds:update', {
      race_id: externalId,
      odds,
    });
  }
}

module.exports = { initRealtime, broadcastPredictions, broadcastOdds };
