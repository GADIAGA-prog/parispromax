const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCspNonce,
  buildContentSecurityPolicy,
} = require('../src/services/contentSecurityPolicy');

test('la CSP autorise le script admin uniquement avec un nonce imprévisible', () => {
  const firstNonce = createCspNonce();
  const secondNonce = createCspNonce();
  const policy = buildContentSecurityPolicy(firstNonce);

  assert.match(firstNonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(firstNonce, secondNonce);
  assert.ok(policy.includes(`script-src 'self' 'nonce-${firstNonce}'`));
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
});

test('le tableau admin produit un script exécutable avec le nonce de la réponse', async () => {
  const vm = require('node:vm');
  const router = require('../src/routes/admin');
  const dashboardLayer = router.stack.find((layer) => layer.route?.path === '/');
  const handler = dashboardLayer.route.stack[0].handle;
  const nonce = createCspNonce();
  let body = '';
  const response = {
    locals: { cspNonce: nonce },
    set() {
      return this;
    },
    type() {
      return this;
    },
    send(value) {
      body = value;
      return this;
    },
  };

  await handler({}, response);

  const openingTag = `<script nonce="${nonce}">`;
  const scriptStart = body.indexOf(openingTag);
  const scriptEnd = body.indexOf('</script>', scriptStart);
  assert.notEqual(scriptStart, -1);
  assert.notEqual(scriptEnd, -1);
  assert.doesNotMatch(body, /\son(?:click|change)=/);
  assert.doesNotThrow(
    () => new vm.Script(body.slice(scriptStart + openingTag.length, scriptEnd))
  );
});
