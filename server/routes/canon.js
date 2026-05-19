'use strict';

const express = require('express');
const canon = require('../services/canon');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = (e && e.status) || fallback;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message
  });
}

// GET /api/projects/:id/canon
router.get('/projects/:id/canon', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const out = await canon.getCanon(req.params.id);
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/canon/usage
router.get('/projects/:id/canon/usage', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const out = await canon.getCanonUsage(req.params.id);
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/canon  { content, edit_note? }
router.post('/projects/:id/canon', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const body = req.body || {};
  try {
    const out = await canon.saveCanon(req.params.id, body.content, {
      edit_note: body.edit_note,
      actor: 'studio'
    });
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
