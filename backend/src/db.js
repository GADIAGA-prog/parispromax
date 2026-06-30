const { PrismaClient } = require('@prisma/client');

// Single shared Prisma client.
const prisma = new PrismaClient();

module.exports = prisma;
