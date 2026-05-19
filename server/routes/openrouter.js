'use strict';

const express = require('express');
const openrouter = require('../services/openrouter');
const openrouterSpend = require('../services/openrouter_spend');
const claude = require('../services/claude');
const projects = require('../services/projects');
const { validateId } = require('../services/validation');

const router = express.Router();

router.get('/models', async (_req, res, next) => {
  try {
    const list = await openrouter.listModels();
    res.json({ models: list });
  } catch (e) { next(e); }
});

router.post('/chat', async (req, res, next) => {
  const { model, messages, project_id } = req.body || {};
  try {
    if (project_id !== undefined && project_id !== null) {
      const idErr = validateId(project_id);
      if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
      const p = await projects.getProject(project_id);
      if (!p) return res.status(404).json({ error: 'project_not_found' });
      // Hard cap: if the project has burned past its OpenRouter cap, refuse
      // new calls until the operator raises the cap or archives.
      try { await openrouterSpend.assertCapNotExceeded(project_id); }
      catch (capErr) {
        if (capErr && capErr.code === 'cost_cap_exceeded') {
          return res.status(402).json({ error: 'cost_cap_exceeded', detail: capErr.message });
        }
        throw capErr;
      }
    }
    if (typeof model !== 'string') return res.status(400).json({ error: 'bad_request', detail: 'model required' });
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'bad_request', detail: 'messages required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const userText = messages[messages.length - 1]?.content || '';
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const full = await openrouter.streamChat({
        model,
        messages,
        signal: controller.signal,
        onDelta: (d) => send('chunk', { text: d }),
        projectId: project_id || null,
        stage: 'chat'
      });
      if (project_id) {
        await claude.appendHistory(project_id, { role: 'user', content: userText, backend: 'openrouter', model });
        await claude.appendHistory(project_id, { role: 'assistant', content: full, backend: 'openrouter', model });
      }
      send('done', { ok: true });
      res.end();
    } catch (e) {
      send('error', { message: 'stream_failed' });
      res.end();
    }
  } catch (e) { next(e); }
});

module.exports = router;
