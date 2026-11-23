const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in .env');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, zoneId: user.zoneId, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

/** Verifies the Authorization: Bearer <token> header and attaches the
 *  decoded user to req.user. This is what makes role checks trustworthy —
 *  every protected route reads req.user.role from a token the SERVER
 *  signed, never a role the frontend claims in the request body. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/** requireRole('SUPER_ADMIN', 'SUPERVISOR') — 403s anyone not in the list.
 *  Always used AFTER requireAuth. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires one of: ${roles.join(', ')}.` });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole };