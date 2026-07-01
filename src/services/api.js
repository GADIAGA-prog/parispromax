import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// PARISPROMAX — API client (talks to the hosted backend).
//
// Base URL comes from EXPO_PUBLIC_API_URL, defaulting to the Render service.
// Stores the JWT in AsyncStorage and attaches it to authed requests.
// ---------------------------------------------------------------------------

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://parispromax-backend.onrender.com';

const TOKEN_KEY = '@ppm_token';

let cachedToken = null;

export async function getToken() {
  if (cachedToken) return cachedToken;
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

export async function setToken(token) {
  cachedToken = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function clearToken() {
  await setToken(null);
}

// Core request helper. Throws { status, data } on non-2xx.
async function request(path, { method = 'GET', body, auth = false, timeout = 15000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// --- Endpoints -------------------------------------------------------------
export const api = {
  // Auth
  requestOtp: (phone) => request('/auth/request-otp', { method: 'POST', body: { phone } }),
  verifyOtp: (phone, code, country) =>
    request('/auth/verify-otp', { method: 'POST', body: { phone, code, country } }),

  // Profile / access
  me: () => request('/me', { auth: true }),

  // Races
  races: (date) => request(`/races${date ? `?date=${date}` : ''}`),
  raceHistory: () => request('/races/history'),
  raceDetail: (externalId) => request(`/races/${externalId}`),
  prediction: (externalId) => request(`/races/${externalId}/prediction`, { auth: true }),

  // Plans
  plans: () => request('/plans'),

  // Payments
  initiatePayment: (planId, method) =>
    request('/payments/initiate', { method: 'POST', auth: true, body: { planId, method } }),
  paymentStatus: (txn) => request(`/payments/status/${txn}`, { auth: true }),
  myPayments: () => request('/payments/me', { auth: true }),

  // Stats
  successRate: () => request('/stats/success-rate'),
};

export default api;
