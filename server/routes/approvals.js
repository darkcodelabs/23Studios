'use strict';

const express = require('express');
const approvals = require('../services/approvals');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = (e && e.status) || fallback;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message
  });
}

// GET /api/projects/:id/approvals/queue
router.get('/projects/:id/approvals/queue', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const out = await approvals.getQueue(req.params.id);
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/approvals/:asset_id/decide  body: { decision }
router.post('/projects/:id/approvals/:asset_id/decide', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const decision = req.body && req.body.decision;
  if (!decision || typeof decision !== 'string') {
    return res.status(400).json({ error: 'bad_request', detail: 'decision required' });
  }
  try {
    const item = await approvals.decide(req.params.id, req.params.asset_id, decision);
    res.json({ item });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
