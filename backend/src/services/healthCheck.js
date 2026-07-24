function livenessCheck({ revision, now = () => new Date() }) {
  return {
    statusCode: 200,
    body: {
      ok: true,
      service: 'parispromax-backend',
      revision: revision ? revision.slice(0, 7) : null,
      time: now().toISOString(),
    },
  };
}

async function readinessCheck({ prisma, config, getProvider, revision, now = () => new Date() }) {
  const provider = config.payments.provider;
  const mode = config[provider]?.mode || null;
  let configured = false;

  try {
    configured = Boolean(getProvider(provider).isConfigured());
  } catch (_error) {
    // Payment configuration is diagnostic only and must not make the API
    // unavailable when the process and PostgreSQL are healthy.
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    // A database can accept connections while still missing a column from the
    // deployed Prisma schema. Exercise the tables used by signup/login so
    // readiness fails before a broken release receives traffic.
    await prisma.user.findFirst({
      select: {
        id: true,
        phone: true,
        passwordHash: true,
        recoveryCodeHash: true,
        authVersion: true,
      },
    });
    await prisma.recoveryRequest.findFirst({ select: { id: true, status: true } });
    return {
      statusCode: 200,
      body: {
        ok: true,
        service: 'parispromax-backend',
        revision: revision ? revision.slice(0, 7) : null,
        database: 'up',
        schema: 'ready',
        paymentProvider: provider,
        paymentMode: mode,
        payments: configured ? 'configured' : config.allowMock ? 'mock' : 'unavailable',
        time: now().toISOString(),
      },
    };
  } catch (_error) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        service: 'parispromax-backend',
        database: 'down',
        schema: 'unavailable',
        time: now().toISOString(),
      },
    };
  }
}

module.exports = { livenessCheck, readinessCheck };
