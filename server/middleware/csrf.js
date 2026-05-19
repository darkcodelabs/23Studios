'use strict';

const { doubleCsrf } = require('csrf-csrf');

const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET;

// `__Host-` prefix REQUIRES Secure=true. When the studio runs behind a
// TLS-terminating tunnel (CF Access -> cloudflared -> :8090) the server
// itself speaks HTTP, so we have to ship the cookie without Secure
// (COOKIE_SECURE=false). Tie the prefix to the actual Secure value, not
// to NODE_ENV — otherwise the browser silently rejects the cookie and
// every POST returns 403 invalid_csrf.
const COOKIE_SECURE = NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';

const {
  doubleCsrfProtection,
  generateToken,
  invalidCsrfTokenError
} = doubleCsrf({
  getSecret: () => SESSION_SECRET,
  cookieName: COOKIE_SECURE ? '__Host-studio_csrf' : 'studio_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
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
