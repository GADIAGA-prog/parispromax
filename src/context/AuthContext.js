import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// PARISPROMAX — Authentication, Free Trial & Subscription context
//
// Business rules:
//  - On first phone login we stamp a "trialStart" timestamp.
//  - The free trial lasts 48h (2 days). While active -> full VIP access.
//  - When the trial expires, the user must subscribe (hasPaid) to keep access.
//  - A Dev Panel can rewind/advance the trialStart timestamp to test layouts.
// ---------------------------------------------------------------------------

const TRIAL_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours

const STORAGE_KEYS = {
  phone: '@ppm_phone',
  trialStart: '@ppm_trial_start',
  hasPaid: '@ppm_has_paid',
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [phone, setPhone] = useState(null);
  const [trialStart, setTrialStart] = useState(null); // ms timestamp
  const [hasPaid, setHasPaid] = useState(false);
  const [loading, setLoading] = useState(true);

  // A ticking "now" so countdowns and lock state stay reactive.
  const [now, setNow] = useState(Date.now());

  // Hydrate persisted state.
  useEffect(() => {
    (async () => {
      try {
        const [storedPhone, storedTrial, storedPaid] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.phone),
          AsyncStorage.getItem(STORAGE_KEYS.trialStart),
          AsyncStorage.getItem(STORAGE_KEYS.hasPaid),
        ]);
        if (storedPhone) setPhone(storedPhone);
        if (storedTrial) setTrialStart(Number(storedTrial));
        if (storedPaid === 'true') setHasPaid(true);
      } catch (e) {
        console.warn('Auth hydrate failed', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Refresh "now" every 30s so the trial banner counts down live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // --- Actions -------------------------------------------------------------

  const login = useCallback(
    async (phoneNumber) => {
      const clean = String(phoneNumber || '').trim();
      setPhone(clean);
      await AsyncStorage.setItem(STORAGE_KEYS.phone, clean);

      // Start the trial only if it has never been started.
      let start = trialStart;
      if (!start) {
        start = Date.now();
        setTrialStart(start);
        await AsyncStorage.setItem(STORAGE_KEYS.trialStart, String(start));
      }
      setNow(Date.now());
      return true;
    },
    [trialStart]
  );

  const logout = useCallback(async () => {
    setPhone(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.phone);
  }, []);

  const subscribe = useCallback(async () => {
    setHasPaid(true);
    await AsyncStorage.setItem(STORAGE_KEYS.hasPaid, 'true');
  }, []);

  // --- Dev Panel helpers ---------------------------------------------------

  const simulateDay1 = useCallback(async () => {
    // Trial just started -> ~48h remaining, active.
    const start = Date.now();
    setTrialStart(start);
    setHasPaid(false);
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.trialStart, String(start)],
      [STORAGE_KEYS.hasPaid, 'false'],
    ]);
    setNow(Date.now());
  }, []);

  const simulateDay3 = useCallback(async () => {
    // Trial started 3 days ago -> expired.
    const start = Date.now() - 72 * 60 * 60 * 1000;
    setTrialStart(start);
    setHasPaid(false);
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.trialStart, String(start)],
      [STORAGE_KEYS.hasPaid, 'false'],
    ]);
    setNow(Date.now());
  }, []);

  // --- Derived values ------------------------------------------------------

  const derived = useMemo(() => {
    const elapsed = trialStart ? now - trialStart : 0;
    const remainingMs = trialStart ? Math.max(0, TRIAL_DURATION_MS - elapsed) : 0;
    const isTrialActive = !!trialStart && remainingMs > 0;
    const hoursRemaining = Math.ceil(remainingMs / (60 * 60 * 1000));
    const daysRemaining = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

    // Full premium access if subscribed OR trial still running.
    const hasAccess = hasPaid || isTrialActive;
    // Hard paywall lockdown when trial expired AND not paid.
    const isLocked = !hasAccess;

    return {
      isTrialActive,
      hoursRemaining,
      daysRemaining,
      remainingMs,
      hasAccess,
      isLocked,
    };
  }, [trialStart, now, hasPaid]);

  const value = useMemo(
    () => ({
      // state
      phone,
      isLoggedIn: !!phone,
      hasPaid,
      trialStart,
      loading,
      now,
      // derived
      ...derived,
      // actions
      login,
      logout,
      subscribe,
      simulateDay1,
      simulateDay3,
    }),
    [phone, hasPaid, trialStart, loading, now, derived, login, logout, subscribe, simulateDay1, simulateDay3]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export default AuthContext;
