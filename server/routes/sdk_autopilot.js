'use strict';

const express = require('express');
const sdkAutopilot = require('../services/sdk_autopilot');
const sdkExport = require('../services/sdk_export');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: e && e.code || 'server_error', detail: e && e.message });
}

// POST /api/projects/:id/sdk/autopilot  body: { pitch }  -> SSE stream
router.post('/:id/sdk/autopilot', (req, res) => {
  const projectId = req.params.id;
  const pitch = String((req.body && req.body.pitch) || '').trim();
  if (!pitch) return res.status(400).json({ error: 'bad_request', detail: 'pitch required' });

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

  function safeWrite(event, data) {
    if (closed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch (_e) { /* ignore */ }
  }
  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { res.end(); } catch (_e) { /* ignore */ }
  }
  req.on('close', () => { closed = true; clearInterval(heartbeat); });

  try {
    const { awaitDone } = sdkAutopilot.startSdkAutopilot({
      projectId, pitch,
      onEvent: (evt, data) => safeWrite(evt, data || {})
    });
    awaitDone.then(() => finish(), () => finish());
  } catch (e) {
    if (!res.headersSent) return sendErr(res, e);
    safeWrite('error', { message: e.code || e.message });
    finish();
  }
});

// POST /api/projects/:id/sdk/export  -> { job_id, status_url, download_url }
router.post('/:id/sdk/export', async (req, res) => {
  try {
    const job = await sdkExport.startExport({ projectId: req.params.id });
    res.status(202).json({
      job_id: job.id,
      status_url: `/api/projects/${req.params.id}/sdk/export/jobs/${job.id}`,
      download_url: `/api/projects/${req.params.id}/sdk/export/jobs/${job.id}/download`
    });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/sdk/export/jobs/:jobId  -> status snapshot
router.get('/:id/sdk/export/jobs/:jobId', (req, res) => {
  const j = sdkExport.getJob(req.params.jobId);
  if (!j) return res.status(404).json({ error: 'not_found' });
  res.json(j);
});

// GET /api/projects/:id/sdk/export/jobs/:jobId/download
// Streams the .pdx directory as a tar so the front-end gets a single blob.
router.get('/:id/sdk/export/jobs/:jobId/download', (req, res) => {
  const j = sdkExport.getJob(req.params.jobId);
  if (!j) return res.status(404).end();
  if (j.status !== 'done') {
    if (j.status === 'failed') return res.status(500).json({ error: 'export_failed', detail: j.error });
    return res.status(202).json({ status: j.status });
  }
  const { spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');
  const outPdx = j.out_pdx;
  if (!outPdx || !fs.existsSync(outPdx)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/x-tar');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(outPdx)}.tar"`);
  const tar = spawn('tar', ['cf', '-', '-C', path.dirname(outPdx), path.basename(outPdx)], { shell: false });
  tar.stdout.pipe(res);
  tar.stderr.on('data', (b) => { /* swallow tar warnings */ void b; });
});

module.exports = router;
