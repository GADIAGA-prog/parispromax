import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './api';

// ---------------------------------------------------------------------------
// PARISPROMAX — Data service with OFFLINE-FIRST strategy.
//
// Strategy (optimized for slow / unreliable African networks):
//   1. Try to fetch fresh races from the remote scraper endpoint (short timeout).
//   2. On success -> cache the JSON locally and return it.
//   3. If there is no verified cache, return an empty program. Demo races must
//      never be presented as live data.
// ---------------------------------------------------------------------------

const CACHE_KEY = '@ppm_races_cache';
// Live races come from the hosted backend (/races/full). Overridable via env.
const REMOTE_URL = process.env.EXPO_PUBLIC_RACES_URL || `${API_URL}/races/full`;
const FETCH_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

function isValidPayload(data) {
  return (
    data &&
    Array.isArray(data.racetracks) &&
    data.racetracks.length > 0 &&
    data.racetracks.every((t) => Array.isArray(t.races))
  );
}

// Returns { data, source: 'remote' | 'cache' | 'empty', offline: boolean }
export async function loadRaces() {
  // 1. Attempt remote fetch (only if configured).
  if (REMOTE_URL) {
    try {
      const res = await withTimeout(fetch(REMOTE_URL), FETCH_TIMEOUT_MS);
      if (res.ok) {
        const json = await res.json();
        if (isValidPayload(json)) {
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(json));
          return { data: json, source: 'remote', offline: false };
        }
      }
    } catch (e) {
      // swallow -> graceful fallback below
    }
  }

  // 2. Fall back to last cached payload.
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) {
      const json = JSON.parse(cached);
      if (isValidPayload(json)) {
        return { data: json, source: 'cache', offline: true };
      }
    }
  } catch (e) {
    // ignore corrupt cache
  }

  // 3. No verified data: show an honest empty state.
  return {
    data: { meta: { generatedAt: null, source: 'offline-empty' }, racetracks: [], history: [] },
    source: 'empty',
    offline: true,
  };
}

// Kept for backward compatibility with older app startup code.
export async function ensureSeedCached() {
  return undefined;
}

// Real measured rate only — return null when unknown so the UI never shows a
// fabricated success percentage.
export function getSuccessRate(data) {
  return data?.meta?.successRateQuinte ?? null;
}

export function getHistory(data) {
  return Array.isArray(data?.history) ? data.history : [];
}

export default { loadRaces, ensureSeedCached, getSuccessRate, getHistory };
