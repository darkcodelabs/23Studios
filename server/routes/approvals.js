'use strict';

// Phase 6 B3 — Asset Approver routes.

const express = require('express');
const approvals = require('../services/approvals');
const { validateId } = require('../services/validation');

const router = express.Router();

const ASSET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
function validateAssetId(v) {
  if (typeof v !== 'string' || !ASSET_ID_RE.test(v)) {
    return 'asset_id must match ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$';
  }
  return null;
}

function sendErr(res, e) {
  const status = e && e.status ? e.status : 500;
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
    const out = await approvals.readQueue(req.params.id);
    res.json({ project_id: req.params.id, ...out });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/approvals/:asset_id/decide
//   body: { decision, reason?, decided_by?, source_refs? }
router.post(
  '/projects/:id/approvals/:asset_id/decide',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const aidErr = validateAssetId(req.params.asset_id);
    if (aidErr) return res.status(400).json({ error: 'bad_request', detail: aidErr });
    const body = req.body || {};
    try {
      const out = await approvals.decide(req.params.id, req.params.asset_id, {
        decision: body.decision,
        decided_by: body.decided_by,
        reason: body.reason,
        source_refs: body.source_refs
      });
      res.json(out);
    } catch (e) { sendErr(res, e); }
  }
);

// GET /api/approvals/_decisions — for UI hotkey reference dropdown
router.get('/approvals/_decisions', (_req, res) => {
  res.json({ decisions: approvals.DECISIONS });
});

module.exports = router;
