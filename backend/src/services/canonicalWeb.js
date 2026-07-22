const DEFAULT_WEB_BASE_URL = 'https://www.parispromax.com';
const TECHNICAL_RENDER_HOST = 'parispromax-backend.onrender.com';
const APEX_WEB_HOST = 'parispromax.com';

function normalizeWebBaseUrl(raw) {
  try {
    const url = new URL(String(raw || DEFAULT_WEB_BASE_URL));
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return `${DEFAULT_WEB_BASE_URL}/`;
  }
}

function canonicalRedirectTarget(hostname, configuredWebBaseUrl) {
  const host = String(hostname || '').trim().toLowerCase();
  if (host !== TECHNICAL_RENDER_HOST && host !== APEX_WEB_HOST) return null;
  return normalizeWebBaseUrl(configuredWebBaseUrl);
}

module.exports = {
  DEFAULT_WEB_BASE_URL,
  TECHNICAL_RENDER_HOST,
  APEX_WEB_HOST,
  normalizeWebBaseUrl,
  canonicalRedirectTarget,
};
