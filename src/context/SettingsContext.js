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
// PARISPROMAX — App settings: currency (multi-country Africa) + onboarding flag.
// ---------------------------------------------------------------------------

// Monthly VIP price expressed per currency (approximate, locally tuned).
export const CURRENCIES = {
  XOF: { code: 'XOF', label: 'Franc CFA (UEMOA)', symbol: 'XOF', price: 5000, countries: 'CI · SN · ML · BF · BJ · TG' },
  XAF: { code: 'XAF', label: 'Franc CFA (CEMAC)', symbol: 'XAF', price: 5000, countries: 'CM · GA · CG · TD' },
  GHS: { code: 'GHS', label: 'Cedi ghanéen', symbol: '₵', price: 60, countries: 'Ghana' },
  NGN: { code: 'NGN', label: 'Naira nigérian', symbol: '₦', price: 7000, countries: 'Nigeria' },
};

const KEYS = {
  currency: '@ppm_currency',
  onboarded: '@ppm_onboarded',
};

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [currencyCode, setCurrencyCode] = useState('XOF');
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [c, o] = await Promise.all([
          AsyncStorage.getItem(KEYS.currency),
          AsyncStorage.getItem(KEYS.onboarded),
        ]);
        if (c && CURRENCIES[c]) setCurrencyCode(c);
        if (o === 'true') setOnboarded(true);
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setCurrency = useCallback(async (code) => {
    if (!CURRENCIES[code]) return;
    setCurrencyCode(code);
    await AsyncStorage.setItem(KEYS.currency, code);
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboarded(true);
    await AsyncStorage.setItem(KEYS.onboarded, 'true');
  }, []);

  const currency = CURRENCIES[currencyCode] || CURRENCIES.XOF;

  // Format an amount expressed in the *base* (XOF) into the active currency.
  // For simplicity we display the per-currency price directly; arbitrary
  // amounts are shown with the active symbol.
  const formatPrice = useCallback(
    () => `${currency.price.toLocaleString('fr-FR')} ${currency.symbol}`,
    [currency]
  );

  const value = useMemo(
    () => ({
      loading,
      currency,
      currencyCode,
      currencies: CURRENCIES,
      onboarded,
      setCurrency,
      completeOnboarding,
      formatPrice,
    }),
    [loading, currency, currencyCode, onboarded, setCurrency, completeOnboarding, formatPrice]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}

export default SettingsContext;
