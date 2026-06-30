const jwt = require('jsonwebtoken');
const config = require('./config');

// Sign a JWT for a user.
function signToken(user) {
  return jwt.sign({ sub: user.id, phone: user.phone }, config.jwtSecret, {
    expiresIn: '30d',
  });
}

// Express middleware: require a valid Bearer token. Attaches req.userId.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.sub;
    req.userPhone = payload.phone;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// Basic-auth middleware for the admin back-office.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    if (user === config.admin.user && pass === config.admin.password) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="ParisPromax Admin"');
  return res.status(401).send('Authentification requise');
}

module.exports = { signToken, requireAuth, requireAdmin };
