'use strict';

// Phase 6 A7 — Work Graph routes.

const express = require('express');

const workGraph = require('../services/work_graph');
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

// POST /api/projects/:id/graph/generate     build (or rebuild) the work graph
router.post('/:id/graph/generate', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const graph = await workGraph.generateGraph(req.params.id);
    res.status(200).json({ ok: true, graph });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/graph                latest graph or null
router.get('/:id/graph', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const graph = await workGraph.getGraph(req.params.id);
    if (!graph) return res.status(404).json({ error: 'no_graph' });
    res.json({ ok: true, graph });
  } catch (e) { sendErr(res, e); }
});

// PATCH /api/projects/:id/graph/nodes/:nodeId
//   body: { status?, output_paths?, notes?, attempt? }
router.patch('/:id/graph/nodes/:nodeId', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const node = await workGraph.updateNode(req.params.id, req.params.nodeId, req.body || {});
    res.json({ ok: true, node });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
