'use strict';

// Drift detector routes (Phase 6 C3).

const express = require('express');
const driftDetect = require('../services/drift_detect');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e) {
  const status = e && e.status ? e.status : 500;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message
  });
}

// GET /api/projects/:id/drift?stage=&kind=
router.get('/projects/:id/drift', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const out = await driftDetect.readDriftFlags(req.params.id, {
      stage: req.query.stage,
      kind: req.query.kind
    });
    res.json({ project_id: req.params.id, ...out });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/drift/check — { prompt_body, filter_trip_words?, require_anchor_citation? }
//   Pre-send drift check (callable from orchestrator/UI for diagnostics).
router.post('/projects/:id/drift/check', express.json({ limit: '128kb' }), async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const body = req.body || {};
  try {
    const out = await driftDetect.checkPromptDrift({
      projectId: req.params.id,
      prompt_body: body.prompt_body,
      filter_trip_words: body.filter_trip_words,
      require_anchor_citation: !!body.require_anchor_citation
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
