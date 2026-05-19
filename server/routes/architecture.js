'use strict';

// architecture.js — Routes for the architecture diagram generator (Phase 9).
//
// POST /api/projects/:id/architecture/generate — generate architecture.md + optional svg
// GET  /api/projects/:id/architecture          — return .md content + svg url if present

const express = require('express');
const path = require('path');
const projects = require('../services/projects');
const archDiagram = require('../services/sdk_arch_diagram');

const router = express.Router();

const SDK_DATA_REL = 'sdk_data';

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null
  });
}

// POST /api/projects/:id/architecture/generate
router.post('/:id/architecture/generate', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }

    const sdkRoot = path.join(project.local_path, SDK_DATA_REL);
    const result = await archDiagram.generate(project.id, sdkRoot);

    // Expose svg as a relative URL if it was generated.
    const svgUrl = result.svg_path
      ? `/api/projects/${project.id}/architecture/svg`
      : null;

    res.json({
      ok: true,
      md_path: result.md_path,
      svg_path: result.svg_path,
      svg_url: svgUrl
    });
  } catch (e) {
    sendErr(res, e);
  }
});

// GET /api/projects/:id/architecture
router.get('/:id/architecture', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }

    const sdkRoot = path.join(project.local_path, SDK_DATA_REL);
    const { md, svg_path } = archDiagram.read(sdkRoot);

    if (!md) {
      return res.status(404).json({
        error: 'not_generated_yet',
        detail: 'Run POST /api/projects/:id/architecture/generate first'
      });
    }

    const svgUrl = svg_path
      ? `/api/projects/${project.id}/architecture/svg`
      : null;

    res.json({ md, svg_url: svgUrl });
  } catch (e) {
    sendErr(res, e);
  }
});

module.exports = router;
