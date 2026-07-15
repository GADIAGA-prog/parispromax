const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/jobs/scrape');

test('parseRetryAfter supports seconds and HTTP dates', () => {
  assert.equal(_test.parseRetryAfter('12', 0), 12000);
  assert.equal(_test.parseRetryAfter('Thu, 01 Jan 1970 00:00:20 GMT', 5000), 15000);
  assert.equal(_test.parseRetryAfter('invalid', 0), null);
});

test('retryDelay honors Retry-After', () => {
  const error = { response: { headers: { 'retry-after': '30' } } };
  assert.equal(_test.retryDelay(error, 0, () => 0), 30000);
});

test('retryDelay uses exponential backoff without Retry-After', () => {
  const error = { response: { headers: {} } };
  assert.equal(_test.retryDelay(error, 0, () => 0), 5000);
  assert.equal(_test.retryDelay(error, 2, () => 0), 20000);
});

test('certificate errors are not retried', () => {
  assert.equal(_test.isRetryableNetworkError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }), false);
  assert.equal(_test.isRetryableNetworkError({ code: 'ECONNRESET' }), true);
});
