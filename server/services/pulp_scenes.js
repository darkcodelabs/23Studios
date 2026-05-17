'use strict';

const fsp = require('fs/promises');
const path = require('path');

const sharp = require('sharp');

const projects = require('./projects');
const pulp = require('./pulp_project');
const pulpAi = require('./pulp_ai');

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

// safeRid regex per spec.
const SAFE_RID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function validateSafeRid(rid) {
  if (typeof rid !== 'string' || !SAFE_RID_RE.test(rid)) {
    throw sceneErr(400, 'bad_room_id');
  }
  return rid;
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
 * convertScene(buffer) -> Promise<{ pngBuffer, dim:[400,240] }>
 * Cover-fit -> greyscale -> threshold(128) -> 1-bit PNG.
 */
async function convertScene(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw sceneErr(400, 'empty_file');
  }
  const [w, h] = SCENE_DIM;
  const pngBuffer = await sharp(buffer)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .greyscale()
    .threshold(128)
    .toColourspace('b-w')
    .png()
    .toBuffer();
  return { pngBuffer, dim: [w, h] };
}

// ----- Persist + patch room -----

async function saveSceneAndPatchRoom(projectId, safeRid, pngBuffer) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const scenesDir = await scenesDirFor(project);
    const file = scenePathFor(scenesDir, safeRid);
    // Atomic write via tmp + rename. 0o600 mode.
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fsp.writeFile(tmp, pngBuffer, { mode: 0o600 });
    await fsp.rename(tmp, file);

    const rel = relSceneFilename(safeRid);
    // Patch the room's background_image field. patchRoom validates id
    // existence + schema; let its 404 propagate if the room doesn't exist.
    await pulp.patchRoom(projectId, safeRid, { background_image: rel });

    return { file, rel, size_bytes: pngBuffer.length };
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
  return await fsp.readFile(file);
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

async function generateAndSaveScene({ projectId, safeRid, prompt, model }) {
  const out = await pulpAi.generateScene({
    prompt,
    model,
    dim: SCENE_DIM
  });
  const persisted = await saveSceneAndPatchRoom(projectId, safeRid, out.pngBuffer);
  return {
    rel: persisted.rel,
    size_bytes: persisted.size_bytes,
    dim: out.dim,
    prompt: out.prompt,
    model: out.model,
    fallback: !!out.fallback
  };
}

module.exports = {
  SCENE_DIM,
  MAX_FILE_BYTES,
  MAX_IMPORT_FILES,
  SAFE_RID_RE,
  PULP_DIR_NAME,
  SCENES_DIR_NAME,
  loadProjectOrThrow,
  pulpDirFor,
  scenesDirFor,
  scenePathFor,
  relSceneFilename,
  validateSafeRid,
  convertScene,
  saveSceneAndPatchRoom,
  readScenePng,
  matchRoomIdByFilename,
  slugifyFilename,
  generateAndSaveScene,
  sceneErr
};
