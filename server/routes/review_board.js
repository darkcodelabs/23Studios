'use strict';

// review_board.js — REST routes for the user-facing review board.
//
//   POST /api/projects/:id/review/sync    — run sync, return board JSON
//   GET  /api/projects/:id/review         — current board JSON + counts
//   POST /api/projects/:id/review/approve — record decision + mark approved
//   POST /api/projects/:id/review/revise  — mark item as revise
//   GET  /api/projects/:id/decisions      — parsed decisions.jsonl

const express  = require('express');
const path     = require('path');
const projects = require('../services/projects');
const board    = require('../services/sdk_review_board');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error:  (e && e.code) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null
  });
}

async function resolveSdkRoot(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!proj.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  return path.join(proj.local_path, 'sdk_data');
}

// POST /api/projects/:id/review/sync
router.post('/:id/review/sync', async (req, res) => {
  try {
    const sdkRoot = await resolveSdkRoot(req.params.id);
    const result  = await board.sync(req.params.id, sdkRoot);
    res.json(result);
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/review
router.get('/:id/review', async (req, res) => {
  try {
    const sdkRoot = await resolveSdkRoot(req.params.id);
    const [current, pending] = await Promise.all([
      board.list(req.params.id, sdkRoot),
      board.pendingCount(req.params.id, sdkRoot),
    ]);
    const items   = Array.isArray(current.items) ? current.items : [];
    const approved = items.filter((i) => i.status === 'approved').length;
    const locked   = items.filter((i) => i.status === 'locked').length;
    const revise   = items.filter((i) => i.status === 'revise').length;
    res.json({
      board: current,
      counts: { pending, approved, locked, revise, total: items.length }
    });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/review/approve
// body: { item_id, decision_text?, rationale? }
router.post('/:id/review/approve', async (req, res) => {
  try {
    const body = req.body || {};
    const itemId = String(body.item_id || '').trim();
    if (!itemId) return res.status(400).json({ error: 'bad_request', detail: 'item_id required' });

    const sdkRoot = await resolveSdkRoot(req.params.id);

    // Record the decision
    const dec = await board.recordDecision(req.params.id, sdkRoot, {
      category:      'gate-signoff',
      decision_text: String(body.decision_text || `Approved: ${itemId}`).slice(0, 2000),
      rationale:     String(body.rationale || '').slice(0, 4000),
      references:    [itemId],
      by:            'user',
      phase:         typeof body.phase === 'number' ? body.phase : undefined,
    });

    // Mark item approved and re-render board
    const updated = await board.markItemStatus(req.params.id, sdkRoot, itemId, 'approved');
    res.json({ decision: dec, board: updated });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/review/revise
// body: { item_id, changes }
router.post('/:id/review/revise', async (req, res) => {
  try {
    const body = req.body || {};
    const itemId  = String(body.item_id || '').trim();
    const changes = String(body.changes  || '').trim();
    if (!itemId) return res.status(400).json({ error: 'bad_request', detail: 'item_id required' });

    const sdkRoot = await resolveSdkRoot(req.params.id);
    const updated = await board.markItemStatus(req.params.id, sdkRoot, itemId, 'revise', changes);
    res.json({ board: updated });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/decisions
router.get('/:id/decisions', async (req, res) => {
  try {
    const sdkRoot = await resolveSdkRoot(req.params.id);
    const items   = await board.listDecisions(req.params.id, sdkRoot);
    res.json({ items, count: items.length });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
