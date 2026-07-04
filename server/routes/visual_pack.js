'use strict';

// Visual Pack Factory REST routes. Mount at /api/projects in index.js.
//
//   GET    /projects/:id/visual-pack/packs
//   POST   /projects/:id/visual-pack/packs                       init pack
//   POST   /projects/:id/visual-pack/packs/:packId/sources       add source (multipart or json)
//   GET    /projects/:id/visual-pack/packs/:packId/candidates
//   POST   /projects/:id/visual-pack/packs/:packId/candidates    ingest candidate (multipart)
//   POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/approve
//   POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/reject
//   POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/export
//   POST   /projects/:id/visual-pack/packs/:packId/candidates/:cid/hardware-review (multipart)
//   POST   /projects/:id/visual-pack/packs/:packId/queue
//   POST   /projects/:id/visual-pack/packs/:packId/contact-sheet
//   POST   /projects/:id/visual-pack/packs/:packId/reference-board
//   POST   /projects/:id/visual-pack/packs/:packId/extract-style
//   POST   /projects/:id/visual-pack/validate
//   POST   /projects/:id/visual-pack/spec
//   POST   /projects/:id/visual-pack/convert
//   GET    /projects/:id/visual-pack/asset (download by ?path=)

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const visualPack = require('../services/visual_pack');
const asepritePipeline = require('../services/aseprite_pipeline');
const { validateId } = require('../services/validation');

const router = express.Router();

// ---------- error helper ----------

function sendErr(res, e) {
  const status = (e && e.status) || 500;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null,
  });
}

function checkProject(req, res) {
  const err = validateId(req.params.id);
  if (err) {
    res.status(400).json({ error: 'bad_request', detail: err });
    return false;
  }
  return true;
}

// ---------- multer ----------

const upload10mb = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('file');

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('photo');

function wrapMulter(handler) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'too_many_files' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'unexpected_field' });
      }
      return sendErr(res, err);
    });
  };
}

// ---------- packs ----------

router.get('/projects/:id/visual-pack/packs', async (req, res) => {
  if (!checkProject(req, res)) return;
  try {
    const packs = await visualPack.listPacks(req.params.id);
    res.json({ packs });
  } catch (e) { sendErr(res, e); }
});

router.post('/projects/:id/visual-pack/packs',
  express.json({ limit: '8kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.initPack(req.params.id, req.body || {});
      res.status(201).json(out);
    } catch (e) { sendErr(res, e); }
  });

// ---------- sources ----------

router.post('/projects/:id/visual-pack/packs/:packId/sources',
  wrapMulter(upload10mb),
  express.json({ limit: '8kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.addSource(req.params.id, req.params.packId,
        req.body || {}, req.file || null);
      res.status(201).json(out);
    } catch (e) { sendErr(res, e); }
  });

// ---------- candidates ----------

router.get('/projects/:id/visual-pack/packs/:packId/candidates', async (req, res) => {
  if (!checkProject(req, res)) return;
  try {
    const items = await visualPack.listCandidates(req.params.id, req.params.packId);
    res.json({ items });
  } catch (e) { sendErr(res, e); }
});

router.post('/projects/:id/visual-pack/packs/:packId/candidates',
  wrapMulter(upload10mb),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.ingestCandidate(req.params.id, req.params.packId,
        req.body || {}, req.file || null);
      res.status(201).json(out);
    } catch (e) { sendErr(res, e); }
  });

// prompt→Aseprite generation: LLM writes a Lua script, aseprite -b executes
// it in a jail, artifacts are validated and ingested as candidates. Body:
// { prompt, spec: { name, kind, frameW, frameH, frames }, model? }
router.post('/projects/:id/visual-pack/packs/:packId/generate',
  express.json({ limit: '64kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const { prompt, spec, model } = req.body || {};
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'bad_request', detail: 'prompt required' });
      }
      if (!spec || !Number.isInteger(spec.frameW) || !Number.isInteger(spec.frameH)) {
        return res.status(400).json({ error: 'bad_request', detail: 'spec.frameW/frameH required' });
      }
      const out = await asepritePipeline.generateCandidate({
        projectId: req.params.id,
        packId: req.params.packId,
        prompt, spec, model,
      });
      res.status(201).json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/packs/:packId/candidates/:cid/approve',
  express.json({ limit: '8kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.approveCandidate(req.params.id, req.params.packId,
        req.params.cid, req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/packs/:packId/candidates/:cid/reject',
  express.json({ limit: '8kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.rejectCandidate(req.params.id, req.params.packId,
        req.params.cid, req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/packs/:packId/candidates/:cid/export',
  express.json({ limit: '8kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.exportCandidate(req.params.id, req.params.packId,
        req.params.cid, req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/packs/:packId/candidates/:cid/hardware-review',
  wrapMulter(uploadPhoto),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.recordHardwareReview(
        req.params.id, req.params.packId, req.params.cid,
        req.body || {}, req.file || null);
      res.status(201).json(out);
    } catch (e) { sendErr(res, e); }
  });

// ---------- pack-level ops ----------

router.post('/projects/:id/visual-pack/packs/:packId/queue',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.queueReview(req.params.id, req.params.packId, req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/packs/:packId/contact-sheet',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.buildContactSheet(req.params.id, req.params.packId,
        req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/packs/:packId/reference-board',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.buildReferenceBoard(req.params.id, req.params.packId,
        req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/packs/:packId/extract-style', async (req, res) => {
  if (!checkProject(req, res)) return;
  try {
    const out = await visualPack.extractStyleNotes(req.params.id, req.params.packId);
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// ---------- project-level ops ----------

router.post('/projects/:id/visual-pack/validate',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.validatePack(req.params.id, req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/spec',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.updateVisualSpec(req.params.id, req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

router.post('/projects/:id/visual-pack/convert',
  express.json({ limit: '4kb' }),
  async (req, res) => {
    if (!checkProject(req, res)) return;
    try {
      const out = await visualPack.convertToPlaydate(req.params.id, req.body || {});
      res.json(out);
    } catch (e) { sendErr(res, e); }
  });

// ---------- asset download (sandboxed) ----------

// GET /api/projects/:id/visual-pack/asset?path=<absolute>
// Strict: must resolve INSIDE PACKS_ROOT for this project. No traversal.
router.get('/projects/:id/visual-pack/asset', async (req, res) => {
  if (!checkProject(req, res)) return;
  const reqPath = String(req.query.path || '');
  if (!reqPath) return res.status(400).json({ error: 'path_required' });
  const resolved = path.resolve(reqPath);
  const projectRoot = path.resolve(visualPack.PACKS_ROOT, req.params.id);
  if (!resolved.startsWith(projectRoot + path.sep)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'not_found' });
  res.sendFile(resolved);
});

module.exports = router;
