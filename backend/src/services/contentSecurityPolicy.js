const crypto = require('crypto');

function createCspNonce() {
  return crypto.randomBytes(16).toString('base64');
}

function buildContentSecurityPolicy(nonce) {
  return (
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; " +
    "img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    `script-src 'self' 'nonce-${nonce}'`
  );
}

module.exports = { createCspNonce, buildContentSecurityPolicy };
