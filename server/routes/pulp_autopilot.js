'use strict';

const express = require('express');

const autopilot = require('../services/pulp_autopilot');

const router = express.Router({ mergeParams: true });

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp_autopilot]', id, e && (e.code || e.message) || 'unknown');
  return res.status(fallback).json({ error: 'server_error', id });
}

// POST /api/projects/:id/pulp/autopilot
// Body: { pitch: string, model?: string }
// Response: text/event-stream with events: phase | log | asset | done | error
router.post('/:id/pulp/autopilot', async (req, res) => {
  const projectId = req.params.id;
  const body = req.body || {};
  const pitch = typeof body.pitch === 'string' ? body.pitch : '';
  const model = typeof body.model === 'string' ? body.model : '';

  if (!pitch || pitch.length === 0) {
    return res.status(400).json({ error: 'bad_request', detail: 'pitch required' });
  }
  if (pitch.length > 4000) {
    return res.status(400).json({ error: 'bad_request', detail: 'pitch too long' });
  }

  // Promote to SSE.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;

  function safeWrite(event, data) {
    if (closed) return;
    try {
      const payload = JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch (_e) { /* ignore write-after-close */ }
  }

  // Heartbeat every 15s.
  const heartbeat = setInterval(() => {
    if (closed) return;
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (_e) { /* ignore */ }
  }, 15000);
  if (heartbeat.unref) heartbeat.unref();

  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { res.end(); } catch (_e) { /* ignore */ }
  }

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    // Cancel the in-flight run if the client disconnected.
    try { autopilot.cancelJob(projectId); } catch (_e) { /* ignore */ }
  });

  try {
    const { awaitDone } = autopilot.startAutopilot({
      projectId,
      pitch,
      model: model || undefined,
      onEvent: (event, data) => safeWrite(event, data)
    });
    awaitDone.then(() => finish(), () => finish());
  } catch (e) {
    if (e && e.status && e.code) {
      // Pre-flight failure (e.g. autopilot_already_running) — return as a
      // normal HTTP error since we haven't actually started.
      try {
        res.removeHeader('Content-Type');
        res.removeHeader('X-Accel-Buffering');
      } catch (_e) { /* ignore */ }
      if (!res.headersSent) {
        return sendErr(res, e);
      }
      safeWrite('error', {
        message: e.code,
        stage: null,
        recoverable: false
      });
      finish();
      return;
    }
    safeWrite('error', {
      message: (e && e.message) || 'server_error',
      stage: null,
      recoverable: false
    });
    finish();
  }
});

// GET /api/projects/:id/pulp/autopilot/status
router.get('/:id/pulp/autopilot/status', (req, res) => {
  try {
    const status = autopilot.getJobStatus(req.params.id);
    res.json(status);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/pulp/autopilot/cancel
router.post('/:id/pulp/autopilot/cancel', (req, res) => {
  try {
    const cancelled = autopilot.cancelJob(req.params.id);
    res.json({ cancelled });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
