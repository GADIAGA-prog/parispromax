import countryCatalog from '../../shared/countries.json';

export const COUNTRIES = countryCatalog;
export const DEFAULT_PAYMENT_COUNTRIES = countryCatalog.filter((country) =>
  country.providers.includes('yengapay')
);

export function countryByCode(code, countries = countryCatalog) {
  return countries.find((country) => country.code === String(code || '').toLowerCase()) || null;
}

export function toE164Phone(raw, country) {
  if (!country) return null;
  const dial = String(country.dial || '').replace(/\D/g, '');
  const nationalLength = Number(country.nationalLength);
  let digits = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  if (!digits || !dial || !nationalLength) return null;

  if (digits.startsWith(dial) && digits.length === dial.length + nationalLength) {
    return `+${digits}`;
  }
  while (digits.startsWith(dial) && digits.length > nationalLength) {
    digits = digits.slice(dial.length);
  }
  if (!country.keepLeadingZero && digits.length === nationalLength + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length !== nationalLength) return null;
  return `+${dial}${digits}`;
}

export function countryFlags() {
  return Object.fromEntries(countryCatalog.map((country) => [country.code, country.flag]));
}
