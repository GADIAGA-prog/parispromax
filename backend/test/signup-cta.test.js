const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test("la page d'accueil propose un bouton principal de création de compte", () => {
  const heroActions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)?.[1] || '';

  assert.match(heroActions, /data-open-auth="register"/);
  assert.match(heroActions, />Créer un compte\b/);
});

test('le menu mobile permet aussi de créer un compte', () => {
  const mobileNavigation = html.match(/<nav class="mobile-nav[\s\S]*?<\/nav>/)?.[0] || '';

  assert.match(mobileNavigation, /class="mobile-signup-cta"/);
  assert.match(mobileNavigation, /data-open-auth="register"/);
  assert.match(mobileNavigation, /data-open-auth="login"/);
});
