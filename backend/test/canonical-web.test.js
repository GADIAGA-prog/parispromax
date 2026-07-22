const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalRedirectTarget,
  normalizeWebBaseUrl,
} = require('../src/services/canonicalWeb');

test('redirige les anciennes adresses vers le site public www', () => {
  assert.equal(
    canonicalRedirectTarget('parispromax-backend.onrender.com', 'https://www.parispromax.com'),
    'https://www.parispromax.com/'
  );
  assert.equal(
    canonicalRedirectTarget('parispromax.com', 'https://www.parispromax.com'),
    'https://www.parispromax.com/'
  );
  assert.equal(canonicalRedirectTarget('www.parispromax.com', 'https://www.parispromax.com'), null);
  assert.equal(canonicalRedirectTarget('example.com', 'https://www.parispromax.com'), null);
});

test('refuse une destination non HTTPS et revient au domaine officiel', () => {
  assert.equal(normalizeWebBaseUrl('http://example.test'), 'https://www.parispromax.com/');
  assert.equal(normalizeWebBaseUrl('not a url'), 'https://www.parispromax.com/');
});
