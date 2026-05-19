'use strict';

// design.js — Routes for the Game Design Compiler (Step 3) + QA Critic (Step 8).
//
// POST /api/projects/:id/design/compile        — run compiler, write compiled_design.json
// GET  /api/projects/:id/design                — serve compiled_design.json
// POST /api/projects/:id/design/validate       — run static validator
// GET  /api/projects/:id/design/validate/latest — latest validator report
// POST /api/projects/:id/qa/critique           — run 5-persona AI critic, return report
// GET  /api/projects/:id/qa/critique/latest    — return persisted qa_critic.json

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const projects = require('../services/projects');
const compiler = require('../services/sdk_design_compiler');
const validator = require('../services/sdk_static_validator');
const critic = require('../services/sdk_qa_pass');

const router = express.Router();

const SDK_DATA_REL = 'sdk_data';

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null
  });
}

// POST /api/projects/:id/design/compile
// Runs the design compiler for the project and returns the compiled design.
// Safe to re-run: overwrites the previous compiled_design.json.
router.post('/:id/design/compile', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }

    const sdkRoot = path.join(project.local_path, SDK_DATA_REL);
    const compiled = await compiler.compile(project.id, sdkRoot);
    res.json(compiled);
  } catch (e) {
    sendErr(res, e);
  }
});

// GET /api/projects/:id/design
// Returns the current compiled_design.json.  404 when the compiler has not
// run yet for this project.
router.get('/:id/design', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }

    const sdkRoot = path.join(project.local_path, SDK_DATA_REL);
    const compiled = await compiler.read(sdkRoot);
    if (!compiled) {
      return res.status(404).json({
        error: 'not_compiled_yet',
        detail: 'Run POST /api/projects/:id/design/compile first'
      });
    }
    res.json(compiled);
  } catch (e) {
    sendErr(res, e);
  }
});

// POST /api/projects/:id/design/validate
// Runs the static validator against compiled_design.json and persists the
// report to sdk_data/design_validation.json.
router.post('/:id/design/validate', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }
    const sdkRoot = path.join(project.local_path, SDK_DATA_REL);
    const report = await validator.validate(project.id, sdkRoot);
    if (report && report.ok !== false) {
      const out = path.join(sdkRoot, 'design_validation.json');
      try { await fsp.writeFile(out, JSON.stringify(report, null, 2)); }
      catch (_e) { /* best-effort persist */ }
    }
    res.json(report);
  } catch (e) {
    sendErr(res, e);
  }
});

// GET /api/projects/:id/design/validate/latest
// Returns the most recent persisted validator report, or 404 if absent.
router.get('/:id/design/validate/latest', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }
    const fp = path.join(project.local_path, SDK_DATA_REL, 'design_validation.json');
    if (!fs.existsSync(fp)) {
      return res.status(404).json({ error: 'no_validation_report' });
    }
    const raw = await fsp.readFile(fp, 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) {
    sendErr(res, e);
  }
});

// POST /api/projects/:id/qa/critique
// Runs the 5-persona AI critic pass. Writes qa_critic.json + qa_critic.md to
// sdk_data/ and returns the full report. Can take 30-90 s (5 Claude calls).
router.post('/:id/qa/critique', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }
    const report = await critic.critique(project.id, project.local_path);
    res.json(report);
  } catch (e) {
    sendErr(res, e);
  }
});

// GET /api/projects/:id/qa/critique/latest
// Returns the most recent persisted qa_critic.json, or 404 if not yet run.
router.get('/:id/qa/critique/latest', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }
    const report = await critic.readLatest(project.local_path);
    if (!report) return res.status(404).json({ error: 'no_critique_yet' });
    res.json(report);
  } catch (e) {
    sendErr(res, e);
  }
});

module.exports = router;
