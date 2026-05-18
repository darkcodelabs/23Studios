'use strict';

const fsp = require('fs/promises');
const path = require('path');

const sharp = require('sharp');

const projects = require('./projects');
const pulp = require('./pulp_project');
const pulpAi = require('./pulp_ai');
const dither = require('./dither');

// ----- Errors -----

function sceneErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

// ----- Layout / constants -----

const PULP_DIR_NAME = 'pulp_data';
const SCENES_DIR_NAME = 'scenes';
const SCENE_DIM = [400, 240];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_FILES = 24;

const VALID_DITHER = new Set(['atkinson', 'floyd', 'bayer4', 'ordered8', 'threshold']);
const VALID_FIT = new Set(['cover', 'contain', 'fill']);
const DEFAULT_OPTS = Object.freeze({
  dither: 'atkinson',
  threshold: 128,
  contrast: 1.0,
  brightness: 0,
  fit: 'cover'
});

// safeRid regex per spec.
const SAFE_RID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// Filename extension we allow as source originals. Lower-case, dot-prefixed.
const ALLOWED_ORIG_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'
]);

function validateSafeRid(rid) {
  if (typeof rid !== 'string' || !SAFE_RID_RE.test(rid)) {
    throw sceneErr(400, 'bad_room_id');
  }
  return rid;
}

// Coerce + clamp the options object. Always returns a fully-populated opts
// object; missing fields fall back to DEFAULT_OPTS.
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
  return out;
}

// Lower-case ext including dot, or '' if unsafe / disallowed.
function safeOrigExt(filename) {
  if (typeof filename !== 'string' || filename.length === 0) return '';
  // Drop everything after the last '.' — and reject if path-y or null bytes.
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
  if (!project) throw sceneErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw sceneErr(400, 'not_pulp_project');
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
    throw sceneErr(400, 'local_path_missing');
  }
  const baseReal = await realDir(project.local_path);
  if (!baseReal) throw sceneErr(400, 'local_path_missing');
  const dir = path.join(baseReal, PULP_DIR_NAME);
  try { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); }
  catch (_e) { /* best-effort */ }
  const dirReal = await realDir(dir);
  if (!dirReal) throw sceneErr(400, 'pulp_dir_invalid');
  if (dirReal !== path.join(baseReal, PULP_DIR_NAME)) {
    throw sceneErr(400, 'pulp_dir_outside_project');
  }
  return dirReal;
}

async function scenesDirFor(project) {
  const base = await pulpDirFor(project);
  const dir = path.join(base, SCENES_DIR_NAME);
  try { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); }
  catch (_e) { /* best-effort */ }
  const real = await realDir(dir);
  if (!real) throw sceneErr(400, 'scenes_dir_invalid');
  // Output dir must live directly under pulp_data of the project.
  if (real !== path.join(base, SCENES_DIR_NAME)) {
    throw sceneErr(400, 'scenes_dir_outside_project');
  }
  return real;
}

function scenePathFor(scenesDir, safeRid) {
  return path.join(scenesDir, `${safeRid}.png`);
}

function origPathFor(scenesDir, safeRid, ext) {
  // ext must be lower-case, dot-prefixed, already validated.
  return path.join(scenesDir, `${safeRid}.orig${ext}`);
}

// Locate an existing `<rid>.orig.<ext>` by probing the allowed extension set.
// Returns { file, ext } or null.
async function findOriginalFor(scenesDir, safeRid) {
  for (const ext of ALLOWED_ORIG_EXTS) {
    const file = origPathFor(scenesDir, safeRid, ext);
    try {
      const st = await fsp.stat(file);
      if (st.isFile()) return { file, ext };
    } catch (_e) { /* keep probing */ }
  }
  return null;
}

function relSceneFilename(safeRid) {
  // The value stored in room.background_image — relative to pulp_data/.
  return `${SCENES_DIR_NAME}/${safeRid}.png`;
}

// ----- Per-project mutex (mirror pulp_assets pattern) -----

const chains = new Map();
function withLock(projectId, fn) {
  const prev = chains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(projectId, next.catch(() => {}));
  return next;
}

// ----- Conversion -----

/**
 * runDitherPipeline(srcBuffer, opts) -> { pngBuffer, dim, srcDim }
 *
 * Steps:
 *   1. sharp(src).resize(400, 240, { fit, kernel: nearest })
 *   2. .greyscale()
 *   3. .modulate({ brightness })
 *   4. .linear(contrast, pivot-shift)
 *   5. .raw() -> Uint8Array w/h
 *   6. dither.<algo>(buf, w, h, threshold)
 *   7. sharp(out, raw 1-channel).png() -> Buffer
 *
 * Using kernel:'nearest' on resize keeps pixel boundaries crisp so the
 * subsequent dither yields real 1-bit art rather than mush.
 */
async function runDitherPipeline(srcBuffer, optsIn) {
  if (!Buffer.isBuffer(srcBuffer) || srcBuffer.length === 0) {
    throw sceneErr(400, 'empty_file');
  }
  const opts = normalizeOpts(optsIn);
  const [w, h] = SCENE_DIM;

  // Probe source dimensions for scene_meta (best-effort).
  let srcDim = [0, 0];
  try {
    const meta = await sharp(srcBuffer).metadata();
    if (meta && Number.isInteger(meta.width) && Number.isInteger(meta.height)) {
      srcDim = [meta.width, meta.height];
    }
  } catch (_e) { /* keep [0,0] */ }

  // Contrast pivot: with sharp's .linear(a, b), output = a*input + b.
  // We want a pivot at mid-grey so contrast scales around 128:
  //   out = a*(in - 128) + 128  ==  a*in + (128 - 128*a)
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
  // `info.channels` should be 1 after greyscale. Defensive: if sharp returns
  // multi-channel (e.g. due to alpha preservation), extract luminance band.
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

/**
 * convertScene(buffer, opts?) -> { pngBuffer, dim, srcDim, opts }
 * Back-compat wrapper around runDitherPipeline.
 */
async function convertScene(buffer, opts) {
  return runDitherPipeline(buffer, opts);
}

// ----- Persist + patch room -----

async function atomicWrite(file, buf) {
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, buf, { mode: 0o600 });
  await fsp.rename(tmp, file);
}

// Best-effort: remove any stale `<rid>.orig.<ext>` files whose extension
// differs from the one we're about to write.
async function pruneStaleOriginals(scenesDir, safeRid, keepExt) {
  for (const ext of ALLOWED_ORIG_EXTS) {
    if (ext === keepExt) continue;
    const file = origPathFor(scenesDir, safeRid, ext);
    try { await fsp.unlink(file); }
    catch (_e) { /* expected if absent */ }
  }
}

/**
 * saveSceneAndPatchRoom(projectId, safeRid, pngBuffer, sceneMeta?, origPayload?)
 *
 * - Writes the processed PNG to `scenes/<rid>.png` atomically.
 * - If origPayload is provided, also writes `scenes/<rid>.orig.<ext>` and
 *   prunes any stale `.orig.*` with a different extension.
 * - Patches the room (background_image + scene_meta).
 */
async function saveSceneAndPatchRoom(
  projectId, safeRid, pngBuffer, sceneMeta, origPayload
) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const scenesDir = await scenesDirFor(project);
    const file = scenePathFor(scenesDir, safeRid);

    // Write the processed PNG.
    await atomicWrite(file, pngBuffer);

    // Optionally persist the source.
    if (origPayload && Buffer.isBuffer(origPayload.buffer) && origPayload.ext) {
      const origFile = origPathFor(scenesDir, safeRid, origPayload.ext);
      await atomicWrite(origFile, origPayload.buffer);
      await pruneStaleOriginals(scenesDir, safeRid, origPayload.ext);
    }

    const rel = relSceneFilename(safeRid);

    // Patch the room. patchRoom validates id + schema; let its 404 propagate.
    const patch = { background_image: rel };
    if (sceneMeta && typeof sceneMeta === 'object') patch.scene_meta = sceneMeta;
    await pulp.patchRoom(projectId, safeRid, patch);

    return { file, rel, size_bytes: pngBuffer.length, scene_meta: sceneMeta || null };
  });
}

// Existence check used by GET endpoint.
async function readScenePng(project, safeRid) {
  const scenesDir = await scenesDirFor(project);
  const file = scenePathFor(scenesDir, safeRid);
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

// Read the original source file (for /original endpoint).
async function readSceneOriginal(project, safeRid) {
  const scenesDir = await scenesDirFor(project);
  const found = await findOriginalFor(scenesDir, safeRid);
  if (!found) return null;
  const stat = await fsp.stat(found.file);
  if (!stat.isFile()) return null;
  const buf = await fsp.readFile(found.file);
  return { buf, ext: found.ext, mtimeMs: stat.mtimeMs, size: stat.size };
}

// ----- Reprocess (uses on-disk original) -----

/**
 * reprocessScene(projectId, safeRid, opts) -> { rel, size_bytes, dim, scene_meta }
 * 409 'no_original' if `.orig.*` is missing.
 */
async function reprocessScene(projectId, safeRid, optsIn) {
  const project = await loadProjectOrThrow(projectId);
  const scenesDir = await scenesDirFor(project);
  const found = await findOriginalFor(scenesDir, safeRid);
  if (!found) throw sceneErr(409, 'no_original');
  const srcBuf = await fsp.readFile(found.file);
  const { pngBuffer, dim, srcDim, opts } = await runDitherPipeline(srcBuf, optsIn);
  const scene_meta = {
    ...opts,
    src_dim: srcDim,
    src_ext: found.ext,
    processed_at_ts: Date.now()
  };
  const persisted = await saveSceneAndPatchRoom(
    projectId, safeRid, pngBuffer, scene_meta, null
  );
  return {
    rel: persisted.rel,
    size_bytes: persisted.size_bytes,
    dim,
    scene_meta
  };
}

// ----- Filename heuristics for bulk import auto mode -----

function slugifyFilename(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * matchRoomIdByFilename(filename, roomIds) -> roomId | null
 * Picks the longest room id substring that appears in slug(filename).
 */
function matchRoomIdByFilename(filename, roomIds) {
  const slug = slugifyFilename(filename);
  if (!slug) return null;
  const candidates = [];
  for (const rid of roomIds) {
    if (typeof rid !== 'string' || !rid) continue;
    const ridSlug = rid.toLowerCase();
    if (slug.includes(ridSlug)) candidates.push(rid);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

// ----- AI generate wrapper -----

/**
 * generateAndSaveScene({ projectId, safeRid, prompt, model, opts? })
 *
 * Generates a scene via pulp_ai (which returns a 1-bit PNG via its own
 * pipeline), then re-runs it through OUR dither pipeline so the same knobs
 * apply. Also persists the AI-rendered source as `.orig.png` so the user
 * can reprocess later without re-generating.
 */
async function generateAndSaveScene({ projectId, safeRid, prompt, model, opts }) {
  const out = await pulpAi.generateScene({
    prompt,
    model,
    dim: SCENE_DIM
  });
  // Treat the AI output as the source; run it through our dither pipeline
  // so the requested knobs apply. The AI's own threshold pass is harmless —
  // a re-dither of a near-binary image still produces a binary image, and
  // any non-default opts (Atkinson/Floyd/bayer) will actually take effect.
  const { pngBuffer, dim, srcDim, opts: normalizedOpts } =
    await runDitherPipeline(out.pngBuffer, opts);
  const scene_meta = {
    ...normalizedOpts,
    src_dim: srcDim,
    src_ext: '.png',
    processed_at_ts: Date.now()
  };
  const persisted = await saveSceneAndPatchRoom(
    projectId, safeRid, pngBuffer, scene_meta,
    { buffer: out.pngBuffer, ext: '.png' }
  );
  return {
    rel: persisted.rel,
    size_bytes: persisted.size_bytes,
    dim,
    prompt: out.prompt,
    model: out.model,
    fallback: !!out.fallback,
    scene_meta
  };
}

module.exports = {
  SCENE_DIM,
  MAX_FILE_BYTES,
  MAX_IMPORT_FILES,
  SAFE_RID_RE,
  PULP_DIR_NAME,
  SCENES_DIR_NAME,
  ALLOWED_ORIG_EXTS,
  VALID_DITHER,
  VALID_FIT,
  DEFAULT_OPTS,
  loadProjectOrThrow,
  pulpDirFor,
  scenesDirFor,
  scenePathFor,
  origPathFor,
  findOriginalFor,
  relSceneFilename,
  validateSafeRid,
  normalizeOpts,
  safeOrigExt,
  convertScene,
  runDitherPipeline,
  saveSceneAndPatchRoom,
  readScenePng,
  readSceneOriginal,
  reprocessScene,
  matchRoomIdByFilename,
  slugifyFilename,
  generateAndSaveScene,
  sceneErr
};
