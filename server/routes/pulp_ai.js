'use strict';

const express = require('express');

const ai = require('../services/pulp_ai');

const router = express.Router({ mergeParams: true });

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp_ai]', id, e && (e.code || e.message) || 'unknown');
  return res.status(fallback).json({ error: 'server_error', id });
}

router.post('/:id/pulp/ai/tile-art', async (req, res) => {
  try {
    const body = req.body || {};
    const out = await ai.generateTileArt({
      projectId: req.params.id,
      prompt: body.prompt,
      model: body.model,
      style: body.style
    });
    // Contract: image_base64, model, prompt, cost?
    const resp = {
      image_base64: out.image_base64,
      model: out.model,
      prompt: out.prompt
    };
    if (out.fallback) resp.fallback = true;
    res.json(resp);
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/pulp/ai/script', async (req, res) => {
  try {
    const body = req.body || {};
    const out = await ai.generateScript({
      projectId: req.params.id,
      context: body.context,
      prompt: body.prompt
    });
    res.json({ script: out.script, explanation: out.explanation });
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/pulp/ai/room-layout', async (req, res) => {
  try {
    const body = req.body || {};
    const out = await ai.generateRoomLayout({
      projectId: req.params.id,
      prompt: body.prompt,
      available_tile_ids: body.available_tile_ids
    });
    res.json({ grid: out.grid, explanation: out.explanation });
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/pulp/ai/sound', async (req, res) => {
  try {
    const body = req.body || {};
    const out = await ai.generateSound({
      projectId: req.params.id,
      prompt: body.prompt
    });
    res.json({
      waveform: out.waveform,
      freq_start: out.freq_start,
      freq_end: out.freq_end,
      duration_ms: out.duration_ms,
      envelope: out.envelope,
      explanation: out.explanation
    });
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/pulp/ai/log', async (req, res) => {
  try {
    const out = await ai.getLog(req.params.id);
    res.json({ entries: out.entries });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
