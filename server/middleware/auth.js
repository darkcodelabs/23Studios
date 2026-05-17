'use strict';

// AUTH MODEL
// The studio binds to 127.0.0.1 and is fronted by code-server / Caddy /
// Cloudflare tunnel — every reachable client has already passed an upstream
// auth gate. The studio's password layer is a redundant second factor that
// gets in the way more than it protects, so it's optional now:
//   STUDIO_AUTH_DISABLED=true  -> requireAuth always passes; an anonymous
//                                 session is materialized so CSRF + per-user
//                                 state still work.
//   STUDIO_AUTH_DISABLED unset/false -> classic password gate.

const ANON_USER = { id: 'anon', loginAt: 0 };

function authDisabled() {
  const v = process.env.STUDIO_AUTH_DISABLED;
  return v === '1' || v === 'true' || v === 'yes';
}

function requireAuth(req, res, next) {
  if (authDisabled()) {
    if (!req.session) req.session = {};
    if (!req.session.user) req.session.user = ANON_USER;
    return next();
  }
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

module.exports = { requireAuth, authDisabled, ANON_USER };
