// MODULE 3 — Temps réel (WebSocket via socket.io).
//
// Le mobile s'abonne à une course (room) et reçoit en push :
//   - 'odds:update'        (changement de cotes)
//   - 'predictions:update' (nouveaux pronostics IA)
// sans rafraîchir manuellement l'écran.

let io = null;

function initRealtime(httpServer) {
  const { Server } = require('socket.io');
  io = new Server(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    // Le client ne reçoit que les updates des courses auxquelles il s'abonne.
    socket.on('subscribe:race', (externalId) => {
      if (externalId) socket.join(`race:${externalId}`);
    });
    socket.on('unsubscribe:race', (externalId) => {
      if (externalId) socket.leave(`race:${externalId}`);
    });
  });

  console.log('[realtime] socket.io initialised');
  return io;
}

function broadcastPredictions(externalId, data) {
  if (io) io.to(`race:${externalId}`).emit('predictions:update', { race_id: externalId, ...data });
}

function broadcastOdds(externalId, odds) {
  if (io) io.to(`race:${externalId}`).emit('odds:update', { race_id: externalId, odds });
}

module.exports = { initRealtime, broadcastPredictions, broadcastOdds };
