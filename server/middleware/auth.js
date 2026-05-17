'use strict';

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

module.exports = { requireAuth };
