'use strict';

// bible.js — modular story bible section CRUD + compile.
//
// GET    /api/projects/:id/bible              -> { sections: [...], compiled_bytes }
// GET    /api/projects/:id/bible/:filename    -> raw markdown
// POST   /api/projects/:id/bible/:filename    -> { content } upsert
// DELETE /api/projects/:id/bible/:filename
// POST   /api/projects/:id/bible/compile      -> concat into story_bible.md

const express = require('express');
const fs = require('fs');
const projects = require('../services/projects');
const bible = require('../services/sdk_bible');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || null
  });
}

async function loadProject(req, res) {
  const p = await projects.getProject(req.params.id);
  if (!p) { res.status(404).json({ error: 'project_not_found' }); return null; }
  if (!p.local_path) { res.status(422).json({ error: 'no_local_path' }); return null; }
  return p;
}

router.get('/:id/bible', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const sections = await bible.list(p.local_path);
    const compiledPath = require('path').join(p.local_path, 'sdk_data', 'story_bible.md');
    let compiledBytes = null;
    if (fs.existsSync(compiledPath)) compiledBytes = fs.statSync(compiledPath).size;
    res.json({ sections, compiled_bytes: compiledBytes });
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/bible/:filename', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const content = await bible.read(p.local_path, req.params.filename);
    res.type('text/markdown; charset=utf-8').send(content);
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/bible/:filename', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const r = await bible.write(p.local_path, req.params.filename,
                                req.body && req.body.content);
    // Auto-compile on every write so story_bible.md stays in sync with
    // the section files. Cheap — concat is O(sections).
    await bible.compile(p.local_path);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

router.delete('/:id/bible/:filename', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const ok = await bible.remove(p.local_path, req.params.filename);
    if (!ok) return res.status(404).json({ error: 'section_not_found' });
    await bible.compile(p.local_path);
    res.json({ deleted: req.params.filename });
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/bible/compile', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const r = await bible.compile(p.local_path);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
