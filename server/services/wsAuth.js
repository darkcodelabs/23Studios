'use strict';

const cookieSession = require('cookie-session');

const SESSION_NAME = 'studio_sess';
const SESSION_SECRET = process.env.SESSION_SECRET;
const NODE_ENV = process.env.NODE_ENV || 'development';

const middleware = cookieSession({
  name: SESSION_NAME,
  keys: [SESSION_SECRET],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'strict',
  secure: NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'
});

function getSession(req) {
  return new Promise((resolve) => {
    const fakeRes = {
      _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      getHeader(k) { return this._headers[k]; },
      removeHeader(k) { delete this._headers[k]; },
      end() {},
      on() {},
      once() {},
      emit() {}
    };
    try {
      middleware(req, fakeRes, () => resolve(req.session || null));
    } catch (_e) {
      resolve(null);
    }
  });
}

async function isAuthenticated(req) {
  const sess = await getSession(req);
  return !!(sess && sess.user);
}

module.exports = { getSession, isAuthenticated };
