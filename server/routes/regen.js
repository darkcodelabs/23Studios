'use strict';

// regen.js — incremental regen plan + apply routes.
//
// POST /api/projects/:id/regen/plan     -> regen plan from bible diff
// POST /api/projects/:id/regen/apply   body { plan_id?, items? } -> apply plan
// GET  /api/projects/:id/regen/history -> jsonl log entries

const express = require('express');
const regen = require('../services/sdk_incremental_regen');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.message) || 'server_error',
    detail: (e && e.detail) || null
  });
}

router.post('/:id/regen/plan', async (req, res) => {
  try {
    const r = await regen.plan(req.params.id);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/regen/apply', async (req, res) => {
  try {
    const body = req.body || {};
    const r = await regen.apply(req.params.id, body.plan, { items: body.items });
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/regen/history', async (req, res) => {
  try {
    const r = await regen.history(req.params.id);
    res.json({ history: r });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
