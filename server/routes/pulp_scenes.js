'use strict';

const express = require('express');
const multer = require('multer');

const scenes = require('../services/pulp_scenes');
const pulp = require('../services/pulp_project');

const router = express.Router({ mergeParams: true });

// ----- multer (in-memory; 8 MB / file, ≤24 files for bulk import) -----

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: scenes.MAX_FILE_BYTES, files: 1 }
}).single('file');

const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: scenes.MAX_FILE_BYTES, files: scenes.MAX_IMPORT_FILES }
}).array('files', scenes.MAX_IMPORT_FILES);

// ----- helpers -----

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp_scenes]', id, e && (e.code || e.message) || 'unknown');
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

function safeRidOrSend(req, res) {
  try { return scenes.validateSafeRid(req.params.rid); }
  catch (e) { sendErr(res, e); return null; }
}

function buildSceneUrl(projectId, rid) {
  return '/api/projects/' + encodeURIComponent(projectId)
    + '/pulp/rooms/' + encodeURIComponent(rid) + '/scene';
}

// Pulls dither opts out of either multipart form fields or a JSON body.
// scenes.normalizeOpts() handles validation + clamping; we just forward.
function readOpts(req) {
  const src = (req.body && typeof req.body === 'object') ? req.body : {};
  return {
    dither: src.dither,
    threshold: src.threshold,
    contrast: src.contrast,
    brightness: src.brightness,
    fit: src.fit
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

// ===== POST /:id/pulp/rooms/:rid/scene  (upload) =====

router.post(
  '/:id/pulp/rooms/:rid/scene',
  wrapMulter(singleUpload),
  async (req, res) => {
    try {
      const safeRid = safeRidOrSend(req, res);
      if (!safeRid) return;
      // Force project type check up front.
      await scenes.loadProjectOrThrow(req.params.id);

      const f = req.file;
      if (!f) return res.status(400).json({ error: 'no_file' });
      const reason = checkImage(f);
      if (reason) return res.status(400).json({ error: reason });

      const opts = readOpts(req);
      const origExt = scenes.safeOrigExt(f.originalname) || '.png';

      const { pngBuffer, dim, srcDim, opts: normalizedOpts } =
        await scenes.convertScene(f.buffer, opts);

      const scene_meta = {
        ...normalizedOpts,
        src_dim: srcDim,
        src_ext: origExt,
        processed_at_ts: Date.now()
      };

      const persisted = await scenes.saveSceneAndPatchRoom(
        req.params.id, safeRid, pngBuffer, scene_meta,
        { buffer: f.buffer, ext: origExt }
      );

      // eslint-disable-next-line no-console
      console.log('[pulp_scenes] upload', req.params.id, safeRid,
        'alg=' + normalizedOpts.dither,
        'dim=' + dim.join('x'),
        'in=' + f.size + 'B',
        'out=' + persisted.size_bytes + 'B');

      res.json({
        url: buildSceneUrl(req.params.id, safeRid),
        size_bytes: persisted.size_bytes,
        dim,
        scene_meta
      });
    } catch (e) { sendErr(res, e); }
  }
);

// ===== GET /:id/pulp/rooms/:rid/scene  (binary PNG) =====
//
// Adds a weak ETag derived from the file mtime so browsers can revalidate
// cleanly after a reprocess. Cache-Control stays `no-cache` (the client must
// revalidate every load, but a 304 short-circuits the body transfer).

router.get('/:id/pulp/rooms/:rid/scene', async (req, res) => {
  try {
    const safeRid = safeRidOrSend(req, res);
    if (!safeRid) return;
    const project = await scenes.loadProjectOrThrow(req.params.id);
    const got = await scenes.readScenePng(project, safeRid);
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

// ===== GET /:id/pulp/rooms/:rid/scene/original =====

router.get('/:id/pulp/rooms/:rid/scene/original', async (req, res) => {
  try {
    const safeRid = safeRidOrSend(req, res);
    if (!safeRid) return;
    const project = await scenes.loadProjectOrThrow(req.params.id);
    const got = await scenes.readSceneOriginal(project, safeRid);
    if (!got) return res.status(404).json({ error: 'not_found' });
    const mime = MIME_BY_EXT[got.ext] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', got.buf.length);
    res.status(200).end(got.buf);
  } catch (e) { sendErr(res, e); }
});

// ===== POST /:id/pulp/rooms/:rid/scene/reprocess =====

router.post(
  '/:id/pulp/rooms/:rid/scene/reprocess',
  express.json({ limit: '8kb' }),
  async (req, res) => {
    try {
      const safeRid = safeRidOrSend(req, res);
      if (!safeRid) return;
      await scenes.loadProjectOrThrow(req.params.id);

      const opts = readOpts(req);
      const out = await scenes.reprocessScene(req.params.id, safeRid, opts);

      // eslint-disable-next-line no-console
      console.log('[pulp_scenes] reprocess', req.params.id, safeRid,
        'alg=' + out.scene_meta.dither,
        'dim=' + out.dim.join('x'),
        'out=' + out.size_bytes + 'B');

      res.json({
        url: buildSceneUrl(req.params.id, safeRid),
        size_bytes: out.size_bytes,
        dim: out.dim,
        scene_meta: out.scene_meta
      });
    } catch (e) { sendErr(res, e); }
  }
);

// ===== POST /:id/pulp/rooms/:rid/scene/generate =====

router.post(
  '/:id/pulp/rooms/:rid/scene/generate',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    try {
      const safeRid = safeRidOrSend(req, res);
      if (!safeRid) return;
      await scenes.loadProjectOrThrow(req.params.id);

      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const model = typeof body.model === 'string' ? body.model : '';
      // style currently merged into prompt by the caller; reserved for parity
      // with /ai/tile-art. Accept it but no-op if blank.
      if (!prompt.trim()) {
        return res.status(400).json({ error: 'bad_request', detail: 'prompt required' });
      }

      const opts = readOpts(req);
      const out = await scenes.generateAndSaveScene({
        projectId: req.params.id,
        safeRid,
        prompt,
        model,
        opts
      });

      // eslint-disable-next-line no-console
      console.log('[pulp_scenes] generate', req.params.id, safeRid,
        'model=' + (out.model || '?'),
        'alg=' + (out.scene_meta && out.scene_meta.dither),
        'fallback=' + !!out.fallback,
        'out=' + out.size_bytes + 'B');

      const resp = {
        url: buildSceneUrl(req.params.id, safeRid),
        size_bytes: out.size_bytes,
        dim: out.dim,
        prompt: out.prompt,
        model: out.model,
        scene_meta: out.scene_meta
      };
      if (out.fallback) resp.fallback = true;
      res.json(resp);
    } catch (e) { sendErr(res, e); }
  }
);

// ===== POST /:id/pulp/import-scenes  (bulk, mode=auto|manual) =====

router.post(
  '/:id/pulp/import-scenes',
  wrapMulter(bulkUpload),
  async (req, res) => {
    try {
      await scenes.loadProjectOrThrow(req.params.id);

      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'no_files' });
      }
      const mode = (req.body && req.body.mode === 'manual') ? 'manual' : 'auto';

      // Read shared opts once — applies to every file in this batch.
      const sharedOpts = readOpts(req);

      // Need the current room id list for heuristics.
      const { project: state } = await pulp.readPulp(req.params.id);
      const roomIds = (state.rooms || [])
        .map((r) => r && r.id)
        .filter((r) => typeof r === 'string' && r);

      const assigned = [];
      const skipped = [];

      for (const f of files) {
        const filename = (f && f.originalname) || '';
        const reason = checkImage(f);
        if (reason) {
          skipped.push({ filename, reason });
          continue;
        }

        let safeRid = null;
        if (mode === 'auto') {
          safeRid = scenes.matchRoomIdByFilename(filename, roomIds);
          if (!safeRid) {
            skipped.push({ filename, reason: 'no_room_match' });
            continue;
          }
        } else {
          // manual mode: expect mapping[<filename>] field in form body.
          const mapping = (req.body && req.body.mapping) || {};
          let candidate = '';
          if (typeof mapping === 'string') {
            try { candidate = JSON.parse(mapping)[filename] || ''; }
            catch (_e) { candidate = ''; }
          } else {
            candidate = mapping[filename] || '';
          }
          if (!candidate) {
            skipped.push({ filename, reason: 'no_room_id_supplied' });
            continue;
          }
          safeRid = candidate;
        }

        try {
          scenes.validateSafeRid(safeRid);
        } catch (_e) {
          skipped.push({ filename, reason: 'bad_room_id' });
          continue;
        }
        if (!roomIds.includes(safeRid)) {
          skipped.push({ filename, reason: 'room_not_found' });
          continue;
        }

        try {
          const origExt = scenes.safeOrigExt(filename) || '.png';
          const { pngBuffer, dim, srcDim, opts: normalizedOpts } =
            await scenes.convertScene(f.buffer, sharedOpts);
          const scene_meta = {
            ...normalizedOpts,
            src_dim: srcDim,
            src_ext: origExt,
            processed_at_ts: Date.now()
          };
          const persisted = await scenes.saveSceneAndPatchRoom(
            req.params.id, safeRid, pngBuffer, scene_meta,
            { buffer: f.buffer, ext: origExt }
          );
          assigned.push({
            room_id: safeRid,
            path: persisted.rel,
            dim,
            size_bytes: persisted.size_bytes,
            scene_meta
          });
        } catch (e) {
          const code = (e && e.code) || 'conversion_failed';
          // eslint-disable-next-line no-console
          console.warn('[pulp_scenes] import conv fail',
            filename, code);
          skipped.push({ filename, reason: code });
        }
      }

      res.json({
        assigned,
        skipped,
        stats: {
          total: files.length,
          assigned: assigned.length,
          skipped: skipped.length,
          mode
        }
      });
    } catch (e) { sendErr(res, e); }
  }
);

module.exports = router;
