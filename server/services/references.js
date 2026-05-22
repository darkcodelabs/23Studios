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

// ----------------------------------------------------------------------------
// Phase 4.5 Patch A — multipart upload, delete, and per-project manifest
// ----------------------------------------------------------------------------
//
// Uploaded reference PNGs land at
// <local_path>/sdk_data/asset_library/references/<filename>. That path sits
// inside the priority-2 discovery zone (sdk_data/asset_library/) so the
// existing walkImages() picks them up automatically — no extra index needed.
//
// The per-project reference *manifest* (default_set / scene_references /
// portrait_references / card_references) lives in a separate file from the
// tag index so they don't fight for ownership:
//
//   references.json           — Phase 6 B5 tag/anchor index (per-image)
//   references_manifest.json  — Phase 4.5 reference assignments (per-bucket)

const defaultManifest = require('./reference_images_defaults');

const MAX_REFS_PER_PROJECT = 20;
const MAX_REF_BYTES = 10 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.png$/;

function uploadDir(localPath) {
  return path.join(assetLibDir(localPath), 'references');
}

function projectManifestPath(localPath) {
  return path.join(assetLibDir(localPath), 'references_manifest.json');
}

function sanitizeUploadFilename(name) {
  if (typeof name !== 'string') return null;
  const base = path.basename(name).trim();
  if (!base) return null;
  // Force .png extension; reject anything weird.
  if (!SAFE_FILENAME_RE.test(base)) return null;
  return base;
}

function isPngBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

async function countUploadedReferences(localPath) {
  try {
    const entries = await fsp.readdir(uploadDir(localPath));
    return entries.filter((e) => e.toLowerCase().endsWith('.png')).length;
  } catch (_e) { return 0; }
}

async function addReference(projectId, fileBuffer, requestedName) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  if (!Buffer.isBuffer(fileBuffer)) {
    const err = new Error('file buffer required');
    err.status = 400; err.code = 'no_file';
    throw err;
  }
  if (fileBuffer.length > MAX_REF_BYTES) {
    const err = new Error(`file too large (max ${MAX_REF_BYTES} bytes)`);
    err.status = 413; err.code = 'file_too_large';
    throw err;
  }
  if (!isPngBuffer(fileBuffer)) {
    const err = new Error('only PNG uploads allowed (magic bytes check failed)');
    err.status = 400; err.code = 'not_png';
    throw err;
  }

  const safeName = sanitizeUploadFilename(requestedName);
  if (!safeName) {
    const err = new Error('invalid filename (must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.png$/)');
    err.status = 400; err.code = 'bad_filename';
    throw err;
  }

  const existing = await countUploadedReferences(localPath);
  if (existing >= MAX_REFS_PER_PROJECT) {
    const err = new Error(`max ${MAX_REFS_PER_PROJECT} references per project`);
    err.status = 409; err.code = 'too_many_refs';
    throw err;
  }

  const destDir = uploadDir(localPath);
  await fsp.mkdir(destDir, { recursive: true });

  const destPath = path.join(destDir, safeName);

  // Refuse to clobber an existing upload — caller should DELETE first.
  try {
    await fsp.stat(destPath);
    const err = new Error(`reference already exists: ${safeName}`);
    err.status = 409; err.code = 'already_exists';
    throw err;
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'already_exists') {
      // re-throw unexpected errors but pass through our own
      if (e.code === 'already_exists') throw e;
    }
    if (e.status === 409) throw e;
  }

  await fsp.writeFile(destPath, fileBuffer);
  const relPath = path.relative(localPath, destPath);

  return {
    filename: safeName,
    path: relPath,
    size: fileBuffer.length,
    uploaded_at: new Date().toISOString()
  };
}

async function deleteReference(projectId, filename) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  const safeName = sanitizeUploadFilename(filename);
  if (!safeName) {
    const err = new Error('invalid filename');
    err.status = 400; err.code = 'bad_filename';
    throw err;
  }

  const destPath = path.join(uploadDir(localPath), safeName);

  // Belt-and-suspenders: confirm the resolved path still lives inside the
  // per-project upload directory. Guards against weird basename outputs.
  const baseReal = await fsp.realpath(uploadDir(localPath)).catch(() => uploadDir(localPath));
  if (destPath !== path.join(baseReal, safeName)) {
    const err = new Error('path escapes upload directory');
    err.status = 400; err.code = 'bad_path';
    throw err;
  }

  try { await fsp.unlink(destPath); }
  catch (e) {
    if (e.code === 'ENOENT') {
      const err = new Error(`reference not found: ${safeName}`);
      err.status = 404; err.code = 'not_found';
      throw err;
    }
    throw e;
  }

  // Also scrub from per-project manifest so dangling refs disappear.
  try {
    const manifest = await readProjectManifest(localPath);
    let mutated = false;
    if (Array.isArray(manifest.default_set)) {
      const before = manifest.default_set.length;
      manifest.default_set = manifest.default_set.filter((n) => n !== safeName);
      if (manifest.default_set.length !== before) mutated = true;
    }
    for (const bucket of ['scene_references', 'portrait_references', 'card_references']) {
      if (manifest[bucket] && typeof manifest[bucket] === 'object') {
        for (const key of Object.keys(manifest[bucket])) {
          if (Array.isArray(manifest[bucket][key])) {
            const before = manifest[bucket][key].length;
            manifest[bucket][key] = manifest[bucket][key].filter((n) => n !== safeName);
            if (manifest[bucket][key].length !== before) mutated = true;
          }
        }
      }
    }
    if (mutated) await writeProjectManifest(localPath, manifest);
  } catch (_e) { /* best-effort */ }

  return { deleted: safeName };
}

// Resolve a reference filename (as stored in the manifest, e.g. "seckc.png")
// to the actual bytes on disk. Phase 4 Patch F needs this so pulp_ai can
// attach references to OpenRouter calls as base64 data URLs.
//
// Search order (first hit wins):
//   1. <local_path>/sdk_data/asset_library/references/<filename>   (uploads)
//   2. <local_path>/hakcd_pixel_collection/<filename>              (legacy)
//   3. <local_path>/sdk_data/asset_library/<filename>              (loose)
//   4. <local_path>/assets/<filename>                              (loose)
//
// Returns Buffer. Throws ENOENT if no match.
async function resolveReferenceFile(projectId, filename) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  const safeName = sanitizeUploadFilename(filename);
  if (!safeName) {
    const err = new Error('invalid filename');
    err.status = 400; err.code = 'bad_filename';
    throw err;
  }

  const candidates = [
    path.join(uploadDir(localPath), safeName),
    path.join(localPath, 'hakcd_pixel_collection', safeName),
    path.join(localPath, 'sdk_data', 'asset_library', safeName),
    path.join(localPath, 'assets', safeName),
    // Global reference set — defaults live next to the user's other personal
    // projects, not inside any individual project's tree. Lets a fresh
    // project pick up the canonical HAKCD reference art without copying.
    path.join(process.env.STUDIO_REFERENCE_ROOT || '/home/hakcer/projects/personal/hakcd/hakcd_pixel_collection', safeName)
  ];

  for (const abs of candidates) {
    try {
      const buf = await fsp.readFile(abs);
      if (buf && buf.length > 0) return buf;
    } catch (_e) { /* keep searching */ }
  }

  const err = new Error(`reference file not found: ${safeName}`);
  err.status = 404; err.code = 'ref_not_found';
  throw err;
}

async function readProjectManifest(localPath) {
  try {
    const raw = await fsp.readFile(projectManifestPath(localPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (_e) {
    return {};
  }
}

async function writeProjectManifest(localPath, manifest) {
  await fsp.mkdir(path.dirname(projectManifestPath(localPath)), { recursive: true });
  const tmp = projectManifestPath(localPath) + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2));
  await fsp.rename(tmp, projectManifestPath(localPath));
}

// Validate a manifest payload — keep it small and forgiving, just rule out
// the obviously dangerous shapes.
function sanitizeManifestInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  if (Array.isArray(input.default_set)) {
    out.default_set = input.default_set
      .filter((n) => typeof n === 'string')
      .map((n) => path.basename(n))
      .filter((n) => SAFE_FILENAME_RE.test(n))
      .slice(0, 64);
  }
  for (const bucket of ['scene_references', 'portrait_references', 'card_references']) {
    if (input[bucket] && typeof input[bucket] === 'object' && !Array.isArray(input[bucket])) {
      out[bucket] = {};
      for (const key of Object.keys(input[bucket]).slice(0, 32)) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
        if (Array.isArray(input[bucket][key])) {
          out[bucket][key] = input[bucket][key]
            .filter((n) => typeof n === 'string')
            .map((n) => path.basename(n))
            .filter((n) => SAFE_FILENAME_RE.test(n))
            .slice(0, 32);
        }
      }
    }
  }
  return out;
}

async function updateProjectManifest(projectId, input) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const sanitized = sanitizeManifestInput(input);
  await writeProjectManifest(localPath, sanitized);
  return await getMergedManifest(projectId);
}

// Merge project-specific entries on top of defaults. For each bucket, the
// project value (if present) wins outright; otherwise the default fills in.
// _source map flags origin per top-level key (scalar arrays) and per
// nested key (for object buckets like scene_references.title).
async function getMergedManifest(projectId) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  const defaults = defaultManifest.getDefaultManifest();
  const project = await readProjectManifest(localPath);
  const merged = {};
  const source = {};

  // default_set is a flat array.
  if (Array.isArray(project.default_set) && project.default_set.length > 0) {
    merged.default_set = project.default_set.slice();
    source.default_set = 'project';
  } else {
    merged.default_set = Array.isArray(defaults.default_set) ? defaults.default_set.slice() : [];
    source.default_set = 'default';
  }

  // Object buckets — per-key override.
  for (const bucket of ['scene_references', 'portrait_references', 'card_references']) {
    const defBucket = (defaults[bucket] && typeof defaults[bucket] === 'object') ? defaults[bucket] : {};
    const projBucket = (project[bucket] && typeof project[bucket] === 'object') ? project[bucket] : {};
    const allKeys = new Set([...Object.keys(defBucket), ...Object.keys(projBucket)]);
    merged[bucket] = {};
    for (const key of allKeys) {
      if (Array.isArray(projBucket[key])) {
        merged[bucket][key] = projBucket[key].slice();
        source[`${bucket}.${key}`] = 'project';
      } else if (Array.isArray(defBucket[key])) {
        merged[bucket][key] = defBucket[key].slice();
        source[`${bucket}.${key}`] = 'default';
      } else {
        merged[bucket][key] = [];
        source[`${bucket}.${key}`] = 'default';
      }
    }
  }

  merged._source = source;
  return merged;
}

module.exports = {
  listReferences,
  updateReference,
  bulkApplyTags,
  // Phase 4.5 additions:
  addReference,
  deleteReference,
  getMergedManifest,
  updateProjectManifest,
  readProjectManifest,
  writeProjectManifest,
  // Phase 4 Patch F (reference image wiring in pulp_ai):
  resolveReferenceFile,
  _internals: {
    sanitizeTag, sanitizeAnchorId, walkImages, computePerceptualHash, emptyEntry,
    isPngBuffer, sanitizeUploadFilename, sanitizeManifestInput,
    MAX_REFS_PER_PROJECT, MAX_REF_BYTES, PNG_MAGIC
  }
};
