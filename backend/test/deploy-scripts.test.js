const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');

test('le build de production ne dépend pas de la disponibilité PostgreSQL', () => {
  assert.match(pkg.scripts['build:prod'], /prisma generate/);
  assert.doesNotMatch(pkg.scripts['build:prod'], /prisma db push/);
});

test('la synchronisation PostgreSQL reste une commande explicite et sans perte forcée', () => {
  assert.match(pkg.scripts['db:sync:prod'], /prisma db push/);
  assert.doesNotMatch(pkg.scripts['db:sync:prod'], /accept-data-loss/);
});

test('Render synchronise le schéma avant de basculer le nouveau déploiement', () => {
  const blueprint = fs.readFileSync(path.join(__dirname, '..', '..', 'render.yaml'), 'utf8');
  assert.match(blueprint, /preDeployCommand:\s*npm run db:sync:prod/);
  assert.match(blueprint, /healthCheckPath:\s*\/ready/);
  assert.match(blueprint, /autoDeployTrigger:\s*checksPass/);
});
