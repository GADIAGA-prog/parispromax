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
//  - Login = phone + password -> JWT (stored).
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
  const [country, setCountry] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [access, setAccess] = useState(defaultAccess);
  const [referral, setReferral] = useState(null);
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
      setReferral(data.referral || null);
      setIsLoggedIn(true);
      if (data.user?.phone) setPhone(data.user.phone);
      if (data.user?.country) setCountry(data.user.country);
      if (data.user) setProfile(data.user);
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

  // Finalise une authentification réussie (register OU login).
  const completeAuth = useCallback(
    async (res) => {
      await setToken(res.token);
      setPhone(res.user.phone);
      setProfile(res.user);
      if (res.user.country) setCountry(res.user.country);
      await AsyncStorage.setItem(PHONE_KEY, res.user.phone);
      setIsLoggedIn(true);
      await refreshAccess();
      return res.user;
    },
    [refreshAccess]
  );

  // Connexion : numéro + mot de passe.
  const login = useCallback(
    async (phoneNumber, password, country) => {
      const clean = String(phoneNumber || '').replace(/[^\d+]/g, '');
      return completeAuth(await api.login(clean, password, country));
    },
    [completeAuth]
  );

  // Adopte une session déjà obtenue (register / reset-password) : l'écran de
  // login affiche d'abord le code de récupération, PUIS adopte la session
  // (sinon la navigation bascule avant que l'utilisateur ait noté son code).
  const adoptSession = useCallback((res) => completeAuth(res), [completeAuth]);

  const doLogout = useCallback(async () => {
    await clearToken();
    await AsyncStorage.multiRemove([ACCESS_CACHE, PHONE_KEY]);
    setPhone(null);
    setCountry(null);
    setProfile(null);
    setIsLoggedIn(false);
    setAccess(defaultAccess);
    setReferral(null);
  }, []);

  const value = useMemo(
    () => ({
      // identity
      phone,
      country,
      profile,
      isLoggedIn,
      loading,
      // access
      hasPaid: access.hasPaid,
      hasAccess: access.hasAccess,
      isLocked: !access.hasAccess,
      plan: access.plan,
      paidUntil: access.paidUntil,
      referral,
      // actions
      login,
      adoptSession,
      refreshAccess,
      logout: doLogout,
    }),
    [phone, country, profile, isLoggedIn, loading, access, referral, login, adoptSession, refreshAccess, doLogout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export default AuthContext;
