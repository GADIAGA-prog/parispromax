const FIRST_PARTY_BROWSER_ORIGINS = Object.freeze([
  'https://parispromax.com',
  'https://www.parispromax.com',
  'https://parispromax-backend.onrender.com',
]);

function browserOriginAllowed(origin, configuredOrigins = []) {
  if (!origin) return true;
  const configured = Array.isArray(configuredOrigins) ? configuredOrigins : [];
  if (configured.length === 0) return true;
  return FIRST_PARTY_BROWSER_ORIGINS.includes(origin) || configured.includes(origin);
}

module.exports = { FIRST_PARTY_BROWSER_ORIGINS, browserOriginAllowed };
