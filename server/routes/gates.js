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
// Works for both sub-decision gates (existing) and canonical flat gates.
// For canonical gates (no sub_decisions), body: { notes?, signed_off_by? }
router.post('/:id/gates/:gateId/signoff', async (req, res) => {
  try {
    const body = req.body || {};
    // Try canonical gate signoff first; fall back to sub-decision signoff.
    // A gate is "canonical" if its stored JSON has a `blocks` field.
    let g;
    try {
      const existing = await gates.getGate(req.params.id, req.params.gateId);
      if (Array.isArray(existing.blocks)) {
        // Canonical flat gate.
        g = await gates.signOffCanonical({
          projectId: req.params.id,
          gateId: req.params.gateId,
          notes: body.notes || body.note || null,
          signedOffBy: body.signed_off_by || body.decided_by || 'user'
        });
      } else {
        // Legacy sub-decision gate.
        g = await gates.signOff({
          projectId: req.params.id,
          gateId: req.params.gateId,
          decidedBy: body.decided_by || 'user',
          note: body.note
        });
      }
    } catch (inner) {
      if (inner.status !== 404) throw inner;
      // Gate file not found — try canonical path.
      g = await gates.signOffCanonical({
        projectId: req.params.id,
        gateId: req.params.gateId,
        notes: body.notes || body.note || null,
        signedOffBy: body.signed_off_by || body.decided_by || 'user'
      });
    }
    res.json(g);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/gates/:gate_id/status
// Set status + notes on a canonical gate. body: { status, notes? }
router.post('/:id/gates/:gateId/status', async (req, res) => {
  try {
    const body = req.body || {};
    const allowed = ['pending', 'signed_off', 'blocked'];
    const newStatus = String(body.status || '').trim();
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({ error: 'bad_request', detail: `status must be one of: ${allowed.join(', ')}` });
    }
    const { dir } = await gates.gatesDirFor(req.params.id);
    const nodePath = require('path');
    const fsp = require('fs/promises');
    const fs = require('fs');
    const p = nodePath.join(dir, req.params.gateId + '.json');
    if (!fs.existsSync(p)) {
      return res.status(404).json({ error: 'gate_not_found' });
    }
    const gate = JSON.parse(await fsp.readFile(p, 'utf8'));
    gate.status = newStatus;
    if (body.notes !== undefined) gate.notes = String(body.notes || '').slice(0, 4000);
    if (newStatus === 'signed_off') {
      gate.signed_off_at = gate.signed_off_at || new Date().toISOString();
      gate.signed_off_by = body.signed_off_by || body.decided_by || gate.signed_off_by || 'user';
    }
    await fsp.writeFile(p, JSON.stringify(gate, null, 2));
    res.json(gate);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
