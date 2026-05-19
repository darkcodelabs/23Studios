'use strict';

// lint.js — Phase 6 B10
//
// POST /api/projects/:id/lint { lua, file_path }
//   Returns { findings: [...], summary: { errors, warnings, total } }
// POST /api/projects/:id/lint/all
//   Lints every scene_lua attached to the project's sdk_data/project.json.
//   Used by B11 ship preflight.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const projects = require('../services/projects');
const lua_lint = require('../services/lua_lint');

const router = express.Router();

router.post('/projects/:id/lint', express.json({ limit: '512kb' }), async (req, res) => {
  try {
    const lua = String((req.body && req.body.lua) || '');
    if (!lua) return res.status(400).json({ error: 'bad_request', detail: 'lua required' });
    const findings = lua_lint.lint(lua, req.body && req.body.file_path);
    res.json({ findings, summary: lua_lint.summarize(findings) });
  } catch (e) {
    res.status(500).json({ error: 'lint_failed', detail: e.message });
  }
});

router.post('/projects/:id/lint/all', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.local_path) return res.status(400).json({ error: 'no_local_path' });
    const sdkFile = path.join(project.local_path, 'sdk_data', 'project.json');
    if (!fs.existsSync(sdkFile)) return res.json({ files: [], summary: { errors: 0, warnings: 0, total: 0 } });
    const data = JSON.parse(await fsp.readFile(sdkFile, 'utf8'));
    const out = [];
    let errors = 0, warnings = 0;
    for (const s of (data.scenes || [])) {
      const lua = (s.lua && String(s.lua)) || '';
      if (!lua) continue;
      const findings = lua_lint.lint(lua, `scenes/${s.id}.lua`);
      const sum = lua_lint.summarize(findings);
      errors += sum.errors; warnings += sum.warnings;
      out.push({ scene_id: s.id, scene_name: s.name || s.id, findings, summary: sum });
    }
    res.json({ files: out, summary: { errors, warnings, total: errors + warnings } });
  } catch (e) {
    res.status(500).json({ error: 'lint_failed', detail: e.message });
  }
});

module.exports = router;
