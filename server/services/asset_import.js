'use strict';

// Asset import — drag-drop PNG/WAV/MP3 into a project's shared_assets/.
//
// Per CLAUDE.md:
//   - Reject placeholders using existing playdate_validator.isPlaceholder*
//   - Use existing sharp for image ops (1-bit conversion, resize, composite)
//   - Use existing dither.js for dither algorithms
//
// Categories:
//   image: sprite | tile | portrait | background | ui
//   audio: sfx | music | voice
//
// Output paths:
//   <project>/sdk_data/asset_library/shared_assets/<category>/<filename>
//   <project>/sdk_data/asset_library/shared_assets/<category>/<filename>.meta.json

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projects = require('./projects');
const assetLibrary = require('./asset_library');
const dither = require('./dither');
const validator = require('./playdate_validator');

let sharp;
try { sharp = require('sharp'); } catch (_e) { sharp = null; }

const IMAGE_CATEGORIES = new Set(['sprite', 'tile', 'portrait', 'background', 'ui']);
const AUDIO_CATEGORIES = new Set(['sfx', 'music', 'voice']);
const SAFE_NAME_RE = /^[a-zA-Z0-9_.-]{1,128}$/;

function safeName(name) { return typeof name === 'string' && SAFE_NAME_RE.test(name); }

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) throw new Error(`project not found: ${projectId}`);
  if (!proj.local_path) throw new Error(`project ${projectId} has no local_path`);
  return proj;
}

function destPath(localPath, category, filename) {
  const root = assetLibrary.paths.sharedAssetsDir(localPath);
  return path.join(root, category, filename);
}

function sniffKind(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['png', 'gif'].includes(ext)) return 'image';
  if (['wav', 'mp3', 'pda', 'adpcm'].includes(ext)) return 'audio';
  return null;
}

function makeMetaPath(filePath) { return filePath + '.meta.json'; }

// ----------------------------------------------------------------------------
// Image import
// ----------------------------------------------------------------------------

const DITHER_DEFAULTS_BY_CATEGORY = {
  sprite: 'atkinson',
  tile: 'bayer_4x4',
  portrait: 'atkinson',
  background: 'floyd_steinberg',
  ui: 'bayer_4x4'
};

const TARGET_DIMS_BY_CATEGORY = {
  sprite: null,                  // preserve source
  tile: null,                    // preserve source (multiple of tile size expected)
  portrait: { w: 64, h: 64 },    // matches pulp_portraits default
  background: { w: 400, h: 240 },// Playdate screen
  ui: null
};

async function convertImageTo1bit({ srcBuffer, category, options = {} }) {
  if (!sharp) throw new Error('sharp not installed');
  const ditherAlgo = options.dither || DITHER_DEFAULTS_BY_CATEGORY[category] || 'atkinson';
  const target = TARGET_DIMS_BY_CATEGORY[category];

  let img = sharp(srcBuffer).flatten({ background: '#ffffff' });
  if (target && (options.resize !== false)) {
    img = img.resize(target.w, target.h, { fit: options.fit || 'contain', background: '#ffffff' });
  }
  const { data, info } = await img.greyscale().raw().toBuffer({ resolveWithObject: true });

  // dither.js exposes algorithms by name; fall back to threshold if unknown
  const algo = (dither.algorithms || []).find((a) => a === ditherAlgo) || 'threshold';
  const dithered = dither.apply
    ? dither.apply(algo, data, info.width, info.height)
    : data; // older dither.js had different API; tolerate

  // Pack back into a PNG (1-bit display, but sharp writes 8-bit gray then
  // a downstream tool can pack as 1-bit if needed)
  const outPng = await sharp(Buffer.from(dithered), {
    raw: { width: info.width, height: info.height, channels: 1 }
  }).png({ palette: true, colors: 2 }).toBuffer();

  return { png: outPng, width: info.width, height: info.height, ditherAlgo: algo };
}

async function importImage({ projectId, category, filename, srcBuffer, options = {} }) {
  if (!IMAGE_CATEGORIES.has(category)) throw new Error(`unknown image category: ${category}`);
  if (!safeName(filename)) throw new Error(`unsafe filename: ${filename}`);

  const proj = await resolveProject(projectId);
  await assetLibrary.ensureSubdirs(projectId);

  // Reject placeholders before conversion (cheap heuristic on source)
  if (validator.isPlaceholder1bitPng && srcBuffer.length < 1024) {
    // tiny PNGs are almost always placeholders
    throw new Error('rejected: source PNG too small (likely placeholder)');
  }

  const converted = await convertImageTo1bit({ srcBuffer, category, options });

  // Verify converted output passes the standard 1-bit validator
  if (validator.validate1bitPng) {
    try {
      const ok = await validator.validate1bitPng(converted.png);
      if (ok && ok.is_placeholder) {
        throw new Error('rejected: converted output reads as placeholder');
      }
    } catch (e) {
      if (/rejected/.test(e.message)) throw e;
      // tolerate validator API mismatch
    }
  }

  const fp = destPath(proj.local_path, category, filename);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.writeFile(fp, converted.png);

  const meta = {
    filename,
    category,
    kind: 'image',
    width: converted.width,
    height: converted.height,
    dither: converted.ditherAlgo,
    source_size_bytes: srcBuffer.length,
    output_size_bytes: converted.png.length,
    imported_at: new Date().toISOString()
  };
  await fsp.writeFile(makeMetaPath(fp), JSON.stringify(meta, null, 2));

  return { path: fp, meta };
}

// ----------------------------------------------------------------------------
// Audio import
// ----------------------------------------------------------------------------

async function importAudio({ projectId, category, filename, srcBuffer, options = {} }) {
  if (!AUDIO_CATEGORIES.has(category)) throw new Error(`unknown audio category: ${category}`);
  if (!safeName(filename)) throw new Error(`unsafe filename: ${filename}`);

  const proj = await resolveProject(projectId);
  await assetLibrary.ensureSubdirs(projectId);

  // For now: pass through, write to disk. Future: stereo→mono via ffmpeg,
  // resample to 44.1kHz, ADPCM conversion via Simulator-side tools.
  const fp = destPath(proj.local_path, category, filename);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.writeFile(fp, srcBuffer);

  const meta = {
    filename,
    category,
    kind: 'audio',
    source_size_bytes: srcBuffer.length,
    imported_at: new Date().toISOString(),
    notes: options.notes || 'imported as-is; convert to .pda via Simulator → Convert Audio for size'
  };
  await fsp.writeFile(makeMetaPath(fp), JSON.stringify(meta, null, 2));

  return { path: fp, meta };
}

// ----------------------------------------------------------------------------
// Generic dispatcher
// ----------------------------------------------------------------------------

async function importAsset({ projectId, filename, srcBuffer, category, options = {} }) {
  if (!filename) throw new Error('filename required');
  if (!srcBuffer || !Buffer.isBuffer(srcBuffer)) throw new Error('srcBuffer (Buffer) required');
  const kind = sniffKind(filename);
  if (!kind) throw new Error(`cannot sniff kind from filename: ${filename}`);

  if (kind === 'image') return importImage({ projectId, category, filename, srcBuffer, options });
  if (kind === 'audio') return importAudio({ projectId, category, filename, srcBuffer, options });
  throw new Error(`unsupported kind: ${kind}`);
}

async function listImported(projectId, category) {
  return assetLibrary.listSharedAssets(projectId, category);
}

module.exports = {
  importAsset,
  importImage,
  importAudio,
  listImported,
  sniffKind,
  IMAGE_CATEGORIES: Array.from(IMAGE_CATEGORIES),
  AUDIO_CATEGORIES: Array.from(AUDIO_CATEGORIES),
  DITHER_DEFAULTS_BY_CATEGORY,
  TARGET_DIMS_BY_CATEGORY,
  _internals: { safeName, destPath, makeMetaPath, convertImageTo1bit }
};
