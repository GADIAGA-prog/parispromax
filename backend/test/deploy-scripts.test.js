const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('le build de production ne dépend pas de la disponibilité PostgreSQL', () => {
  assert.match(pkg.scripts['build:prod'], /prisma generate/);
  assert.doesNotMatch(pkg.scripts['build:prod'], /prisma db push/);
});

test('la synchronisation PostgreSQL reste une commande explicite et sans perte forcée', () => {
  assert.match(pkg.scripts['db:sync:prod'], /prisma db push/);
  assert.doesNotMatch(pkg.scripts['db:sync:prod'], /accept-data-loss/);
});
