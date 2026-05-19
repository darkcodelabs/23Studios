'use strict';

// Phase 6 — routes for the new authoring environment.
//
// B1 — GET /api/projects/:id/storyboard
//   Returns scene cards aggregated from source/scenes/**/*.lua,
//   sdk_data/scenes/*.json, and sdk_data/project.json. See
//   server/services/storyboard.js for the merge contract.
//
// B2 — GET /api/projects/:id/scenes/:sceneId/detail
//   Returns the per-scene 6-stage state machine + per-stage panels +
//   dependency map for the drilldown drawer. See
//   server/services/scene_detail.js.

const express = require('express');
const projects = require('../services/projects');
const storyboard = require('../services/storyboard');
const sceneDetail = require('../services/scene_detail');
const { validateId } = require('../services/validation');

const router = express.Router();

// Same character class B1 storyboard emits — composite ids use '_', `.lua`
// stripped, never absolute, never contains a path separator.
const SCENE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
function validateSceneId(v) {
  if (typeof v !== 'string' || !SCENE_ID_RE.test(v)) {
    return 'sceneId must match ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$';
  }
  return null;
}

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

router.get('/:id/scenes/:sceneId/detail', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const sidErr = validateSceneId(req.params.sceneId);
    if (sidErr) return res.status(400).json({ error: 'bad_request', detail: sidErr });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    const detail = await sceneDetail.buildSceneDetail(project, req.params.sceneId);
    res.json({
      project_id: project.id,
      project_name: project.name,
      ...detail
    });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.code || 'error', detail: e.message });
    next(e);
  }
});

module.exports = router;
