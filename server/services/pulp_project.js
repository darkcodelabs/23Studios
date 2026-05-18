'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const projects = require('./projects');
const { validatePulpId } = require('./validation');

const SCHEMA_PATH = path.join(__dirname, '..', 'data', 'schema', 'pulp_project.schema.json');
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  removeAdditional: false
});
const validateSchema = ajv.compile(SCHEMA);

const PULP_DIR_NAME = 'pulp_data';
const PROJECT_JSON = 'project.json';

const TOP_LEVEL_PATCHABLE = new Set([
  'name',
  'author',
  'version',
  'config',
  'player',
  'game_script',
  'workflow_state',
  'tile_dim'
]);

const COLLECTIONS = new Set(['tiles', 'rooms', 'sounds', 'songs']);

// Per-character patchable allow-list. Mirrors $defs.Character in the schema;
// keep in sync.
const CHARACTER_PATCHABLE = new Set([
  'name',
  'role',
  'bio',
  'portrait_prompt',
  'portrait_image',
  'portrait_meta',
  'imagetable'
]);

// Per-project promise-chain mutex
const chains = new Map();
function withLock(projectId, fn) {
  const prev = chains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(projectId, next.catch(() => {}));
  return next;
}

function defaultPulpProject() {
  // Per spec Section 3.1 + 6.1: Pulp tiles are 8x8 (canonical). New pulp
  // projects default to tile_dim=8. Legacy on-disk project.json files lack
  // the field entirely — the schema treats `tile_dim` as optional and the
  // TileFrame schema accepts pixel strings of either 64 or 256 chars, so a
  // legacy 16x16 project keeps validating without auto-migration.
  return {
    name: 'Untitled Pulp Game',
    author: '',
    version: '0.1.0',
    config: {
      auto_act: false,
      input_repeat: true,
      follow_player: true,
      text_speed: 20
    },
    tile_dim: 8,
    tiles: [],
    rooms: [],
    sounds: [],
    songs: [],
    player: {
      start_tile: '',
      start_room: '',
      start_x: 12,
      start_y: 7
    },
    game_script: ''
  };
}

/**
 * pixelsLenForDim(dim) -> int
 * 8x8 -> 64, 16x16 -> 256. Anything else throws.
 */
function pixelsLenForDim(dim) {
  if (dim === 8) return 64;
  if (dim === 16) return 256;
  const e = new Error('bad_tile_dim');
  e.code = 'bad_tile_dim';
  throw e;
}

/**
 * resolveTileDim(project) -> 8 | 16
 * Single source of truth for "what tile size does THIS project use?".
 * - Explicit project.tile_dim wins (8 or 16).
 * - Otherwise infer from the first tile frame's pixel length (legacy).
 * - Otherwise default to 8 (per spec; new pulp projects are 8x8).
 */
function resolveTileDim(project) {
  if (project && (project.tile_dim === 8 || project.tile_dim === 16)) {
    return project.tile_dim;
  }
  const tiles = (project && Array.isArray(project.tiles)) ? project.tiles : [];
  for (const t of tiles) {
    const f = t && Array.isArray(t.frames) ? t.frames[0] : null;
    if (f && typeof f.pixels === 'string') {
      if (f.pixels.length === 256) return 16;
      if (f.pixels.length === 64) return 8;
    }
  }
  return 8;
}

function pulpErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

async function realPathSafe(p) {
  try { return await fsp.realpath(p); }
  catch (_e) { return null; }
}

async function resolvePulpPaths(project) {
  if (!project) throw pulpErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw pulpErr(400, 'not_pulp_project');
  const baseReal = await realPathSafe(project.local_path);
  if (!baseReal) throw pulpErr(400, 'local_path_missing');
  let baseStat;
  try { baseStat = await fsp.lstat(baseReal); }
  catch (_e) { throw pulpErr(400, 'local_path_missing'); }
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw pulpErr(400, 'local_path_invalid');
  }
  const dir = path.join(baseReal, PULP_DIR_NAME);
  const file = path.join(dir, PROJECT_JSON);
  return { baseReal, dir, file };
}

async function ensureDir(dir) {
  try {
    const s = await fsp.lstat(dir);
    if (s.isSymbolicLink()) throw pulpErr(400, 'pulp_dir_symlink');
    if (!s.isDirectory()) throw pulpErr(500, 'pulp_dir_not_dir');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      return;
    }
    if (e && e.status) throw e;
    throw e;
  }
}

async function atomicWriteJson(file, data) {
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

function runSchema(data) {
  const ok = validateSchema(data);
  if (!ok) {
    const detail = (validateSchema.errors || []).slice(0, 20).map((e) => ({
      path: e.instancePath || '/',
      keyword: e.keyword,
      message: e.message
    }));
    throw pulpErr(422, 'schema_invalid', detail);
  }
}

function ensureUniqueIds(list, label) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) {
      throw pulpErr(409, 'duplicate_id', { collection: label, id: item.id });
    }
    seen.add(item.id);
  }
}

/**
 * ensureTileFramesMatchDim(project)
 * If project.tile_dim is set explicitly, every tile frame's pixels MUST be
 * the matching length (64 for dim=8, 256 for dim=16). If tile_dim is absent,
 * we accept ANY length the schema accepts (mixed projects are tolerated for
 * legacy on-disk data, but a write that mixes 64- and 256-char frames will
 * trip this only when tile_dim has been declared).
 */
function ensureTileFramesMatchDim(project) {
  if (!project || (project.tile_dim !== 8 && project.tile_dim !== 16)) return;
  const expected = pixelsLenForDim(project.tile_dim);
  const tiles = Array.isArray(project.tiles) ? project.tiles : [];
  for (const t of tiles) {
    const frames = Array.isArray(t && t.frames) ? t.frames : [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (!f || typeof f.pixels !== 'string' || f.pixels.length !== expected) {
        throw pulpErr(422, 'tile_pixels_dim_mismatch', {
          tile_id: t && t.id,
          frame_index: i,
          expected,
          actual: f && typeof f.pixels === 'string' ? f.pixels.length : null
        });
      }
    }
  }
}

async function readFileOrDefault(file) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_e) { throw pulpErr(500, 'pulp_corrupt'); }
    // Merge with defaults to backfill any missing top-level field.
    const merged = { ...defaultPulpProject(), ...parsed };
    return { project: merged, exists: true };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { project: defaultPulpProject(), exists: false };
    }
    if (e && e.status) throw e;
    throw e;
  }
}

async function loadProjectOrThrow(projectId) {
  const idErr = require('./validation').validateId(projectId);
  if (idErr) throw pulpErr(400, 'bad_request', idErr);
  const project = await projects.getProject(projectId);
  if (!project) throw pulpErr(404, 'not_found');
  return project;
}

async function readPulp(projectId) {
  const project = await loadProjectOrThrow(projectId);
  const { file } = await resolvePulpPaths(project);
  const r = await readFileOrDefault(file);
  return r;
}

async function writeFullPulp(projectId, body) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    if (!body || typeof body !== 'object') throw pulpErr(400, 'bad_request');
    runSchema(body);
    ensureUniqueIds(body.tiles, 'tiles');
    ensureUniqueIds(body.rooms, 'rooms');
    ensureUniqueIds(body.sounds, 'sounds');
    ensureUniqueIds(body.songs, 'songs');
    ensureTileFramesMatchDim(body);
    await ensureDir(dir);
    await atomicWriteJson(file, body);
    return body;
  });
}

async function patchPulp(projectId, patch) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw pulpErr(400, 'bad_request');
    }
    const { project: cur } = await readFileOrDefault(file);
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      if (!TOP_LEVEL_PATCHABLE.has(k)) {
        throw pulpErr(400, 'field_not_patchable', { field: k });
      }
      next[k] = v;
    }
    runSchema(next);
    ensureTileFramesMatchDim(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return next;
  });
}

async function listCollection(projectId, collection) {
  if (!COLLECTIONS.has(collection)) throw pulpErr(400, 'bad_collection');
  const { project } = await readPulp(projectId);
  return project[collection] || [];
}

async function addCollectionItem(projectId, collection, item) {
  if (!COLLECTIONS.has(collection)) throw pulpErr(400, 'bad_collection');
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw pulpErr(400, 'bad_request');
    }
    const idErr = validatePulpId(item.id);
    if (idErr) throw pulpErr(400, 'bad_id', idErr);
    const { project: cur } = await readFileOrDefault(file);
    if ((cur[collection] || []).some((x) => x.id === item.id)) {
      throw pulpErr(409, 'duplicate_id', { id: item.id });
    }
    const next = { ...cur, [collection]: [...(cur[collection] || []), item] };
    runSchema(next);
    if (collection === 'tiles') ensureTileFramesMatchDim(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return item;
  });
}

async function patchCollectionItem(projectId, collection, itemId, patch) {
  if (!COLLECTIONS.has(collection)) throw pulpErr(400, 'bad_collection');
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    const idErr = validatePulpId(itemId);
    if (idErr) throw pulpErr(400, 'bad_id', idErr);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw pulpErr(400, 'bad_request');
    }
    const { project: cur } = await readFileOrDefault(file);
    const list = cur[collection] || [];
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx === -1) throw pulpErr(404, 'item_not_found');
    const merged = { ...list[idx], ...patch, id: itemId };
    const nextList = list.slice();
    nextList[idx] = merged;
    const next = { ...cur, [collection]: nextList };
    runSchema(next);
    if (collection === 'tiles') ensureTileFramesMatchDim(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return merged;
  });
}

// Per-room patchable allow-list. Mirrors the room schema property set;
// keep in sync with pulp_project.schema.json $defs.Room.properties.
const ROOM_PATCHABLE = new Set([
  'name',
  'song',
  'grid',
  'script',
  'background_image',
  'scene_meta',
  'bgm_file',
  'bgm_track_id'
]);

/**
 * patchRoom(projectId, roomId, patch)
 * Applies a partial update to a single room. Only fields in ROOM_PATCHABLE
 * may be modified; id is preserved. Validates against the full schema after
 * merge and persists atomically under the per-project lock.
 */
async function patchRoom(projectId, roomId, patch) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    const idErr = validatePulpId(roomId);
    if (idErr) throw pulpErr(400, 'bad_id', idErr);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw pulpErr(400, 'bad_request');
    }
    for (const k of Object.keys(patch)) {
      if (!ROOM_PATCHABLE.has(k)) {
        throw pulpErr(400, 'field_not_patchable', { field: k });
      }
    }
    const { project: cur } = await readFileOrDefault(file);
    const list = cur.rooms || [];
    const idx = list.findIndex((x) => x.id === roomId);
    if (idx === -1) throw pulpErr(404, 'item_not_found');
    const merged = { ...list[idx], ...patch, id: roomId };
    const nextList = list.slice();
    nextList[idx] = merged;
    const next = { ...cur, rooms: nextList };
    runSchema(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return merged;
  });
}

// ----- Characters (top-level array; lazy-init for legacy project.json) -----
//
// The workflow's "characters" stage stores its output under workflow.json,
// not project.json. We add a canonical top-level `characters[]` here so
// portraits (and any future cast attributes) have a stable persistent home.
// Pre-existing project.json files that lack the array continue to validate
// because `characters` is optional in the schema; we lazily inject `[]` only
// on first mutating call.

async function listCharacters(projectId) {
  const { project } = await readPulp(projectId);
  return Array.isArray(project.characters) ? project.characters : [];
}

async function getCharacter(projectId, cid) {
  const idErr = validatePulpId(cid);
  if (idErr) throw pulpErr(400, 'bad_id', idErr);
  const list = await listCharacters(projectId);
  const found = list.find((c) => c && c.id === cid);
  if (!found) throw pulpErr(404, 'item_not_found');
  return found;
}

async function createCharacter(projectId, body) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw pulpErr(400, 'bad_request');
    }
    const idErr = validatePulpId(body.id);
    if (idErr) throw pulpErr(400, 'bad_id', idErr);
    if (typeof body.name !== 'string' || body.name.length === 0) {
      throw pulpErr(400, 'bad_request', { field: 'name' });
    }
    // Whitelist incoming fields to schema-known keys.
    const allowed = ['id', 'name', 'role', 'bio',
      'portrait_prompt', 'portrait_image', 'portrait_meta', 'imagetable'];
    const character = {};
    for (const k of allowed) {
      if (body[k] !== undefined) character[k] = body[k];
    }
    const { project: cur } = await readFileOrDefault(file);
    const list = Array.isArray(cur.characters) ? cur.characters : [];
    if (list.some((x) => x && x.id === character.id)) {
      throw pulpErr(409, 'duplicate_id', { id: character.id });
    }
    const next = { ...cur, characters: [...list, character] };
    runSchema(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return character;
  });
}

async function patchCharacter(projectId, cid, patch) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    const idErr = validatePulpId(cid);
    if (idErr) throw pulpErr(400, 'bad_id', idErr);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw pulpErr(400, 'bad_request');
    }
    for (const k of Object.keys(patch)) {
      if (!CHARACTER_PATCHABLE.has(k)) {
        throw pulpErr(400, 'field_not_patchable', { field: k });
      }
    }
    const { project: cur } = await readFileOrDefault(file);
    const list = Array.isArray(cur.characters) ? cur.characters : [];
    const idx = list.findIndex((x) => x && x.id === cid);
    if (idx === -1) throw pulpErr(404, 'item_not_found');
    const merged = { ...list[idx], ...patch, id: cid };
    const nextList = list.slice();
    nextList[idx] = merged;
    const next = { ...cur, characters: nextList };
    runSchema(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return merged;
  });
}

async function deleteCharacter(projectId, cid) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    const idErr = validatePulpId(cid);
    if (idErr) throw pulpErr(400, 'bad_id', idErr);
    const { project: cur } = await readFileOrDefault(file);
    const list = Array.isArray(cur.characters) ? cur.characters : [];
    const idx = list.findIndex((x) => x && x.id === cid);
    if (idx === -1) throw pulpErr(404, 'item_not_found');
    const nextList = list.slice();
    nextList.splice(idx, 1);
    const next = { ...cur, characters: nextList };
    runSchema(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return true;
  });
}

async function deleteCollectionItem(projectId, collection, itemId) {
  if (!COLLECTIONS.has(collection)) throw pulpErr(400, 'bad_collection');
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolvePulpPaths(project);
    const idErr = validatePulpId(itemId);
    if (idErr) throw pulpErr(400, 'bad_id', idErr);
    const { project: cur } = await readFileOrDefault(file);
    const list = cur[collection] || [];
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx === -1) throw pulpErr(404, 'item_not_found');
    const nextList = list.slice();
    nextList.splice(idx, 1);
    const next = { ...cur, [collection]: nextList };
    runSchema(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return true;
  });
}

module.exports = {
  defaultPulpProject,
  resolveTileDim,
  pixelsLenForDim,
  readPulp,
  writeFullPulp,
  patchPulp,
  listCollection,
  addCollectionItem,
  patchCollectionItem,
  patchRoom,
  deleteCollectionItem,
  listCharacters,
  getCharacter,
  createCharacter,
  patchCharacter,
  deleteCharacter,
  COLLECTIONS,
  ROOM_PATCHABLE,
  CHARACTER_PATCHABLE,
  pulpErr
};
