'use strict';

// Phase 6 B11 — Ship routes.
//
//   GET  /api/projects/:id/ship/preflight    — checks 1..3 without exporting
//   POST /api/projects/:id/ship              — start ship + SSE stream
//   GET  /api/projects/:id/ship/jobs         — list ship jobs for project
//   GET  /api/projects/:id/ship/jobs/:jobId  — current state of a ship job
//   GET  /api/projects/:id/ship/jobs/:jobId/stream — SSE for a running job

const express = require('express');
const ship = require('../services/ship');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e) {
  const status = e && e.status ? e.status : 500;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

router.get('/projects/:id/ship/preflight', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const out = await ship.preflight(req.params.id);
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

router.get('/projects/:id/ship/jobs', (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const jobs = ship.getJobsByProject(req.params.id);
  res.json({ jobs });
});

router.get('/projects/:id/ship/jobs/:jobId', (req, res) => {
  const j = ship.getJob(req.params.jobId);
  if (!j) return res.status(404).json({ error: 'not_found' });
  res.json(j);
});

// POST /api/projects/:id/ship   body: { allow_lint_fail?, allow_drift?, skip_sim? }
// Returns SSE stream of step events; same job retrievable via /ship/jobs/:jobId.
router.post('/projects/:id/ship', express.json({ limit: '8kb' }), (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (closed) return;
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (_e) { /* */ }
  }, 15000);
  if (heartbeat.unref) heartbeat.unref();

  function safeWrite(event, data) {
    if (closed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch (_e) { /* */ }
  }
  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { res.end(); } catch (_e) { /* */ }
  }
  req.on('close', () => { closed = true; clearInterval(heartbeat); });

  try {
    const body = req.body || {};
    const options = {
      allow_lint_fail: !!body.allow_lint_fail,
      allow_drift:     !!body.allow_drift,
      skip_sim:        !!body.skip_sim
    };
    const { id, awaitDone } = ship.startShip({
      projectId: req.params.id,
      options,
      onEvent: (evt, data) => safeWrite(evt, data)
    });
    safeWrite('ship', { job_id: id });
    awaitDone.then(() => finish(), () => finish());
  } catch (e) {
    if (!res.headersSent) return sendErr(res, e);
    safeWrite('error', { message: e.code || e.message });
    finish();
  }
});

module.exports = router;
