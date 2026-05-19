'use strict';

const express = require('express');
const gates = require('../services/gates');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: e && e.code || e.message || 'server_error',
                            detail: e && e.detail || (e && e.message) || null });
}

// GET /api/projects/:id/gates -> { gates: [summary...], active: summary|null }
router.get('/:id/gates', async (req, res) => {
  try {
    const all = await gates.listGates(req.params.id);
    const active = await gates.activeGate(req.params.id);
    res.json({
      gates: all.map(gates.summarize),
      active: active ? gates.summarize(active) : null
    });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/gates/:gate_id -> full gate
router.get('/:id/gates/:gateId', async (req, res) => {
  try {
    const g = await gates.getGate(req.params.id, req.params.gateId);
    res.json(g);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/gates/:gate_id/decide
//   body: { sub_decision_id, decision }
router.post('/:id/gates/:gateId/decide', async (req, res) => {
  try {
    const body = req.body || {};
    const subDecisionId = String(body.sub_decision_id || body.subDecisionId || '').trim();
    if (!subDecisionId) return res.status(400).json({ error: 'bad_request',
      detail: 'sub_decision_id required' });
    const g = await gates.decide({
      projectId: req.params.id,
      gateId: req.params.gateId,
      subDecisionId,
      decision: body.decision,
      decidedBy: body.decided_by || 'user'
    });
    res.json(g);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/gates/:gate_id/signoff
router.post('/:id/gates/:gateId/signoff', async (req, res) => {
  try {
    const body = req.body || {};
    const g = await gates.signOff({
      projectId: req.params.id,
      gateId: req.params.gateId,
      decidedBy: body.decided_by || 'user',
      note: body.note
    });
    res.json(g);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
