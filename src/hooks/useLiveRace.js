import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../services/api';

// ---------------------------------------------------------------------------
// MODULE 3 — Temps réel côté Expo.
//
// S'abonne à une course et reçoit en PUSH (sans rafraîchir) :
//   - les changements de cotes ('odds:update'),
//   - les nouveaux pronostics IA ('predictions:update').
// La connexion socket est partagée (singleton) pour toute l'app.
// ---------------------------------------------------------------------------

let socket = null;
function getSocket() {
  if (!socket) {
    socket = io(API_URL, { transports: ['websocket'], autoConnect: true });
  }
  return socket;
}

// Retourne { predictions, odds, connected } pour une course donnée.
export function useLiveRace(externalId) {
  const [predictions, setPredictions] = useState(null);
  const [odds, setOdds] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!externalId) return undefined;
    const s = getSocket();

    const onConnect = () => {
      setConnected(true);
      s.emit('subscribe:race', externalId);
    };
    const onPred = (msg) => {
      if (msg && msg.race_id === externalId) setPredictions(msg.predictions || msg);
    };
    const onOdds = (msg) => {
      if (msg && msg.race_id === externalId) setOdds(msg.odds || msg);
    };

    s.on('connect', onConnect);
    s.on('disconnect', () => setConnected(false));
    s.on('predictions:update', onPred);
    s.on('odds:update', onOdds);
    if (s.connected) onConnect();

    return () => {
      s.emit('unsubscribe:race', externalId);
      s.off('connect', onConnect);
      s.off('predictions:update', onPred);
      s.off('odds:update', onOdds);
    };
  }, [externalId]);

  return { predictions, odds, connected };
}

export default useLiveRace;
