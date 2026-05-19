'use strict';

// Phase 6 — routes for the new authoring environment.
//
// B1 — GET /api/projects/:id/storyboard
//   Returns scene cards aggregated from source/scenes/**/*.lua,
//   sdk_data/scenes/*.json, and sdk_data/project.json. See
//   server/services/storyboard.js for the merge contract.

const express = require('express');
const projects = require('../services/projects');
const storyboard = require('../services/storyboard');
const { validateId } = require('../services/validation');

const router = express.Router();

router.get('/:id/storyboard', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    const board = await storyboard.buildStoryboard(project);
    res.json({
      project_id: project.id,
      project_name: project.name,
      local_path: project.local_path,
      ...board
    });
  } catch (e) { next(e); }
});

module.exports = router;
