'use strict';

const express = require('express');
const minigames = require('../services/minigame_editor');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

// GET /api/minigame-kits — supported configurable kits
router.get('/minigame-kits', (_req, res) => {
  res.json({ kits: minigames.listSupportedKits() });
});

// GET /api/minigame-kits/:kitId — recipe + default config
router.get('/minigame-kits/:kitId', (req, res) => {
  const recipe = minigames.getKitRecipe(req.params.kitId);
  if (!recipe) return res.status(404).json({ error: 'unknown_kit' });
  const def = minigames.defaultConfigForKit(req.params.kitId);
  res.json({ kit: { id: req.params.kitId, recipe, default_config: def } });
});

// GET /api/projects/:id/minigame-configs — list configured scene ids
router.get('/projects/:id/minigame-configs', async (req, res) => {
  try {
    const ids = await minigames.listConfigs(req.params.id);
    res.json({ configs: ids });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/minigame-configs/:sceneId
router.get('/projects/:id/minigame-configs/:sceneId', async (req, res) => {
  try {
    const cfg = await minigames.readConfig(req.params.id, req.params.sceneId);
    if (!cfg) return res.status(404).json({ error: 'no_config' });
    res.json({ config: cfg });
  } catch (e) { sendErr(res, e); }
});

// PUT /api/projects/:id/minigame-configs/:sceneId  body: { kitId, config }
router.put('/projects/:id/minigame-configs/:sceneId', async (req, res) => {
  try {
    const kitId = (req.body && req.body.kitId) || '';
    const cfg = (req.body && req.body.config) || {};
    const saved = await minigames.writeConfig(req.params.id, req.params.sceneId, kitId, cfg);
    res.json({ config: saved });
  } catch (e) { sendErr(res, e, 400); }
});

// DELETE /api/projects/:id/minigame-configs/:sceneId
router.delete('/projects/:id/minigame-configs/:sceneId', async (req, res) => {
  try {
    await minigames.deleteConfig(req.params.id, req.params.sceneId);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
