const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function loadProductionConfig(adminPassword) {
  return spawnSync(
    process.execPath,
    [
      '-e',
      "const config = require('./src/config'); process.stdout.write(JSON.stringify({ enabled: config.admin.enabled }));",
    ],
    {
      cwd: require('node:path').resolve(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/parispromax',
        JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
        OTP_DEV_MODE: 'false',
        ADMIN_PASSWORD: adminPassword,
      },
    }
  );
}

function readConfigResult(result) {
  const lastLine = result.stdout.trim().split(/\r?\n/).at(-1);
  return JSON.parse(lastLine);
}

test('un mot de passe admin faible desactive le back-office sans arreter API', () => {
  const result = loadProductionConfig('trop-court');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readConfigResult(result), { enabled: false });
  assert.match(result.stderr, /back-office \/admin est DESACTIVE/);
});

test('un mot de passe admin robuste active le back-office en production', () => {
  const result = loadProductionConfig('mot-de-passe-fort-de-test');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readConfigResult(result), { enabled: true });
});
