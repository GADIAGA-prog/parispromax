const { countryCatalog } = require('./paymentCountries');

function countryByCode(rawCode) {
  const code = String(rawCode || '').trim().toLowerCase();
  return countryCatalog.find((country) => country.code === code) || null;
}

function internationalPhone(raw, rawCountry) {
  const source = String(raw || '').trim();
  let digits = source.replace(/\D/g, '');
  if (!digits) return null;

  if (source.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;

  const country = countryByCode(rawCountry);
  if (!country) {
    const exactInternational = countryCatalog.some((candidate) => {
      const dial = String(candidate.dial || '').replace(/\D/g, '');
      return (
        dial &&
        digits.startsWith(dial) &&
        digits.length === dial.length + Number(candidate.nationalLength)
      );
    });
    return exactInternational ? `+${digits}` : digits;
  }

  const dial = String(country.dial || '').replace(/\D/g, '');
  const nationalLength = Number(country.nationalLength);
  if (!dial || !Number.isFinite(nationalLength)) return null;

  if (digits.startsWith(dial) && digits.length === dial.length + nationalLength) {
    return `+${digits}`;
  }
  if (!country.keepLeadingZero && digits.length === nationalLength + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length !== nationalLength) return null;
  return `+${dial}${digits}`;
}

module.exports = { internationalPhone };
