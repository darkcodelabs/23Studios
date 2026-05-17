'use strict';

const fsp = require('fs/promises');
const path = require('path');

const express = require('express');
const multer = require('multer');

const assets = require('../services/pulp_assets');

// Re-use the existing AI image-gen flow for the "generate launcher card" route.
// pulp_ai exposes generateTileArt which already handles OPENROUTER_API_KEY-missing
// fallback. We post-process its PNG into a 350x155 1-bit launcher card.
const pulpAi = require('../services/pulp_ai');

const router = express.Router({ mergeParams: true });

// ----- multer (in-memory, hard limits) -----

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

const tileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 32 }
}).array('files', 32);

const soundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 16 }
}).array('files', 16);

const cardUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 }
}).single('file');

// ----- error helpers -----

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp_assets]', id, e && (e.code || e.message) || 'unknown');
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

// ----- filename-type guards -----

const IMAGE_MIME_RE = /^image\//i;
const AUDIO_MIME_RE = /^audio\//i;
const AUDIO_EXT_RE = /\.(wav|mp3|ogg)$/i;

function checkImage(file) {
  if (!file || !file.originalname) return 'bad_filename';
  try { assets.rejectUnsafeFilename(file.originalname); }
  catch (_e) { return 'bad_filename'; }
  if (!file.mimetype || !IMAGE_MIME_RE.test(file.mimetype)) return 'not_image';
  return null;
}

function checkAudio(file) {
  if (!file || !file.originalname) return 'bad_filename';
  try { assets.rejectUnsafeFilename(file.originalname); }
  catch (_e) { return 'bad_filename'; }
  const okMime = file.mimetype && AUDIO_MIME_RE.test(file.mimetype);
  const okExt = AUDIO_EXT_RE.test(file.originalname);
  if (!okMime && !okExt) return 'not_audio';
  return null;
}

// ===== POST /import-tiles =====

router.post(
  '/:id/pulp/import-tiles',
  wrapMulter(tileUpload),
  async (req, res) => {
    try {
      await assets.loadProjectOrThrow(req.params.id);

      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'no_files' });
      }

      const type = assets.normalizeTileType(req.body && req.body.type);
      const solid = assets.normalizeSolidFlag(req.body && req.body.solid);

      const tiles = [];
      const skipped = [];
      const seenIds = new Set();

      for (const f of files) {
        const sizeNote = `${f.originalname || '?'} (${f.size || 0}B)`;
        const reason = checkImage(f);
        if (reason) {
          // eslint-disable-next-line no-console
          console.warn('[pulp_assets] skip tile', sizeNote, reason);
          skipped.push({ filename: f.originalname || '', reason });
          continue;
        }
        try {
          const tile = await assets.buildTileFromFile({
            buffer: f.buffer,
            originalName: f.originalname,
            type,
            solid
          });
          if (seenIds.has(tile.id)) {
            skipped.push({ filename: f.originalname, reason: 'duplicate_id' });
            continue;
          }
          seenIds.add(tile.id);
          tiles.push(tile);
        } catch (e) {
          const code = (e && e.code) || 'conversion_failed';
          // eslint-disable-next-line no-console
          console.warn('[pulp_assets] tile conv fail', sizeNote, code);
          skipped.push({ filename: f.originalname, reason: code });
        }
      }

      res.json({ tiles, skipped });
    } catch (e) { sendErr(res, e); }
  }
);

// ===== POST /import-sounds =====

router.post(
  '/:id/pulp/import-sounds',
  wrapMulter(soundUpload),
  async (req, res) => {
    try {
      await assets.loadProjectOrThrow(req.params.id);

      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'no_files' });
      }

      const sounds = [];
      const skipped = [];
      const seenIds = new Set();

      for (const f of files) {
        const sizeNote = `${f.originalname || '?'} (${f.size || 0}B)`;
        const reason = checkAudio(f);
        if (reason) {
          // eslint-disable-next-line no-console
          console.warn('[pulp_assets] skip sound', sizeNote, reason);
          skipped.push({ filename: f.originalname || '', reason });
          continue;
        }
        try {
          const sound = await assets.buildSoundFromFile({
            buffer: f.buffer,
            originalName: f.originalname
          });
          if (seenIds.has(sound.id)) {
            skipped.push({ filename: f.originalname, reason: 'duplicate_id' });
            continue;
          }
          seenIds.add(sound.id);
          sounds.push(sound);
        } catch (e) {
          const code = (e && e.code) || 'conversion_failed';
          // eslint-disable-next-line no-console
          console.warn('[pulp_assets] sound conv fail', sizeNote, code);
          skipped.push({ filename: f.originalname, reason: code });
        }
      }

      res.json({ sounds, skipped });
    } catch (e) { sendErr(res, e); }
  }
);

// ===== POST /launcher-card (upload) =====

router.post(
  '/:id/pulp/launcher-card',
  wrapMulter(cardUpload),
  async (req, res) => {
    try {
      const f = req.file;
      if (!f) return res.status(400).json({ error: 'no_file' });
      const reason = checkImage(f);
      if (reason) return res.status(400).json({ error: reason });

      const { pngBuffer, dim } = await assets.convertLauncherCard(f.buffer);
      const { size_bytes } = await assets.saveLauncherCard(req.params.id, pngBuffer);

      // eslint-disable-next-line no-console
      console.log('[pulp_assets] launcher-card', f.originalname, f.size, '->', size_bytes);

      res.json({
        url: `/api/projects/${encodeURIComponent(req.params.id)}/pulp/launcher-card`,
        size_bytes,
        dim
      });
    } catch (e) { sendErr(res, e); }
  }
);

// ===== GET /launcher-card =====

router.get('/:id/pulp/launcher-card', async (req, res) => {
  try {
    const project = await assets.loadProjectOrThrow(req.params.id);
    const file = assets.getLauncherCardPath(project);
    if (!file) return res.status(404).json({ error: 'not_found' });

    let stat;
    try { stat = await fsp.stat(file); }
    catch (e) {
      if (e && e.code === 'ENOENT') return res.status(404).json({ error: 'not_found' });
      throw e;
    }
    if (!stat.isFile()) return res.status(404).json({ error: 'not_found' });

    // Stream from disk; ensure we serve PNG only.
    const buf = await fsp.readFile(file);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buf.length);
    res.status(200).end(buf);
  } catch (e) { sendErr(res, e); }
});

// ===== POST /launcher-card/generate =====

router.post(
  '/:id/pulp/launcher-card/generate',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const model = typeof body.model === 'string' ? body.model : '';
      if (!prompt.trim()) {
        return res.status(400).json({ error: 'bad_request', detail: 'prompt required' });
      }

      // Augment with Playdate launcher prompt cues so generateTileArt still applies its
      // 1-bit pixel art style. The post-process re-renders to 350x155.
      const launcherPrompt =
        'Playdate game launcher card art, ' +
        '350x155 landscape, bold high-contrast 1-bit black-and-white, ' +
        'clean silhouette, no text, central iconic subject. ' +
        `Subject: ${prompt.trim()}`;

      // Delegate to existing generator (gives us a 16x16 1-bit base64 PNG OR fallback).
      // We upscale and re-threshold to the launcher dimensions.
      const gen = await pulpAi.generateTileArt({
        projectId: req.params.id,
        prompt: launcherPrompt,
        model
      });

      const baseBuf = Buffer.from(gen.image_base64, 'base64');
      const { pngBuffer, dim } = await assets.convertLauncherCard(baseBuf);
      const { size_bytes } = await assets.saveLauncherCard(req.params.id, pngBuffer);

      // eslint-disable-next-line no-console
      console.log('[pulp_assets] launcher-card generate model=' + (gen.model || '?')
        + ' fallback=' + !!gen.fallback + ' size=' + size_bytes);

      res.json({
        url: `/api/projects/${encodeURIComponent(req.params.id)}/pulp/launcher-card`,
        size_bytes,
        dim
      });
    } catch (e) { sendErr(res, e); }
  }
);

module.exports = router;
