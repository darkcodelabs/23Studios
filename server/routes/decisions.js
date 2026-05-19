'use strict';

// Decision log routes (Phase 6 C2).

const express = require('express');
const decisionLog = require('../services/decision_log');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e) {
  const status = e && e.status ? e.status : 500;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message
  });
}

// GET /api/projects/:id/decisions?decided_by=&category=&from=&to=
router.get('/projects/:id/decisions', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const out = await decisionLog.readDecisions(req.params.id, {
      decided_by: req.query.decided_by,
      category: req.query.category,
      from: req.query.from,
      to: req.query.to
    });
    res.json({ project_id: req.params.id, ...out });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/decisions — append one entry
router.post('/projects/:id/decisions', express.json({ limit: '64kb' }), async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const entry = await decisionLog.logDecision(req.params.id, req.body || {});
    res.status(201).json({ entry });
  } catch (e) { sendErr(res, e); }
});

// GET /api/decisions/_categories — for UI filter dropdown
router.get('/decisions/_categories', (_req, res) => {
  res.json({ categories: decisionLog.CATEGORIES });
});

module.exports = router;
