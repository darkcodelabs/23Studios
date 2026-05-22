'use strict';

// Gallery routes (Phase 4.5 Patch A).
//
// Mounted under /api/projects so paths read as:
//   GET    /api/projects/:id/gallery
//   GET    /api/projects/:id/gallery/assets/:assetId
//   POST   /api/projects/:id/gallery/assets/:assetId/approve
//   POST   /api/projects/:id/gallery/assets/:assetId/reject       body: { reason? }
//   POST   /api/projects/:id/gallery/assets/:assetId/regen        body: { promptOverride?, modelOverride?, referenceImages?, ditherAlgo? }
//
// :assetId contains a colon ("scene:title_dial_tone"). Express decodes
// req.params for us; we just need to be tolerant if the client encoded it.
//
// Style mirrors routes/references.js: validateId guard, sendErr helper,
// inline express.json on POST endpoints with a tight limit.

const express = require('express');
const gallery = require('../services/gallery');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e) {
  const status = e && e.status ? e.status : 500;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message
  });
}

function decodeAssetId(raw) {
  if (typeof raw !== 'string') return null;
  // Express already URL-decodes; but if a client double-encoded a colon
  // (e.g. "scene%3Atitle_dial_tone"), try one more decode pass.
  if (!raw.includes(':') && raw.includes('%3A')) {
    try { return decodeURIComponent(raw); } catch (_e) { return raw; }
  }
  return raw;
}

// GET /api/projects/:id/gallery
router.get('/:id/gallery', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const data = await gallery.listAssets(req.params.id);
    res.json(data);
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/gallery/assets/:assetId
router.get('/:id/gallery/assets/:assetId', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const assetId = decodeAssetId(req.params.assetId);
  try {
    const asset = await gallery.getAsset(req.params.id, assetId);
    res.json({ asset });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/gallery/assets/:assetId/approve
router.post('/:id/gallery/assets/:assetId/approve',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const assetId = decodeAssetId(req.params.assetId);
    try {
      const asset = await gallery.setAssetState(req.params.id, assetId, 'approved');
      res.json({ asset });
    } catch (e) { sendErr(res, e); }
  }
);

// POST /api/projects/:id/gallery/assets/:assetId/reject — body: { reason? }
router.post('/:id/gallery/assets/:assetId/reject',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const assetId = decodeAssetId(req.params.assetId);
    const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason : undefined;
    try {
      const asset = await gallery.setAssetState(req.params.id, assetId, 'rejected', { reason });
      res.json({ asset });
    } catch (e) { sendErr(res, e); }
  }
);

// PUT /api/projects/:id/gallery/assets/:assetId/prompt
//   body: { prompt, model?, ditherAlgo?, referenceImages? }
//
// Edits the prompt sidecar in-place without re-running pulp_ai. Backs the
// Scene Editor "Save (no regen)" button. Preserves dim + stage + createdAt;
// bumps updatedAt. Returns the merged asset object so the caller can patch
// local state without a follow-up GET.
router.put('/:id/gallery/assets/:assetId/prompt',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const assetId = decodeAssetId(req.params.assetId);
    const body = req.body || {};
    // Caller must supply at least one of the whitelisted fields. Reject an
    // empty body early so we don't bump updatedAt for nothing.
    const fields = {};
    if (typeof body.prompt === 'string')          fields.prompt = body.prompt;
    if (typeof body.model === 'string' || body.model === null)
      fields.model = body.model;
    if (typeof body.ditherAlgo === 'string' || body.ditherAlgo === null)
      fields.ditherAlgo = body.ditherAlgo;
    if (Array.isArray(body.referenceImages))      fields.referenceImages = body.referenceImages;
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({
        error: 'bad_request',
        detail: 'body must include at least one of: prompt, model, ditherAlgo, referenceImages'
      });
    }
    try {
      const asset = await gallery.updateAssetSidecar(req.params.id, assetId, fields);
      res.json({ asset });
    } catch (e) { sendErr(res, e); }
  }
);

// POST /api/projects/:id/gallery/assets/:assetId/regen
//   body: { promptOverride?, modelOverride?, referenceImages?, ditherAlgo? }
//
// Synchronous: holds the HTTP connection open for up to 60s while pulp_ai
// regenerates. Frontend shows a spinner. Per spec line 118 default.
router.post('/:id/gallery/assets/:assetId/regen',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const assetId = decodeAssetId(req.params.assetId);
    const body = req.body || {};
    const overrides = {
      promptOverride: typeof body.promptOverride === 'string' ? body.promptOverride : null,
      modelOverride: typeof body.modelOverride === 'string' ? body.modelOverride : null,
      referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages : [],
      ditherAlgo: typeof body.ditherAlgo === 'string' ? body.ditherAlgo : null
    };
    try {
      const asset = await gallery.regenAsset(req.params.id, assetId, overrides);
      res.json({ asset });
    } catch (e) { sendErr(res, e); }
  }
);

module.exports = router;
