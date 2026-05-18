'use strict';

const express = require('express');
const levels = require('../services/level_editor');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

// GET /api/projects/:id/levels
router.get('/projects/:id/levels', async (req, res) => {
  try {
    const ids = await levels.listLevels(req.params.id);
    res.json({ levels: ids });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/levels/:levelId
router.get('/projects/:id/levels/:levelId', async (req, res) => {
  try {
    const lv = await levels.readLevel(req.params.id, req.params.levelId);
    res.json({ level: lv });
  } catch (e) { sendErr(res, e, 404); }
});

// PUT /api/projects/:id/levels/:levelId  body: level JSON
router.put('/projects/:id/levels/:levelId', async (req, res) => {
  try {
    const fp = await levels.writeLevel(req.params.id, req.params.levelId, req.body || {});
    res.json({ ok: true, path: fp });
  } catch (e) { sendErr(res, e, 400); }
});

// DELETE /api/projects/:id/levels/:levelId
router.delete('/projects/:id/levels/:levelId', async (req, res) => {
  try {
    await levels.deleteLevel(req.params.id, req.params.levelId);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/levels/new-blank
//   body: { levelId, imagetablePath, tileW?, tileH?, gridW?, gridH? }
router.post('/projects/:id/levels/new-blank', async (req, res) => {
  try {
    const lv = levels.newBlankLevel(req.body || {});
    const fp = await levels.writeLevel(req.params.id, lv.level_id, lv);
    res.json({ level: lv, path: fp });
  } catch (e) { sendErr(res, e, 400); }
});

module.exports = router;
