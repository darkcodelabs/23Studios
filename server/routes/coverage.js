'use strict';

// Phase 6 A4 — Coverage Gap routes.
//
// POST /api/projects/:id/requirements/coverage   SSE: phase/done/error
// GET  /api/projects/:id/requirements/coverage   latest coverage_report.json

const express = require('express');

const coverage = require('../services/coverage_gap');
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
  return { write, close };
}

router.post('/:id/requirements/coverage', (req, res) => {
  if (!preflightId(req, res)) return;
  const sse = sseOpen(res);
  req.on('close', sse.close);
  coverage.analyzeCoverage(req.params.id, {
    onEvent: (evt, data) => sse.write(evt, data)
  }).then((report) => {
    sse.write('summary', { totals: report.totals });
    sse.write('done', { ok: true });
    sse.close();
  }).catch((e) => {
    sse.write('error', { message: e && e.message, code: e && e.code });
    sse.close();
  });
});

router.get('/:id/requirements/coverage', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const report = await coverage.getCoverageReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'no_coverage_report' });
    res.json({ ok: true, coverage: report });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
