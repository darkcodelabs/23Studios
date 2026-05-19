'use strict';

// Phase 6 A3-A7 — Requirements + coverage + interview + scope + work graph
// routes. Co-located so a single route module covers the upstream pipeline;
// individual sections (A3..A7) live in their own service modules to keep
// concerns separated.

const express = require('express');

const derive = require('../services/derive_requirements');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

function preflightId(req, res) {
  const err = validateId(req.params.id);
  if (err) { res.status(400).json({ error: 'bad_request', detail: err }); return false; }
  return true;
}

function sseOpen(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  let closed = false;
  const heartbeat = setInterval(() => {
    if (closed) return;
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (_e) { /* ignore */ }
  }, 15000);
  if (heartbeat.unref) heartbeat.unref();
  function write(event, data) {
    if (closed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`); }
    catch (_e) { /* ignore */ }
  }
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { res.end(); } catch (_e) { /* ignore */ }
  }
  return { write, close, isClosed: () => closed };
}

// ---------------------------------------------------------------------------
// A3 — POST /api/projects/:id/requirements/derive   (SSE)
// ---------------------------------------------------------------------------
router.post('/:id/requirements/derive', (req, res) => {
  if (!preflightId(req, res)) return;
  const sse = sseOpen(res);
  req.on('close', sse.close);
  derive.deriveRequirements(req.params.id, {
    onEvent: (evt, data) => sse.write(evt, data)
  }).then((doc) => {
    sse.write('summary', {
      total_items: doc.totals.total_items,
      est_cost_usd_zero_reroll: doc.totals.est_cost_usd_zero_reroll,
      est_cost_usd_avg_reroll_1_5: doc.totals.est_cost_usd_avg_reroll_1_5,
      counts_by_kind: doc.counts_by_kind
    });
    sse.write('done', { ok: true });
    sse.close();
  }).catch((e) => {
    sse.write('error', { message: e && e.message, code: e && e.code });
    sse.close();
  });
});

// GET /api/projects/:id/requirements  -> latest derived doc
router.get('/:id/requirements', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const doc = await derive.getDerived(req.params.id);
    if (!doc) return res.status(404).json({ error: 'not_derived_yet' });
    res.json({ ok: true, derived: doc });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
