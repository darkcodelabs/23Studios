'use strict';

const express = require('express');
const assetLibrary = require('../services/asset_library');
const presetPacks = require('../services/preset_packs');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

// GET /api/projects/:id/asset-library — full index
router.get('/projects/:id/asset-library', async (req, res) => {
  try {
    const idx = await assetLibrary.getActivePicks(req.params.id);
    res.json({ index: idx });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/asset-library/picks  → {axisId: optionRecord}
router.get('/projects/:id/asset-library/picks', async (req, res) => {
  try {
    const picks = await assetLibrary.getActivePicksWithSpecs(req.params.id);
    res.json({ picks });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/asset-library/options[?axisId]
router.get('/projects/:id/asset-library/options', async (req, res) => {
  try {
    const opts = await assetLibrary.listProjectOptions(req.params.id, req.query.axisId);
    res.json({ options: opts });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/asset-library/preset-pack  body: { packId, autoPick? }
router.post('/projects/:id/asset-library/preset-pack', async (req, res) => {
  try {
    const packId = (req.body && req.body.packId) || '';
    const auto = !!(req.body && req.body.autoPick);
    const result = auto
      ? await assetLibrary.importPresetPackAndPick(req.params.id, packId)
      : await assetLibrary.importPresetPack(req.params.id, packId);
    res.json({ result });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/asset-library/shared-assets[?category]
router.get('/projects/:id/asset-library/shared-assets', async (req, res) => {
  try {
    const list = await assetLibrary.listSharedAssets(req.params.id, req.query.category);
    res.json({ assets: list });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
