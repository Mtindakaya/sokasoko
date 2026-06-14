const { getString } = require('@lykmapipo/env');

const requireAdminKey = (req, res, next) => {
  const secret = getString('ADMIN_SECRET', '');
  const provided = req.headers['x-admin-key'];

  if (!secret) {
    console.error('[adminAuth] ADMIN_SECRET env var is not set');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (!provided || provided !== secret) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

module.exports = { requireAdminKey };
