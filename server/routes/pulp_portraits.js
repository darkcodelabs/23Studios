'use strict';

// pulp_portraits.js — character portrait endpoints (upload / generate /
// reprocess / GET) plus a small character CRUD surface so portraits have
// somewhere canonical to attach.
//
// Mirror of pulp_scenes routes; same shape, retargeted at Character + the
// portraits directory.

const express = require('express');
const multer = require('multer');

const portraits = require('../services/pulp_portraits');
const pulp = require('../services/pulp_project');

const router = express.Router({ mergeParams: true });

// ----- multer (in-memory; 8 MB / single file) -----

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: portraits.MAX_FILE_BYTES, files: 1 }
}).single('file');

// ----- helpers -----

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp_portraits]', id, e && (e.code || e.message) || 'unknown');
  return res.status(fallback).json({ error: 'server_error', id });
}

function wrapMulter(handler) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large' });
      }
      if (err && err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'too_many_files' });
      }
      if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'unexpected_field' });
      }
      return sendErr(res, err, 400);
    });
  };
}

const IMAGE_MIME_RE = /^image\//i;

function checkImage(file) {
  if (!file || !file.originalname) return 'bad_filename';
  if (typeof file.originalname !== 'string' || file.originalname.includes('\0')
      || file.originalname.includes('..')
      || file.originalname.includes('/')
      || file.originalname.includes('\\')) return 'bad_filename';
  if (!file.mimetype || !IMAGE_MIME_RE.test(file.mimetype)) return 'not_image';
  return null;
}

function safeCidOrSend(req, res) {
  try { return portraits.validateSafeCid(req.params.cid); }
  catch (e) { sendErr(res, e); return null; }
}

function buildPortraitUrl(projectId, cid) {
  return '/api/projects/' + encodeURIComponent(projectId)
    + '/pulp/characters/' + encodeURIComponent(cid) + '/portrait';
}

// Parse dither opts out of multipart form fields OR JSON body. dim can come
// as either an array (JSON body) or two scalar fields dim_w/dim_h (multipart),
// or a JSON-encoded "dim" string.
function readOpts(req) {
  const src = (req.body && typeof req.body === 'object') ? req.body : {};
  let dim = src.dim;
  if (typeof dim === 'string' && dim.length > 0) {
    try { dim = JSON.parse(dim); } catch (_e) { dim = undefined; }
  }
  if (!Array.isArray(dim)) {
    const w = parseInt(src.dim_w, 10);
    const h = parseInt(src.dim_h, 10);
    if (Number.isFinite(w) && Number.isFinite(h)) dim = [w, h];
  }
  return {
    dither: src.dither,
    threshold: src.threshold,
    contrast: src.contrast,
    brightness: src.brightness,
    fit: src.fit,
    dim
  };
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};

// ===== Character CRUD =====
//
// Co-located with portrait routes because Characters mostly exist to carry
// portraits; one router keeps the mount-list and call-site surface small.

router.get('/:id/pulp/characters', async (req, res) => {
  try {
    // Ensure project exists + is pulp; readPulp doesn't gate on game_type.
    await portraits.loadProjectOrThrow(req.params.id);
    const characters = await pulp.listCharacters(req.params.id);
    res.json({ characters });
  } catch (e) { sendErr(res, e); }
});

router.post(
  '/:id/pulp/characters',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    try {
      await portraits.loadProjectOrThrow(req.params.id);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const character = await pulp.createCharacter(req.params.id, body);
      res.status(201).json({ character });
    } catch (e) { sendErr(res, e); }
  }
);

router.patch(
  '/:id/pulp/characters/:cid',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    try {
      const safeCid = safeCidOrSend(req, res);
      if (!safeCid) return;
      await portraits.loadProjectOrThrow(req.params.id);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const character = await pulp.patchCharacter(req.params.id, safeCid, body);
      res.json({ character });
    } catch (e) { sendErr(res, e); }
  }
);

router.delete('/:id/pulp/characters/:cid', async (req, res) => {
  try {
    const safeCid = safeCidOrSend(req, res);
    if (!safeCid) return;
    await portraits.loadProjectOrThrow(req.params.id);
    await pulp.deleteCharacter(req.params.id, safeCid);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ===== POST /:id/pulp/characters/:cid/portrait  (upload) =====

router.post(
  '/:id/pulp/characters/:cid/portrait',
  wrapMulter(singleUpload),
  async (req, res) => {
    try {
      const safeCid = safeCidOrSend(req, res);
      if (!safeCid) return;
      await portraits.loadProjectOrThrow(req.params.id);

      const f = req.file;
      if (!f) return res.status(400).json({ error: 'no_file' });
      const reason = checkImage(f);
      if (reason) return res.status(400).json({ error: reason });

      const opts = readOpts(req);
      const origExt = portraits.safeOrigExt(f.originalname) || '.png';

      const { pngBuffer, dim, srcDim, opts: normalizedOpts } =
        await portraits.convertPortrait(f.buffer, opts);

      const portrait_meta = {
        dim,
        dither: normalizedOpts.dither,
        threshold: normalizedOpts.threshold,
        contrast: normalizedOpts.contrast,
        brightness: normalizedOpts.brightness,
        fit: normalizedOpts.fit,
        src_dim: srcDim,
        src_ext: origExt,
        processed_at_ts: Date.now()
      };

      const persisted = await portraits.savePortraitAndPatchCharacter(
        req.params.id, safeCid, pngBuffer, portrait_meta,
        { buffer: f.buffer, ext: origExt }
      );

      // eslint-disable-next-line no-console
      console.log('[pulp_portraits] upload', req.params.id, safeCid,
        'alg=' + normalizedOpts.dither,
        'dim=' + dim.join('x'),
        'in=' + f.size + 'B',
        'out=' + persisted.size_bytes + 'B');

      res.json({
        url: buildPortraitUrl(req.params.id, safeCid),
        size_bytes: persisted.size_bytes,
        dim,
        portrait_meta
      });
    } catch (e) { sendErr(res, e); }
  }
);

// ===== GET /:id/pulp/characters/:cid/portrait  (binary PNG) =====

router.get('/:id/pulp/characters/:cid/portrait', async (req, res) => {
  try {
    const safeCid = safeCidOrSend(req, res);
    if (!safeCid) return;
    const project = await portraits.loadProjectOrThrow(req.params.id);
    const got = await portraits.readPortraitPng(project, safeCid);
    if (!got) return res.status(404).json({ error: 'not_found' });
    const { buf, mtimeMs } = got;
    const etag = 'W/"' + Math.floor(mtimeMs).toString(36) + '-' + buf.length.toString(36) + '"';
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buf.length);
    res.status(200).end(buf);
  } catch (e) { sendErr(res, e); }
});

// ===== GET /:id/pulp/characters/:cid/portrait/original =====

router.get('/:id/pulp/characters/:cid/portrait/original', async (req, res) => {
  try {
    const safeCid = safeCidOrSend(req, res);
    if (!safeCid) return;
    const project = await portraits.loadProjectOrThrow(req.params.id);
    const got = await portraits.readPortraitOriginal(project, safeCid);
    if (!got) return res.status(404).json({ error: 'not_found' });
    const mime = MIME_BY_EXT[got.ext] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', got.buf.length);
    res.status(200).end(got.buf);
  } catch (e) { sendErr(res, e); }
});

// ===== POST /:id/pulp/characters/:cid/portrait/reprocess =====

router.post(
  '/:id/pulp/characters/:cid/portrait/reprocess',
  express.json({ limit: '8kb' }),
  async (req, res) => {
    try {
      const safeCid = safeCidOrSend(req, res);
      if (!safeCid) return;
      await portraits.loadProjectOrThrow(req.params.id);

      const opts = readOpts(req);
      const out = await portraits.reprocessPortrait(req.params.id, safeCid, opts);

      // eslint-disable-next-line no-console
      console.log('[pulp_portraits] reprocess', req.params.id, safeCid,
        'alg=' + out.portrait_meta.dither,
        'dim=' + out.dim.join('x'),
        'out=' + out.size_bytes + 'B');

      res.json({
        url: buildPortraitUrl(req.params.id, safeCid),
        size_bytes: out.size_bytes,
        dim: out.dim,
        portrait_meta: out.portrait_meta
      });
    } catch (e) { sendErr(res, e); }
  }
);

// ===== POST /:id/pulp/characters/:cid/portrait/generate =====

router.post(
  '/:id/pulp/characters/:cid/portrait/generate',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    try {
      const safeCid = safeCidOrSend(req, res);
      if (!safeCid) return;
      await portraits.loadProjectOrThrow(req.params.id);

      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const model = typeof body.model === 'string' ? body.model : '';
      if (!prompt.trim()) {
        return res.status(400).json({ error: 'bad_request', detail: 'prompt required' });
      }

      const opts = readOpts(req);
      const out = await portraits.generateAndSavePortrait({
        projectId: req.params.id,
        safeCid,
        prompt,
        model,
        opts
      });

      // eslint-disable-next-line no-console
      console.log('[pulp_portraits] generate', req.params.id, safeCid,
        'model=' + (out.model || '?'),
        'alg=' + (out.portrait_meta && out.portrait_meta.dither),
        'fallback=' + !!out.fallback,
        'out=' + out.size_bytes + 'B');

      const resp = {
        url: buildPortraitUrl(req.params.id, safeCid),
        size_bytes: out.size_bytes,
        dim: out.dim,
        prompt: out.prompt,
        model: out.model,
        portrait_meta: out.portrait_meta
      };
      if (out.fallback) resp.fallback = true;
      res.json(resp);
    } catch (e) { sendErr(res, e); }
  }
);

module.exports = router;
