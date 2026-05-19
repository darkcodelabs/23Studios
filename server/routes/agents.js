'use strict';

// Agent dashboard routes (Phase 6 B6).
//
// Global (not per-project): /api/agents lists every Claude-spawned agent
// across every team config in ~/.claude/teams/. Per-agent detail returns
// recent inbox messages + pending permission requests. The approve/deny
// route writes a flag file the operator's CLI can pick up.

const express = require('express');
const agents = require('../services/agents');

const router = express.Router();

function sendErr(res, e) {
  const status = e && e.status ? e.status : 500;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message
  });
}

// GET /api/agents — snapshot of all agents
router.get('/agents', async (_req, res) => {
  try {
    const list = await agents.snapshot();
    res.json({
      generated_at: new Date().toISOString(),
      count: list.length,
      agents: list
    });
  } catch (e) { sendErr(res, e); }
});

// GET /api/agents/:team/:name — per-agent detail (full prompt + 25 recent msgs)
router.get('/agents/:team/:name', async (req, res) => {
  try {
    const d = await agents.detail(req.params.team, req.params.name);
    res.json({ agent: d });
  } catch (e) { sendErr(res, e); }
});

// POST /api/agents/:team/:name/permission
//   body: { request_id, approve: bool, reason?: string }
// Writes the operator's decision to a flag file. The currently-running claude
// CLI sessions use stdio-bound permission prompts and won't auto-pick this up
// in v1, but the file is the canonical record (and v1.5 can poll it).
router.post('/agents/:team/:name/permission', express.json({ limit: '8kb' }), async (req, res) => {
  const body = req.body || {};
  if (typeof body.request_id !== 'string') {
    return res.status(400).json({ error: 'bad_request', detail: 'request_id required' });
  }
  if (typeof body.approve !== 'boolean') {
    return res.status(400).json({ error: 'bad_request', detail: 'approve (bool) required' });
  }
  try {
    const out = await agents.recordDecision(
      req.params.team, req.params.name, body.request_id, body.approve, body.reason
    );
    res.json({ decision: out });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
