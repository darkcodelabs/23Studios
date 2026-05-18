'use strict';

const express = require('express');
const styleAxis = require('../services/style_axis');
const stylePreview = require('../services/style_preview');
const presetPacks = require('../services/preset_packs');
const intakeForm = require('../services/intake_form');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

// GET /api/styles/axes — list all axis configs
router.get('/styles/axes', async (_req, res) => {
  try {
    const out = await styleAxis.listAxes();
    res.json({ axes: out });
  } catch (e) { sendErr(res, e); }
});

// GET /api/styles/axes/:axisId — single axis config
router.get('/styles/axes/:axisId', async (req, res) => {
  try {
    const cfg = await styleAxis.loadAxis(req.params.axisId);
    res.json({ axis: cfg });
  } catch (e) { sendErr(res, e, 404); }
});

// GET /api/styles/preset-packs — list all preset packs
router.get('/styles/preset-packs', async (_req, res) => {
  try {
    const packs = await presetPacks.listPacks();
    res.json({ packs });
  } catch (e) { sendErr(res, e); }
});

// GET /api/styles/preset-packs/:packId — full pack JSON
router.get('/styles/preset-packs/:packId', async (req, res) => {
  try {
    const pack = await presetPacks.loadPack(req.params.packId);
    res.json({ pack });
  } catch (e) { sendErr(res, e, 404); }
});

// POST /api/projects/:id/styles/:axisId/generate
//   body: { count?, styleGuide?, priorPicks? }
router.post('/projects/:id/styles/:axisId/generate', async (req, res) => {
  try {
    const opts = await styleAxis.generateOptions({
      axisId: req.params.axisId,
      projectId: req.params.id,
      styleGuide: req.body && req.body.styleGuide,
      priorPicks: req.body && req.body.priorPicks,
      count: req.body && req.body.count
    });
    res.json({ options: opts });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/styles/:axisId/options — list stored options
router.get('/projects/:id/styles/:axisId/options', async (req, res) => {
  try {
    const opts = await styleAxis.listLibrary({
      axisId: req.params.axisId,
      scope: 'project',
      projectId: req.params.id
    });
    res.json({ options: opts });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/styles/:axisId/pick  body: { optionId }
router.post('/projects/:id/styles/:axisId/pick', async (req, res) => {
  try {
    const optionId = (req.body && req.body.optionId) || '';
    const out = await styleAxis.pickOption({
      axisId: req.params.axisId,
      projectId: req.params.id,
      optionId
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/styles/:axisId/refine  body: { optionId, feedback }
router.post('/projects/:id/styles/:axisId/refine', async (req, res) => {
  try {
    const refined = await styleAxis.refineOption({
      axisId: req.params.axisId,
      projectId: req.params.id,
      optionId: (req.body && req.body.optionId) || '',
      feedback: (req.body && req.body.feedback) || ''
    });
    res.json({ option: refined });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/styles/:axisId/flag-for-reuse  body: { optionId }
router.post('/projects/:id/styles/:axisId/flag-for-reuse', async (req, res) => {
  try {
    const opt = await styleAxis.flagForReuse({
      axisId: req.params.axisId,
      projectId: req.params.id,
      optionId: (req.body && req.body.optionId) || ''
    });
    res.json({ option: opt });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/styles/:axisId/preview  body: { optionId }
router.post('/projects/:id/styles/:axisId/preview', async (req, res) => {
  try {
    const opt = await stylePreview.renderPreview({
      projectId: req.params.id,
      axisId: req.params.axisId,
      optionId: (req.body && req.body.optionId) || ''
    });
    res.json({ option: opt });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/styles/from-intake — seed defaults from intake form
router.post('/projects/:id/styles/from-intake', async (req, res) => {
  try {
    const intake = (req.body && req.body.intake) || {};
    const seeds = intakeForm.mapIntakeToAxisDefaults(intake);
    res.json({ seeds });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
