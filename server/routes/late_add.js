'use strict';

const express = require('express');
const lateAdd = require('../services/late_add');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

// POST /api/projects/:id/late-add/scenes  body: { pitch, insertedAfterSceneId?, sceneType?, minigameKitId? }
router.post('/projects/:id/late-add/scenes', async (req, res) => {
  try {
    const out = await lateAdd.addScene({
      projectId: req.params.id,
      pitch: (req.body && req.body.pitch) || '',
      insertedAfterSceneId: req.body && req.body.insertedAfterSceneId,
      sceneType: req.body && req.body.sceneType,
      minigameKitId: req.body && req.body.minigameKitId
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/late-add/scenes/:sceneId/add-minigame
//   body: { minigameKitId, customRecipeSpec? }
router.post('/projects/:id/late-add/scenes/:sceneId/add-minigame', async (req, res) => {
  try {
    const out = await lateAdd.addMinigameToScene({
      projectId: req.params.id,
      sceneId: req.params.sceneId,
      minigameKitId: (req.body && req.body.minigameKitId) || '',
      customRecipeSpec: req.body && req.body.customRecipeSpec
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/late-add/styles/:axisId/swap
//   body: { newOptionId, dryRun? }
router.post('/projects/:id/late-add/styles/:axisId/swap', async (req, res) => {
  try {
    const out = await lateAdd.swapStylePick({
      projectId: req.params.id,
      axisId: req.params.axisId,
      newOptionId: (req.body && req.body.newOptionId) || '',
      dryRun: !!(req.body && req.body.dryRun)
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/late-add/features/:featureId
//   body: { params }
router.post('/projects/:id/late-add/features/:featureId', async (req, res) => {
  try {
    const out = await lateAdd.retrofitFeature({
      projectId: req.params.id,
      featureId: req.params.featureId,
      params: (req.body && req.body.params) || {}
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/late-add/levels
//   body: { levelName, baseTemplate?, sourceSceneId? }
router.post('/projects/:id/late-add/levels', async (req, res) => {
  try {
    const out = await lateAdd.addLevel({
      projectId: req.params.id,
      levelName: (req.body && req.body.levelName) || '',
      baseTemplate: req.body && req.body.baseTemplate,
      sourceSceneId: req.body && req.body.sourceSceneId
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/late-add/rebuild — returns next-action descriptor
router.post('/projects/:id/late-add/rebuild', async (req, res) => {
  try {
    const out = await lateAdd.recompile({ projectId: req.params.id });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
