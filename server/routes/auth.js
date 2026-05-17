'use strict';

const crypto = require('crypto');
const express = require('express');

const { loginLimiter } = require('../middleware/rateLimit');
const { requireAuth, authDisabled, ANON_USER } = require('../middleware/auth');
const { generateCsrfToken } = require('../middleware/csrf');

const router = express.Router();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

router.post('/login', loginLimiter, (req, res) => {
  // Bypass: STUDIO_AUTH_DISABLED makes login a no-op success.
  if (authDisabled()) {
    if (!req.session) req.session = {};
    req.session.user = ANON_USER;
    const csrfToken = generateCsrfToken(req, res);
    return res.json({ ok: true, csrf_token: csrfToken });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const expected = process.env.STUDIO_PASSWORD || '';
  if (expected.length === 0 || !safeEqual(password, expected)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  req.session.user = { id: 'studio', loginAt: Date.now() };
  const csrfToken = generateCsrfToken(req, res);
  return res.json({ ok: true, csrf_token: csrfToken });
});

router.post('/logout', (req, res) => {
  req.session = null;
  return res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (authDisabled()) {
    if (!req.session) req.session = {};
    if (!req.session.user) req.session.user = ANON_USER;
    const csrfToken = generateCsrfToken(req, res);
    return res.json({ authenticated: true, csrf_token: csrfToken, anon: true });
  }
  if (!req.session || !req.session.user) {
    return res.json({ authenticated: false });
  }
  const csrfToken = generateCsrfToken(req, res);
  return res.json({ authenticated: true, csrf_token: csrfToken });
});

router.get('/_protected_ping', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

module.exports = router;
