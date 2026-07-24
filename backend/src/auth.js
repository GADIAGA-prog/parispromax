const jwt = require('jsonwebtoken');
const config = require('./config');
const prisma = require('./db');
const { safeEqual } = require('./security');

// Sign a JWT for a user.
function signToken(user) {
  return jwt.sign({
    sub: user.id,
    phone: user.phone,
    ver: Number(user.authVersion) || 0,
  }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
  });
}

async function authenticateToken(token) {
  if (!token) throw new Error('missing token');
  const payload = jwt.verify(token, config.jwtSecret);
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, phone: true, authVersion: true },
  });
  if (!user) throw new Error('unknown user');
  if ((Number(payload.ver) || 0) !== (Number(user.authVersion) || 0)) {
    throw new Error('revoked token');
  }
  return { userId: user.id, phone: user.phone, payload };
}

// Express middleware: require a valid, non-revoked Bearer token.
async function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const identity = await authenticateToken(token);
    req.userId = identity.userId;
    req.userPhone = identity.phone;
    return next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// Basic-auth middleware for the admin back-office. Disabled entirely when no
// real ADMIN_PASSWORD is configured on a production DB (default admin/admin
// would otherwise expose payments + phone numbers). Constant-time compares.
function requireAdmin(req, res, next) {
  if (!config.admin.enabled) {
    return res.status(404).send('Not found');
  }
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
    const userOk = safeEqual(user, config.admin.user);
    const passOk = safeEqual(pass, config.admin.password);
    if (userOk && passOk) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="ParisPromax Admin"');
  return res.status(401).send('Authentification requise');
}

module.exports = { signToken, authenticateToken, requireAuth, requireAdmin };
