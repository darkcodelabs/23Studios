'use strict';

const express = require('express');

const wf = require('../services/pulp_workflow');

const router = express.Router({ mergeParams: true });

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp_workflow]', id, e && (e.code || e.message) || 'unknown');
  return res.status(fallback).json({ error: 'server_error', id });
}

router.get('/:id/pulp/workflow', async (req, res) => {
  try {
    const workflow = await wf.getWorkflow(req.params.id);
    res.json({ workflow });
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/pulp/workflow/reset', async (req, res) => {
  try {
    const workflow = await wf.resetWorkflow(req.params.id);
    res.json({ workflow });
  } catch (e) { sendErr(res, e); }
});

router.patch('/:id/pulp/workflow/stages/:stage', async (req, res) => {
  try {
    const { stage, workflow } = await wf.patchStage(
      req.params.id, req.params.stage, req.body || {}
    );
    res.json({
      stage,
      workflow_summary: wf.summarizeWorkflow(workflow)
    });
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/pulp/workflow/stages/:stage/apply', async (req, res) => {
  try {
    const stage = await wf.applyStageOutput(
      req.params.id, req.params.stage, req.body || {}
    );
    res.json({ stage });
  } catch (e) { sendErr(res, e); }
});

// SSE stream for AI runs.
router.post('/:id/pulp/workflow/stages/:stage/run', async (req, res) => {
  const projectId = req.params.id;
  const stageId = req.params.stage;
  const body = req.body || {};

  // Validate up-front so we can fail with a normal JSON error before
  // promoting the response to SSE.
  const userPrompt = typeof body.user_prompt === 'string' ? body.user_prompt : '';
  if (!userPrompt) {
    return res.status(400).json({ error: 'bad_request', detail: 'user_prompt required' });
  }
  if (userPrompt.length > 8000) {
    return res.status(400).json({ error: 'bad_request', detail: 'user_prompt too long' });
  }

  // Promote to SSE.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  let runner = null;

  function safeWrite(event, data) {
    if (closed) return;
    try {
      const payload = JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch (_e) { /* ignore write-after-close */ }
  }

  // Heartbeat every 15s; SSE comment lines are ignored by EventSource.
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
    if (runner && typeof runner.abort === 'function') {
      try { runner.abort(); } catch (_e) { /* ignore */ }
    }
  });

  try {
    runner = wf.runStage({
      projectId,
      stageId,
      userPrompt,
      model: typeof body.model === 'string' ? body.model : undefined,
      onChunk: (chunk) => safeWrite('chunk', { text: String(chunk) }),
      onParsed: (payload) => {
        safeWrite('parsed', payload);
        finish();
      },
      onError: (err) => {
        const status = (err && err.status) || 500;
        const code = (err && err.code) || 'server_error';
        const detail = err && err.detail !== undefined ? err.detail : undefined;
        safeWrite('error', { status, message: code, detail });
        finish();
      }
    });
  } catch (e) {
    safeWrite('error', {
      status: e.status || 500,
      message: e.code || 'server_error',
      detail: e.detail
    });
    finish();
  }
});

module.exports = router;
