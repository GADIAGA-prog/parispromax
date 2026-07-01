import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { getToken, setToken, clearToken } from '../services/api';

// ---------------------------------------------------------------------------
// PARISPROMAX — Auth context backed by the hosted backend.
//
//  - Login = phone -> OTP code -> JWT (stored).
//  - Access state (trial / paid) comes from the backend /me endpoint and is
//    cached locally so the paywall still resolves while briefly offline.
// ---------------------------------------------------------------------------

const ACCESS_CACHE = '@ppm_access_cache';
const PHONE_KEY = '@ppm_phone';

const defaultAccess = {
  hasAccess: false,
  hasPaid: false,
  plan: null,
  paidUntil: null,
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [phone, setPhone] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [access, setAccess] = useState(defaultAccess);
  const [loading, setLoading] = useState(true);

  // Hydrate token + cached access on boot.
  useEffect(() => {
    (async () => {
      try {
        const [token, storedPhone, cached] = await Promise.all([
          getToken(),
          AsyncStorage.getItem(PHONE_KEY),
          AsyncStorage.getItem(ACCESS_CACHE),
        ]);
        if (storedPhone) setPhone(storedPhone);
        if (cached) setAccess({ ...defaultAccess, ...JSON.parse(cached) });
        if (token) {
          setIsLoggedIn(true);
          await refreshAccess(); // get fresh state
        }
      } catch (e) {
        // ignore — stay logged out
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAccess = useCallback(async () => {
    try {
      const data = await api.me();
      const a = { ...defaultAccess, ...data.access };
      setAccess(a);
      setIsLoggedIn(true);
      if (data.user?.phone) setPhone(data.user.phone);
      await AsyncStorage.setItem(ACCESS_CACHE, JSON.stringify(a));
      return a;
    } catch (e) {
      if (e.status === 401) {
        await doLogout();
      }
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 1: request an OTP for a phone number. Returns { devCode? }.
  const requestOtp = useCallback(async (phoneNumber) => {
    const clean = String(phoneNumber || '').replace(/[^\d+]/g, '');
    const res = await api.requestOtp(clean);
    return res; // { ok, ttlMinutes, devCode? }
  }, []);

  // Step 2: verify the OTP -> store token, load access.
  const verifyOtp = useCallback(
    async (phoneNumber, code, country) => {
      const clean = String(phoneNumber || '').replace(/[^\d+]/g, '');
      const res = await api.verifyOtp(clean, code, country);
      await setToken(res.token);
      setPhone(res.user.phone);
      await AsyncStorage.setItem(PHONE_KEY, res.user.phone);
      setIsLoggedIn(true);
      await refreshAccess();
      return res.user;
    },
    [refreshAccess]
  );

  const doLogout = useCallback(async () => {
    await clearToken();
    await AsyncStorage.removeItem(ACCESS_CACHE);
    setIsLoggedIn(false);
    setAccess(defaultAccess);
  }, []);

  const value = useMemo(
    () => ({
      // identity
      phone,
      isLoggedIn,
      loading,
      // access
      hasPaid: access.hasPaid,
      hasAccess: access.hasAccess,
      isLocked: !access.hasAccess,
      plan: access.plan,
      paidUntil: access.paidUntil,
      // actions
      requestOtp,
      verifyOtp,
      refreshAccess,
      logout: doLogout,
    }),
    [phone, isLoggedIn, loading, access, requestOtp, verifyOtp, refreshAccess, doLogout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export default AuthContext;
