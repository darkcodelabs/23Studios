'use strict';

const express = require('express');
const npc = require('../services/npc_dialog_tool');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

// GET /api/projects/:id/npcs
router.get('/projects/:id/npcs', async (req, res) => {
  try {
    const ids = await npc.listNpcs(req.params.id);
    res.json({ npcs: ids });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/npcs/:npcId
router.get('/projects/:id/npcs/:npcId', async (req, res) => {
  try {
    const tree = await npc.readNpc(req.params.id, req.params.npcId);
    res.json({ npc: tree });
  } catch (e) { sendErr(res, e, 404); }
});

// PUT /api/projects/:id/npcs/:npcId  body: tree JSON
router.put('/projects/:id/npcs/:npcId', async (req, res) => {
  try {
    const fp = await npc.writeNpc(req.params.id, req.params.npcId, req.body || {});
    res.json({ ok: true, path: fp });
  } catch (e) { sendErr(res, e, 400); }
});

// DELETE /api/projects/:id/npcs/:npcId
router.delete('/projects/:id/npcs/:npcId', async (req, res) => {
  try {
    await npc.deleteNpc(req.params.id, req.params.npcId);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/npcs/:npcId/simulate
//   body: { initialFlags?, choiceTakes? }
router.post('/projects/:id/npcs/:npcId/simulate', async (req, res) => {
  try {
    const out = await npc.simulate(req.params.id, req.params.npcId, {
      initialFlags: (req.body && req.body.initialFlags) || {},
      choiceTakes: (req.body && req.body.choiceTakes) || []
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
