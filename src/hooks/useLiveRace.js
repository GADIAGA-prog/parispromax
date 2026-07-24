import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, getToken } from '../services/api';

// The socket is authenticated with the same encrypted token as REST requests.
// A changed token creates a fresh connection so a logout/login can never reuse
// another member's rooms.
let socket = null;
let socketToken = null;

async function getSocket() {
  const token = await getToken();
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  if (socket) socket.disconnect();

  socketToken = token;
  socket = io(API_URL, {
    transports: ['websocket'],
    autoConnect: true,
    auth: { token },
  });
  return socket;
}

export function useLiveRace(externalId) {
  const [predictions, setPredictions] = useState(null);
  const [odds, setOdds] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!externalId) return undefined;
    let active = true;
    let activeSocket = null;

    const onConnect = () => {
      if (!active || !activeSocket) return;
      setConnected(true);
      activeSocket.emit('subscribe:race', externalId);
    };
    const onDisconnect = () => active && setConnected(false);
    const onPredictions = (message) => {
      if (active && message?.race_id === externalId) {
        setPredictions(message.predictions || message);
      }
    };
    const onOdds = (message) => {
      if (active && message?.race_id === externalId) {
        setOdds(message.odds || message);
      }
    };

    getSocket().then((instance) => {
      if (!active || !instance) return;
      activeSocket = instance;
      instance.on('connect', onConnect);
      instance.on('disconnect', onDisconnect);
      instance.on('predictions:update', onPredictions);
      instance.on('odds:update', onOdds);
      if (instance.connected) onConnect();
    });

    return () => {
      active = false;
      if (!activeSocket) return;
      activeSocket.emit('unsubscribe:race', externalId);
      activeSocket.off('connect', onConnect);
      activeSocket.off('disconnect', onDisconnect);
      activeSocket.off('predictions:update', onPredictions);
      activeSocket.off('odds:update', onOdds);
    };
  }, [externalId]);

  return { predictions, odds, connected };
}

export default useLiveRace;
