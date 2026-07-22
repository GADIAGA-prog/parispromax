const test = require('node:test');
const assert = require('node:assert/strict');
const { browserOriginAllowed } = require('../src/services/corsOrigins');

test('les trois domaines ParisPromax restent autorisés malgré une variable incomplète', () => {
  const configured = ['https://parispromax.com'];
  assert.equal(browserOriginAllowed('https://parispromax.com', configured), true);
  assert.equal(browserOriginAllowed('https://www.parispromax.com', configured), true);
  assert.equal(browserOriginAllowed('https://parispromax-backend.onrender.com', configured), true);
});

test('une origine tierce reste refusée lorsque la liste de production est définie', () => {
  assert.equal(browserOriginAllowed('https://example.com', ['https://www.parispromax.com']), false);
  assert.equal(browserOriginAllowed(null, ['https://www.parispromax.com']), true);
});
