'use strict';

// mvp.js — interactive MVP-first vibe-lock workflow.
//
//   POST   /:id/mvp/start                 — pick scope, build pending prompts
//   GET    /:id/mvp/prompts               — list pending/dispatched/complete
//   PATCH  /:id/mvp/prompts/:prompt_id    — edit + approve (dispatches)
//   POST   /:id/mvp/lock                  — write locked.json
//   GET    /:id/mvp/outputs/:file         — serve generated PNG
//   GET    /:id/mvp/state                 — { has_lock, completed_count, ... }

const express = require('express');
const fs = require('fs');
const path = require('path');

const mvpAutopilot = require('../services/mvp_autopilot');
const projects = require('../services/projects');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

router.post('/:id/mvp/start', async (req, res) => {
  try {
    const scopeOverride = (req.body && req.body.mvp_scope) || null;
    const result = await mvpAutopilot.startMvp(req.params.id, scopeOverride);
    res.json(result);
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/mvp/prompts', async (req, res) => {
  try {
    const list = await mvpAutopilot.listPrompts(req.params.id);
    res.json({ prompts: list });
  } catch (e) { sendErr(res, e); }
});

router.patch('/:id/mvp/prompts/:promptId', async (req, res) => {
  try {
    const body = req.body || {};
    const rec = await mvpAutopilot.patchPrompt(req.params.id, req.params.promptId, body);
    res.json(rec);
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/mvp/lock', async (req, res) => {
  try {
    const locked = await mvpAutopilot.lockMvp(req.params.id);
    res.json({ ok: true, locked });
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/mvp/state', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.game_type !== 'sdk') return res.status(400).json({ error: 'not_sdk' });
    const list = await mvpAutopilot.listPrompts(req.params.id);
    const locked = await mvpAutopilot.readLocked(project.local_path);
    const counts = list.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    }, {});
    res.json({
      has_lock: !!locked,
      locked_at: locked ? locked.locked_at : null,
      prompt_count: list.length,
      counts,
      all_complete: list.length > 0 && list.every((p) => p.status === 'complete'),
      anchors: locked ? locked.anchors : []
    });
  } catch (e) { sendErr(res, e); }
});

// GET /:id/mvp/outputs/:file — serve a generated PNG. Path-traversal guarded
// by basename check (file must match \w+\.png).
router.get('/:id/mvp/outputs/:file', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).end();
    const file = req.params.file;
    if (!/^[A-Za-z0-9_-]+\.png$/.test(file)) return res.status(400).end();
    const abs = path.join(project.local_path, 'sdk_data', 'mvp', 'outputs', file);
    if (!fs.existsSync(abs)) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=10');
    fs.createReadStream(abs).pipe(res);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
