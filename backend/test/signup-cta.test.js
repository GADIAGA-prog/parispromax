const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test("l'accueil priorise les courses et abonnements tout en gardant la création de compte visible", () => {
  const heroActions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)?.[1] || '';
  const headerActions = html.match(/<div class="header-actions">([\s\S]*?)<\/div>/)?.[1] || '';

  assert.match(heroActions, /href="#courses-du-jour">Voir les courses et pronostics/);
  assert.match(heroActions, /href="#abonnements">Voir les abonnements/);
  assert.doesNotMatch(heroActions, /data-open-auth="register"/);
  assert.match(headerActions, /data-open-auth="register"/);
  assert.match(headerActions, />Créer un compte\b/);
});

test('le menu mobile permet aussi de créer un compte', () => {
  const mobileNavigation = html.match(/<nav class="mobile-nav[\s\S]*?<\/nav>/)?.[0] || '';

  assert.match(mobileNavigation, /class="mobile-signup-cta"/);
  assert.match(mobileNavigation, /data-open-auth="register"/);
  assert.match(mobileNavigation, /data-open-auth="login"/);
});
