'use strict';

const { doubleCsrf } = require('csrf-csrf');

const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET;

const {
  doubleCsrfProtection,
  generateToken,
  invalidCsrfTokenError
} = doubleCsrf({
  getSecret: () => SESSION_SECRET,
  cookieName: NODE_ENV === 'production' ? '__Host-studio_csrf' : 'studio_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: '/'
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.headers['x-csrf-token']
});

function csrfErrorHandler(err, _req, res, next) {
  if (err === invalidCsrfTokenError) {
    return res.status(403).json({ error: 'invalid_csrf' });
  }
  return next(err);
}

module.exports = {
  csrfProtection: doubleCsrfProtection,
  generateCsrfToken: generateToken,
  csrfErrorHandler
};
