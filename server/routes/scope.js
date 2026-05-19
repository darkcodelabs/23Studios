'use strict';

// Phase 6 A6 — Scope Lock routes.

const express = require('express');

const scopeLock = require('../services/scope_lock');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message,
    extra: (e && e.detail) || undefined
  });
}
function preflightId(req, res) {
  const err = validateId(req.params.id);
  if (err) { res.status(400).json({ error: 'bad_request', detail: err }); return false; }
  return true;
}

// GET /api/projects/:id/scope/proposal
//   returns the candidate-derived proposal (cost + counts) for the UI to render.
router.get('/:id/scope/proposal', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const proposal = await scopeLock.proposeScope(req.params.id);
    res.json({ ok: true, proposal });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/scope            -> latest locked snapshot (or null)
// GET /api/projects/:id/scope?version=N  -> specific lock snapshot
router.get('/:id/scope', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const v = req.query.version == null ? null : req.query.version;
    const snap = await scopeLock.getScope(req.params.id, v);
    if (!snap) return res.status(404).json({ error: 'no_scope' });
    res.json({ ok: true, scope: snap });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/scope/history    -> list of all locks
router.get('/:id/scope/history', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const list = await scopeLock.listScopes(req.params.id);
    res.json({ ok: true, scopes: list });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/scope/lock
//   body: { include_ids: [], defer_ids: [], budget_usd?, notes? }
router.post('/:id/scope/lock', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const snap = await scopeLock.lockScope(req.params.id, req.body || {});
    res.status(200).json({ ok: true, scope: snap });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
