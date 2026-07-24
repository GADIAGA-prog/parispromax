const { spawnSync } = require('node:child_process');
const path = require('node:path');

const prismaCli = path.join(
  __dirname,
  '..',
  'node_modules',
  'prisma',
  'build',
  'index.js'
);

const result = spawnSync(
  process.execPath,
  [prismaCli, 'validate', '--schema=prisma/schema.production.prisma'],
  {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://validation:validation@localhost:5432/parispromax',
    },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
