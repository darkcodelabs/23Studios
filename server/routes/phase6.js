'use strict';

// Phase 6 — routes for the new authoring environment.
//
// B1 — GET /api/projects/:id/storyboard
//   Returns scene cards aggregated from source/scenes/**/*.lua,
//   sdk_data/scenes/*.json, and sdk_data/project.json. See
//   server/services/storyboard.js for the merge contract.
//
// B2 — GET /api/projects/:id/scenes/:sceneId/detail
//   Per-scene drilldown for the Scene Manager page. Returns the same
//   card shape plus 6-stage state machine status, canon section,
//   skill rules, dependency map (blocks / blocked_by), and inline
//   Lua source text for the read-only editor.

const express = require('express');
const projects = require('../services/projects');
const storyboard = require('../services/storyboard');
const sceneManager = require('../services/scene_manager');
const { validateId } = require('../services/validation');

const router = express.Router();

// scene_ids come from the autopilot (sc01, character_create, ...) or from
// the filesystem walker (pwnglove_panel_wires). Allow [A-Za-z0-9_-] up to 96.
const SCENE_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;
function validateSceneId(id) {
  if (typeof id !== 'string' || !id || !SCENE_ID_RE.test(id)) return 'invalid_scene_id';
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
    const detail = await sceneManager.buildSceneDetail(project, req.params.sceneId);
    res.json(detail);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

module.exports = router;
