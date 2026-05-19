'use strict';

// Reference image library (Phase 6 B5).
//
// Per-project recursive scan for image assets, with persistent tags + anchor
// bindings stored in <project>/sdk_data/asset_library/references.json.
//
// Discovery preference order, per spec B5:
//   1. hakcd_pixel_collection/ recursively
//   2. sdk_data/asset_library/{anchors,sprites,screens,launcher}/ recursively
//   3. assets/ recursively
//   4. *.png at project root
//   5. anything else with an image extension elsewhere
//
// Per-image metadata cached on disk so we don't re-stat + re-pHash on every
// list call. Cache keyed on (path, mtimeMs, size).

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

let sharp;
try { sharp = require('sharp'); }
catch (_e) { sharp = null; }

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', '.DS_Store', 'build', 'dist',
  '__pycache__', '.cache', '.next', '.vite', 'coverage'
]);
const MAX_DEPTH = 8;
// Hard cap on returned items so a misconfigured project doesn't blow up the
// browser. 5k is well above the largest expected reference library.
const MAX_ITEMS = 5000;

// ----------------------------------------------------------------------------
// Path helpers
// ----------------------------------------------------------------------------

function assetLibDir(localPath) {
  return path.join(localPath, 'sdk_data', 'asset_library');
}

function referencesIndexPath(localPath) {
  return path.join(assetLibDir(localPath), 'references.json');
}

function metaCachePath(localPath) {
  return path.join(assetLibDir(localPath), 'references_meta_cache.json');
}

function scenesDir(localPath) {
  return path.join(localPath, 'sdk_data', 'scenes');
}

function charactersDir(localPath) {
  return path.join(localPath, 'sdk_data', 'characters');
}

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) {
    const err = new Error(`project not found: ${projectId}`);
    err.status = 404; err.code = 'not_found';
    throw err;
  }
  if (!proj.local_path) {
    const err = new Error(`project ${projectId} has no local_path`);
    err.status = 400; err.code = 'no_local_path';
    throw err;
  }
  return proj;
}

// ----------------------------------------------------------------------------
// Filesystem walk
// ----------------------------------------------------------------------------

async function walkImages(rootAbs, opts = {}) {
  const limit = opts.limit || MAX_ITEMS;
  const results = [];
  const seen = new Set();

  async function visit(absDir, depth) {
    if (results.length >= limit) return;
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = await fsp.readdir(absDir, { withFileTypes: true }); }
    catch (_e) { return; }
    for (const ent of entries) {
      if (results.length >= limit) return;
      if (EXCLUDED_DIRS.has(ent.name)) continue;
      const full = path.join(absDir, ent.name);
      let stat;
      try { stat = await fsp.lstat(full); } catch (_e) { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await visit(full, depth + 1);
      } else if (stat.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) continue;
        if (seen.has(full)) continue;
        seen.add(full);
        results.push({ abs: full, name: ent.name, ext, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }

  await visit(rootAbs, 0);
  return results;
}

// ----------------------------------------------------------------------------
// Metadata extraction (dims + perceptual hash) with mtime-keyed cache
// ----------------------------------------------------------------------------

async function readMetaCache(localPath) {
  try {
    const raw = await fsp.readFile(metaCachePath(localPath), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && parsed.entries) ? parsed.entries : {};
  } catch (_e) { return {}; }
}

async function writeMetaCache(localPath, entries) {
  await fsp.mkdir(path.dirname(metaCachePath(localPath)), { recursive: true });
  const tmp = metaCachePath(localPath) + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify({ entries, written_at: new Date().toISOString() }, null, 2));
  await fsp.rename(tmp, metaCachePath(localPath));
}

function cacheKey(absPath, mtime, size) {
  return `${absPath}|${Math.floor(mtime)}|${size}`;
}

// 8x8 average-hash perceptual hash (64-bit, hex-encoded). Not as strong as
// pHash but cheap and stable enough for v1.5 dedup. Stored but not searched
// in v1 per spec.
async function computePerceptualHash(absPath) {
  if (!sharp) return null;
  try {
    const buf = await sharp(absPath)
      .resize(8, 8, { fit: 'fill', kernel: 'cubic' })
      .grayscale()
      .raw()
      .toBuffer();
    if (buf.length !== 64) return null;
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += buf[i];
    const avg = sum / 64;
    let hex = '';
    for (let byteI = 0; byteI < 8; byteI++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const v = buf[byteI * 8 + bit];
        if (v >= avg) b |= (1 << (7 - bit));
      }
      hex += b.toString(16).padStart(2, '0');
    }
    return hex;
  } catch (_e) { return null; }
}

async function probeImage(absPath) {
  if (!sharp) return { dims: null, perceptual_hash: null };
  try {
    const meta = await sharp(absPath).metadata();
    const dims = (meta.width && meta.height) ? { w: meta.width, h: meta.height } : null;
    const phash = await computePerceptualHash(absPath);
    return { dims, perceptual_hash: phash };
  } catch (_e) {
    return { dims: null, perceptual_hash: null };
  }
}

// ----------------------------------------------------------------------------
// Persistent index (tags + anchors)
// ----------------------------------------------------------------------------

// Schema:
//   {
//     version: 1,
//     last_modified: ISO,
//     items: {
//       "<relPathFromProjectRoot>": {
//         tags: string[],
//         anchored_to: { scenes: string[], characters: string[], ui: string[] },
//         notes: string
//       }
//     }
//   }

function emptyEntry() {
  return { tags: [], anchored_to: { scenes: [], characters: [], ui: [] }, notes: '' };
}

async function readPersistedIndex(localPath) {
  try {
    const raw = await fsp.readFile(referencesIndexPath(localPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, items: {} };
    if (!parsed.items || typeof parsed.items !== 'object') parsed.items = {};
    return parsed;
  } catch (_e) {
    return { version: 1, items: {} };
  }
}

async function writePersistedIndex(localPath, idx) {
  idx.version = 1;
  idx.last_modified = new Date().toISOString();
  await fsp.mkdir(path.dirname(referencesIndexPath(localPath)), { recursive: true });
  const tmp = referencesIndexPath(localPath) + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(idx, null, 2));
  await fsp.rename(tmp, referencesIndexPath(localPath));
}

function sanitizeTag(t) {
  if (typeof t !== 'string') return null;
  const s = t.trim().toLowerCase();
  if (!s) return null;
  if (s.length > 64) return null;
  if (!/^[a-z0-9][a-z0-9_\-/. ]{0,63}$/.test(s)) return null;
  return s;
}

function sanitizeAnchorId(t) {
  if (typeof t !== 'string') return null;
  const s = t.trim();
  if (!s) return null;
  if (s.length > 128) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_\-. /]{0,127}$/.test(s)) return null;
  return s;
}

// ----------------------------------------------------------------------------
// Anchor candidates (scene IDs + character names) — discovered at list-time
// ----------------------------------------------------------------------------

async function listAnchorCandidates(localPath) {
  const scenes = [];
  const characters = [];
  try {
    const entries = await fsp.readdir(scenesDir(localPath), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name.endsWith('.json')) {
        scenes.push(e.name.slice(0, -5));
      }
    }
  } catch (_e) { /* no scenes dir yet */ }
  try {
    const entries = await fsp.readdir(charactersDir(localPath), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        characters.push(e.name.slice(0, -ext.length));
      } else if (e.name.endsWith('.json')) {
        characters.push(e.name.slice(0, -5));
      }
    }
  } catch (_e) { /* no characters dir yet */ }
  scenes.sort();
  characters.sort();
  return { scenes, characters };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

async function listReferences(projectId) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const items = await walkImages(localPath);
  const cache = await readMetaCache(localPath);
  const idx = await readPersistedIndex(localPath);
  const nextCache = {};

  const out = [];
  for (const it of items) {
    const key = cacheKey(it.abs, it.mtime, it.size);
    let cached = cache[key];
    if (!cached) {
      const probe = await probeImage(it.abs);
      cached = {
        dims: probe.dims,
        perceptual_hash: probe.perceptual_hash
      };
    }
    nextCache[key] = cached;
    const rel = path.relative(localPath, it.abs);
    const persisted = idx.items[rel] || emptyEntry();
    out.push({
      path: rel,
      name: it.name,
      ext: it.ext,
      size: it.size,
      mtime: it.mtime,
      dims: cached.dims || null,
      perceptual_hash: cached.perceptual_hash || null,
      tags: Array.isArray(persisted.tags) ? persisted.tags : [],
      anchored_to: persisted.anchored_to || { scenes: [], characters: [], ui: [] },
      notes: persisted.notes || ''
    });
  }

  await writeMetaCache(localPath, nextCache);

  function priority(rel) {
    const lower = rel.toLowerCase();
    if (lower.startsWith('hakcd_pixel_collection/')) return 0;
    if (lower.startsWith('sdk_data/asset_library/anchors/')) return 1;
    if (lower.startsWith('sdk_data/asset_library/')) return 2;
    if (lower.startsWith('assets/')) return 3;
    if (!lower.includes('/')) return 4;
    return 5;
  }
  out.sort((a, b) => {
    const pa = priority(a.path), pb = priority(b.path);
    if (pa !== pb) return pa - pb;
    return a.path.localeCompare(b.path);
  });

  const anchors = await listAnchorCandidates(localPath);

  return {
    project_id: projectId,
    project_name: proj.name || projectId,
    local_path: localPath,
    count: out.length,
    items: out,
    anchor_candidates: anchors
  };
}

async function updateReference(projectId, relPath, patch) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const abs = path.resolve(localPath, relPath);
  const baseReal = await fsp.realpath(localPath).catch(() => localPath);
  if (abs !== baseReal && !abs.startsWith(baseReal + path.sep)) {
    const err = new Error('path escapes project root');
    err.status = 400; err.code = 'bad_path';
    throw err;
  }
  try { await fsp.stat(abs); }
  catch (_e) {
    const err = new Error('reference not found');
    err.status = 404; err.code = 'not_found';
    throw err;
  }

  const idx = await readPersistedIndex(localPath);
  const rel = path.relative(localPath, abs);
  const cur = idx.items[rel] || emptyEntry();

  if (Array.isArray(patch.tags)) {
    cur.tags = Array.from(new Set(patch.tags.map(sanitizeTag).filter(Boolean))).slice(0, 32);
  }
  if (patch.anchored_to && typeof patch.anchored_to === 'object') {
    const a = patch.anchored_to;
    cur.anchored_to = {
      scenes: Array.isArray(a.scenes) ? Array.from(new Set(a.scenes.map(sanitizeAnchorId).filter(Boolean))).slice(0, 32) : (cur.anchored_to?.scenes || []),
      characters: Array.isArray(a.characters) ? Array.from(new Set(a.characters.map(sanitizeAnchorId).filter(Boolean))).slice(0, 32) : (cur.anchored_to?.characters || []),
      ui: Array.isArray(a.ui) ? Array.from(new Set(a.ui.map(sanitizeAnchorId).filter(Boolean))).slice(0, 32) : (cur.anchored_to?.ui || [])
    };
  }
  if (typeof patch.notes === 'string') {
    cur.notes = patch.notes.slice(0, 1024);
  }

  idx.items[rel] = cur;
  await writePersistedIndex(localPath, idx);
  return { path: rel, ...cur };
}

async function bulkApplyTags(projectId, relPaths, addTags = [], removeTags = []) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const idx = await readPersistedIndex(localPath);
  const addClean = addTags.map(sanitizeTag).filter(Boolean);
  const removeClean = new Set(removeTags.map(sanitizeTag).filter(Boolean));
  const updated = [];
  const baseReal = await fsp.realpath(localPath).catch(() => localPath);
  for (const rp of relPaths.slice(0, 500)) {
    const abs = path.resolve(localPath, rp);
    if (abs !== baseReal && !abs.startsWith(baseReal + path.sep)) continue;
    try { await fsp.stat(abs); } catch (_e) { continue; }
    const rel = path.relative(localPath, abs);
    const cur = idx.items[rel] || emptyEntry();
    const set = new Set((cur.tags || []).filter((t) => !removeClean.has(t)));
    for (const t of addClean) set.add(t);
    cur.tags = Array.from(set).slice(0, 32);
    idx.items[rel] = cur;
    updated.push(rel);
  }
  await writePersistedIndex(localPath, idx);
  return { updated_count: updated.length, updated };
}

module.exports = {
  listReferences,
  updateReference,
  bulkApplyTags,
  _internals: {
    sanitizeTag, sanitizeAnchorId, walkImages, computePerceptualHash, emptyEntry
  }
};
