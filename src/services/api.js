import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// ---------------------------------------------------------------------------
// PARISPROMAX — API client (talks to the hosted backend).
//
// Base URL comes from EXPO_PUBLIC_API_URL, defaulting to the Render service.
// Stores the JWT in the native encrypted keychain/keystore and attaches it to
// authenticated requests. AsyncStorage is used only as a one-time migration
// source for users who installed an older version of the application.
// ---------------------------------------------------------------------------

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://parispromax-backend.onrender.com';

const TOKEN_KEY = '@ppm_token';

let cachedToken = null;

export async function getToken() {
  if (cachedToken) return cachedToken;
  const secureStoreAvailable = await SecureStore.isAvailableAsync();
  if (secureStoreAvailable) {
    cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!cachedToken) {
      const legacyToken = await AsyncStorage.getItem(TOKEN_KEY);
      if (legacyToken) {
        await SecureStore.setItemAsync(TOKEN_KEY, legacyToken);
        await AsyncStorage.removeItem(TOKEN_KEY);
        cachedToken = legacyToken;
      }
    }
  } else {
    cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  }
  return cachedToken;
}

export async function setToken(token) {
  cachedToken = token;
  const secureStoreAvailable = await SecureStore.isAvailableAsync();
  if (secureStoreAvailable) {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
    await AsyncStorage.removeItem(TOKEN_KEY);
  } else if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
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
  // Auth (identity + password; sensitive recovery fields stay server-side).
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (phone, password, country) =>
    request('/auth/login', { method: 'POST', body: { phone, password, country } }),
  // Réinitialisation autonome : numéro + code de récupération -> nouveau mdp.
  resetPassword: (phone, recoveryCode, newPassword) =>
    request('/auth/reset-password', { method: 'POST', body: { phone, recoveryCode, newPassword } }),
  recoveryQuestions: () => request('/auth/recovery-questions'),
  recoveryQuestion: (phone) =>
    request('/auth/recovery-question', { method: 'POST', body: { phone } }),
  resetPasswordSecurity: (phone, birthDate, answer, newPassword) =>
    request('/auth/reset-password-security', {
      method: 'POST',
      body: { phone, birthDate, answer, newPassword },
    }),
  requestRecoverySupport: (payload) =>
    request('/auth/recovery-request', { method: 'POST', body: payload }),
  newRecoveryCode: () => request('/me/recovery-code', { method: 'POST', auth: true }),
  // Legacy OTP (conservé côté backend, plus utilisé par l'app)
  requestOtp: (phone) => request('/auth/request-otp', { method: 'POST', body: { phone } }),
  verifyOtp: (phone, code, country) =>
    request('/auth/verify-otp', { method: 'POST', body: { phone, code, country } }),

  // Profile / access
  me: () => request('/me', { auth: true }),
  deleteAccount: () => request('/me', { method: 'DELETE', auth: true }),

  // Portefeuille de suivi des jeux (aucun argent n'est détenu dans l'app).
  wallet: () => request('/wallet', { auth: true }),
  addWalletEntry: (entry) => request('/wallet', { method: 'POST', auth: true, body: entry }),
  updateWalletEntry: (id, entry) => request(`/wallet/${id}`, { method: 'PUT', auth: true, body: entry }),
  deleteWalletEntry: (id) => request(`/wallet/${id}`, { method: 'DELETE', auth: true }),

  // Races
  races: (date) => request(`/races${date ? `?date=${date}` : ''}`),
  // Course PMU du jour du pays (Quarté LONAB…) + journal national.
  nationalRace: (country) => request(`/races/national?country=${encodeURIComponent(country || '')}`),
  raceHistory: () => request('/races/history'),
  raceDetail: (externalId) => request(`/races/${externalId}`),
  prediction: (externalId) => request(`/races/${externalId}/prediction`, { auth: true }),

  // Plans
  plans: () => request('/plans'),

  // Payments
  paymentCountries: () => request('/payments/countries'),
  paymentProviders: (country) =>
    request(`/payments/providers${country ? `?country=${encodeURIComponent(country)}` : ''}`),
  initiatePayment: (planId, provider) =>
    request('/payments/initiate', { method: 'POST', auth: true, body: { planId, provider } }),
  paymentStatus: (txn) => request(`/payments/status/${txn}`, { auth: true }),
  myPayments: () => request('/payments/me', { auth: true }),
  // FeexPay — mobile money (paiement direct : confirmation sur le téléphone).
  feexpayOperators: (country) =>
    request(`/payments/feexpay/operators?country=${encodeURIComponent(country || '')}`),
  feexpayMobile: ({ planId, phone, network, country, otp }) =>
    request('/payments/feexpay/mobile', {
      method: 'POST',
      auth: true,
      body: { planId, phone, network, country, otp },
    }),
  // YengaPay — direct Mobile Money (Orange OTP / Moov validation on phone).
  yengapayOperators: (country) =>
    request(`/payments/yengapay/operators?country=${encodeURIComponent(country || '')}`),
  yengapayMobile: ({ planId, phone, operator, country, otp, transactionId }) =>
    request('/payments/yengapay/mobile', {
      method: 'POST',
      auth: true,
      body: { planId, phone, operator, country, otp, transactionId },
    }),

  // Stats
  successRate: () => request('/stats/success-rate'),
};

export default api;
