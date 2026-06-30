/* eslint-disable no-console */
// Generates prisma/schema.production.prisma from the dev schema by switching
// the datasource provider sqlite -> postgresql. Single source of truth (the
// dev schema), zero drift. Run automatically by `npm run build:prod`.
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../prisma/schema.prisma');
const OUT = path.resolve(__dirname, '../prisma/schema.production.prisma');

let schema = fs.readFileSync(SRC, 'utf8');
schema = schema.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');

const banner = '// AUTO-GENERATED from schema.prisma by scripts/gen-prod-schema.js — do not edit.\n\n';
fs.writeFileSync(OUT, banner + schema, 'utf8');
console.log('[gen-prod-schema] wrote prisma/schema.production.prisma (postgresql)');
