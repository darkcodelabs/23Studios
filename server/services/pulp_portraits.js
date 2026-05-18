'use strict';

// pulp_portraits.js — character portrait pipeline.
//
// Mirror of pulp_scenes.js, retargeted at the "character portrait" asset:
//   - default 64x64 1-bit PNG
//   - persisted at <local_path>/pulp_data/portraits/<cid>.png (mode 0o600)
//   - original source preserved as <cid>.orig.<ext> for re-dither
//   - patches the canonical top-level Character record on project.json with
//     `portrait_image` + `portrait_meta`.
//
// The dither pipeline is intentionally shared in spirit with pulp_scenes —
// same sharp -> greyscale -> brightness -> linear-contrast -> raw ->
// dither.dither() -> sharp.png() chain. We DID NOT export pulp_scenes'
// runDitherPipeline because it hard-codes SCENE_DIM (400x240) and we want
// per-axis clamp control for portraits without leaking portrait knobs into
// the scene service.

const fsp = require('fs/promises');
const path = require('path');

const sharp = require('sharp');

const projects = require('./projects');
const pulp = require('./pulp_project');
const pulpAi = require('./pulp_ai');
const dither = require('./dither');

// ----- Errors -----

function portraitErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

// ----- Layout / constants -----

const PULP_DIR_NAME = 'pulp_data';
const PORTRAITS_DIR_NAME = 'portraits';
const PORTRAIT_DIM_DEFAULT = [64, 64];
const PORTRAIT_DIM_MIN = 32;
// Bump the upper bound so the HAKCD body sprite preset (64x96) fits without
// asking callers to override clampDim. The biggest legitimate Playdate
// character sprite anyone actually ships is ~128x128, so 256 leaves headroom
// for the body sprite + future 96x128 / 128x128 variants.
const PORTRAIT_DIM_MAX = 256;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

// Fix #6: documented presets. Callers pass preset:'body' to get a 5-frame
// 64x96 HAKCD-style body sprite (default 'portrait' = 64x64 square bust).
const PORTRAIT_PRESETS = Object.freeze({
  portrait: { dim: [64, 64] },
  body: { dim: [64, 96] }
});

function normalizePreset(v) {
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(PORTRAIT_PRESETS, v)) {
    return v;
  }
  return 'portrait';
}

const VALID_DITHER = new Set(['atkinson', 'floyd', 'bayer4', 'ordered8', 'threshold']);
const VALID_FIT = new Set(['cover', 'contain', 'fill']);
// Spec Section 7 / Fix #4: portraits default to Bayer 4x4 (face legibility
// at 64x64 is destroyed by Atkinson/Floyd error diffusion).
const DEFAULT_OPTS = Object.freeze({
  dither: 'bayer4',
  threshold: 128,
  contrast: 1.0,
  brightness: 0,
  fit: 'cover'
});

const SAFE_CID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

const ALLOWED_ORIG_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'
]);

function validateSafeCid(cid) {
  if (typeof cid !== 'string' || !SAFE_CID_RE.test(cid)) {
    throw portraitErr(400, 'bad_character_id');
  }
  return cid;
}

function clampDim(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(PORTRAIT_DIM_MIN, Math.min(PORTRAIT_DIM_MAX, n));
}

function normalizeDim(raw, presetDim) {
  if (Array.isArray(raw) && raw.length === 2) {
    return [
      clampDim(raw[0], (presetDim && presetDim[0]) || PORTRAIT_DIM_DEFAULT[0]),
      clampDim(raw[1], (presetDim && presetDim[1]) || PORTRAIT_DIM_DEFAULT[1])
    ];
  }
  if (Array.isArray(presetDim) && presetDim.length === 2) {
    return [...presetDim];
  }
  return [...PORTRAIT_DIM_DEFAULT];
}

// Coerce + clamp options. Always returns a fully-populated opts object;
// missing fields fall back to DEFAULT_OPTS. `dim` is folded in here so the
// pipeline only needs one argument.
function normalizeOpts(input) {
  const raw = (input && typeof input === 'object') ? input : {};
  const out = { ...DEFAULT_OPTS };

  if (typeof raw.dither === 'string' && VALID_DITHER.has(raw.dither)) {
    out.dither = raw.dither;
  }
  if (raw.threshold !== undefined && raw.threshold !== null && raw.threshold !== '') {
    const n = parseInt(raw.threshold, 10);
    if (Number.isFinite(n)) out.threshold = Math.max(0, Math.min(255, n));
  }
  if (raw.contrast !== undefined && raw.contrast !== null && raw.contrast !== '') {
    const f = parseFloat(raw.contrast);
    if (Number.isFinite(f)) out.contrast = Math.max(0.5, Math.min(2.0, f));
  }
  if (raw.brightness !== undefined && raw.brightness !== null && raw.brightness !== '') {
    const n = parseInt(raw.brightness, 10);
    if (Number.isFinite(n)) out.brightness = Math.max(-100, Math.min(100, n));
  }
  if (typeof raw.fit === 'string' && VALID_FIT.has(raw.fit)) {
    out.fit = raw.fit;
  }
  // Fix #6: preset selects a default dim when caller doesn't pass an
  // explicit dim. preset='body' -> [64, 96]; preset='portrait' -> [64, 64].
  const preset = normalizePreset(raw.preset);
  const presetDim = PORTRAIT_PRESETS[preset].dim;
  out.preset = preset;
  out.dim = normalizeDim(raw.dim, presetDim);
  return out;
}

function safeOrigExt(filename) {
  if (typeof filename !== 'string' || filename.length === 0) return '';
  if (filename.includes('\0') || filename.includes('..')
      || filename.includes('/') || filename.includes('\\')) return '';
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  const ext = filename.slice(idx).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return '';
  if (!ALLOWED_ORIG_EXTS.has(ext)) return '';
  return ext;
}

// ----- Project / path helpers -----

async function loadProjectOrThrow(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) throw portraitErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw portraitErr(400, 'not_pulp_project');
  return project;
}

async function realDir(p) {
  try {
    const real = await fsp.realpath(p);
    const st = await fsp.lstat(real);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return real;
  } catch (_e) { return null; }
}

async function pulpDirFor(project) {
  if (!project || !project.local_path || !path.isAbsolute(project.local_path)) {
    throw portraitErr(400, 'local_path_missing');
  }
  const baseReal = await realDir(project.local_path);
  if (!baseReal) throw portraitErr(400, 'local_path_missing');
  const dir = path.join(baseReal, PULP_DIR_NAME);
  try { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); }
  catch (_e) { /* best-effort */ }
  const dirReal = await realDir(dir);
  if (!dirReal) throw portraitErr(400, 'pulp_dir_invalid');
  if (dirReal !== path.join(baseReal, PULP_DIR_NAME)) {
    throw portraitErr(400, 'pulp_dir_outside_project');
  }
  return dirReal;
}

async function portraitsDirFor(project) {
  const base = await pulpDirFor(project);
  const dir = path.join(base, PORTRAITS_DIR_NAME);
  try { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); }
  catch (_e) { /* best-effort */ }
  const real = await realDir(dir);
  if (!real) throw portraitErr(400, 'portraits_dir_invalid');
  if (real !== path.join(base, PORTRAITS_DIR_NAME)) {
    throw portraitErr(400, 'portraits_dir_outside_project');
  }
  return real;
}

function portraitPathFor(dir, safeCid) {
  return path.join(dir, `${safeCid}.png`);
}

function origPathFor(dir, safeCid, ext) {
  return path.join(dir, `${safeCid}.orig${ext}`);
}

async function findOriginalFor(dir, safeCid) {
  for (const ext of ALLOWED_ORIG_EXTS) {
    const file = origPathFor(dir, safeCid, ext);
    try {
      const st = await fsp.stat(file);
      if (st.isFile()) return { file, ext };
    } catch (_e) { /* keep probing */ }
  }
  return null;
}

function relPortraitFilename(safeCid) {
  // Stored on character.portrait_image — relative to pulp_data/.
  return `${PORTRAITS_DIR_NAME}/${safeCid}.png`;
}

// ----- Per-project mutex (mirror pulp_scenes pattern) -----

const chains = new Map();
function withLock(projectId, fn) {
  const prev = chains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(projectId, next.catch(() => {}));
  return next;
}

// ----- Conversion -----

/**
 * runDitherPipeline(srcBuffer, opts) -> { pngBuffer, dim, srcDim, opts }
 *
 * Steps (mirror of pulp_scenes.runDitherPipeline; differs only in dim
 * sourcing — portraits take dim from opts.dim, scenes hard-code 400x240):
 *   1. sharp(src).resize(dim, { fit, kernel: nearest })
 *   2. .greyscale()
 *   3. .modulate({ brightness })
 *   4. .linear(contrast, pivot-shift)
 *   5. .raw() -> Uint8Array w/h
 *   6. dither.<algo>(buf, w, h, threshold)
 *   7. sharp(out, raw 1-channel).png() -> Buffer
 */
async function runDitherPipeline(srcBuffer, optsIn) {
  if (!Buffer.isBuffer(srcBuffer) || srcBuffer.length === 0) {
    throw portraitErr(400, 'empty_file');
  }
  const opts = normalizeOpts(optsIn);
  const [w, h] = opts.dim;

  // Probe source dimensions for portrait_meta (best-effort).
  let srcDim = [0, 0];
  try {
    const meta = await sharp(srcBuffer).metadata();
    if (meta && Number.isInteger(meta.width) && Number.isInteger(meta.height)) {
      srcDim = [meta.width, meta.height];
    }
  } catch (_e) { /* keep [0,0] */ }

  // Contrast pivot at mid-grey (same algebra as pulp_scenes).
  const a = opts.contrast;
  const b = 128 - 128 * a;
  const brightnessFactor = 1 + (opts.brightness / 100);

  const pipeline = sharp(srcBuffer)
    .resize(w, h, { fit: opts.fit, kernel: 'nearest' })
    .greyscale()
    .modulate({ brightness: brightnessFactor })
    .linear(a, b)
    .raw();

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  let gray;
  if (info.channels === 1) {
    gray = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += info.channels) {
      gray[i] = data[j];
    }
  }

  const out = dither.dither(opts.dither, gray, w, h, opts.threshold);

  const pngBuffer = await sharp(out, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();

  return { pngBuffer, dim: [w, h], srcDim, opts };
}

async function convertPortrait(buffer, opts) {
  return runDitherPipeline(buffer, opts);
}

// ----- Persist + patch character -----

async function atomicWrite(file, buf) {
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, buf, { mode: 0o600 });
  await fsp.rename(tmp, file);
}

async function pruneStaleOriginals(dir, safeCid, keepExt) {
  for (const ext of ALLOWED_ORIG_EXTS) {
    if (ext === keepExt) continue;
    const file = origPathFor(dir, safeCid, ext);
    try { await fsp.unlink(file); }
    catch (_e) { /* expected if absent */ }
  }
}

/**
 * savePortraitAndPatchCharacter(projectId, safeCid, pngBuffer, portraitMeta?, origPayload?)
 *
 * - Writes the processed PNG to `portraits/<cid>.png` atomically.
 * - If origPayload is provided, also writes `portraits/<cid>.orig.<ext>` and
 *   prunes stale `.orig.*` with a different extension.
 * - Patches the Character record (portrait_image + portrait_meta).
 *   patchCharacter validates id + schema; lets its 404 propagate.
 */
async function savePortraitAndPatchCharacter(
  projectId, safeCid, pngBuffer, portraitMeta, origPayload
) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const dir = await portraitsDirFor(project);
    const file = portraitPathFor(dir, safeCid);

    await atomicWrite(file, pngBuffer);

    if (origPayload && Buffer.isBuffer(origPayload.buffer) && origPayload.ext) {
      const origFile = origPathFor(dir, safeCid, origPayload.ext);
      await atomicWrite(origFile, origPayload.buffer);
      await pruneStaleOriginals(dir, safeCid, origPayload.ext);
    }

    const rel = relPortraitFilename(safeCid);

    const patch = { portrait_image: rel };
    if (portraitMeta && typeof portraitMeta === 'object') {
      patch.portrait_meta = portraitMeta;
    }
    await pulp.patchCharacter(projectId, safeCid, patch);

    return { file, rel, size_bytes: pngBuffer.length, portrait_meta: portraitMeta || null };
  });
}

async function readPortraitPng(project, safeCid) {
  const dir = await portraitsDirFor(project);
  const file = portraitPathFor(dir, safeCid);
  let stat;
  try { stat = await fsp.stat(file); }
  catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  if (!stat.isFile()) return null;
  const buf = await fsp.readFile(file);
  return { buf, mtimeMs: stat.mtimeMs, size: stat.size };
}

async function readPortraitOriginal(project, safeCid) {
  const dir = await portraitsDirFor(project);
  const found = await findOriginalFor(dir, safeCid);
  if (!found) return null;
  const stat = await fsp.stat(found.file);
  if (!stat.isFile()) return null;
  const buf = await fsp.readFile(found.file);
  return { buf, ext: found.ext, mtimeMs: stat.mtimeMs, size: stat.size };
}

// ----- Reprocess (uses on-disk original) -----

async function reprocessPortrait(projectId, safeCid, optsIn) {
  const project = await loadProjectOrThrow(projectId);
  const dir = await portraitsDirFor(project);
  const found = await findOriginalFor(dir, safeCid);
  if (!found) throw portraitErr(409, 'no_original');
  const srcBuf = await fsp.readFile(found.file);
  const { pngBuffer, dim, srcDim, opts } = await runDitherPipeline(srcBuf, optsIn);
  const portrait_meta = {
    dim,
    dither: opts.dither,
    threshold: opts.threshold,
    contrast: opts.contrast,
    brightness: opts.brightness,
    fit: opts.fit,
    src_dim: srcDim,
    src_ext: found.ext,
    processed_at_ts: Date.now()
  };
  const persisted = await savePortraitAndPatchCharacter(
    projectId, safeCid, pngBuffer, portrait_meta, null
  );
  return {
    rel: persisted.rel,
    size_bytes: persisted.size_bytes,
    dim,
    portrait_meta
  };
}

// ----- AI generate wrapper -----

/**
 * generateAndSavePortrait({ projectId, safeCid, prompt, model, opts? })
 *
 * Generates via pulp_ai.generatePortrait, then re-runs through our own
 * dither pipeline so the requested knobs apply (the AI returns a near-binary
 * PNG; a re-dither of a near-binary image still yields binary). Persists the
 * AI-rendered source as `.orig.png` so the user can reprocess later without
 * re-generating.
 */
async function generateAndSavePortrait({ projectId, safeCid, prompt, model, opts }) {
  // Pull dim out of opts if present so the AI request matches the target size.
  const normalized = normalizeOpts(opts);
  const out = await pulpAi.generatePortrait({
    prompt,
    model,
    dim: normalized.dim
  });
  const { pngBuffer, dim, srcDim, opts: normalizedOpts } =
    await runDitherPipeline(out.pngBuffer, normalized);
  const portrait_meta = {
    dim,
    dither: normalizedOpts.dither,
    threshold: normalizedOpts.threshold,
    contrast: normalizedOpts.contrast,
    brightness: normalizedOpts.brightness,
    fit: normalizedOpts.fit,
    src_dim: srcDim,
    src_ext: '.png',
    processed_at_ts: Date.now()
  };
  const persisted = await savePortraitAndPatchCharacter(
    projectId, safeCid, pngBuffer, portrait_meta,
    { buffer: out.pngBuffer, ext: '.png' }
  );
  return {
    rel: persisted.rel,
    size_bytes: persisted.size_bytes,
    dim,
    prompt: out.prompt,
    model: out.model,
    fallback: !!out.fallback,
    portrait_meta
  };
}

module.exports = {
  PORTRAIT_DIM_DEFAULT,
  PORTRAIT_DIM_MIN,
  PORTRAIT_DIM_MAX,
  MAX_FILE_BYTES,
  SAFE_CID_RE,
  PULP_DIR_NAME,
  PORTRAITS_DIR_NAME,
  ALLOWED_ORIG_EXTS,
  VALID_DITHER,
  VALID_FIT,
  DEFAULT_OPTS,
  PORTRAIT_PRESETS,
  normalizePreset,
  loadProjectOrThrow,
  pulpDirFor,
  portraitsDirFor,
  portraitPathFor,
  origPathFor,
  findOriginalFor,
  relPortraitFilename,
  validateSafeCid,
  normalizeOpts,
  normalizeDim,
  clampDim,
  safeOrigExt,
  convertPortrait,
  runDitherPipeline,
  savePortraitAndPatchCharacter,
  readPortraitPng,
  readPortraitOriginal,
  reprocessPortrait,
  generateAndSavePortrait,
  portraitErr
};
