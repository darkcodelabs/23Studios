'use strict';

// Gallery service (Phase 4.5 Patch A).
//
// Per-project asset gallery: walks <local_path>/sdk_data/{scenes,characters,
// launcher}/*.png, merges with persisted approval state stored in
// <local_path>/sdk_data/gallery_state.json, merges with optional prompt
// sidecars (<dest>.prompt.json written by sdk_asset_batches.js).
//
// Asset id shape: "<type>:<basename>" where type ∈ {scene, portrait, launcher}.
//
// gallery_state.json shape:
//   {
//     version: 1,
//     lastUpdated: ISO,
//     assets: {
//       "<id>": {
//         state: "pending"|"approved"|"rejected"|"regenerating",
//         approvedAt: ISO|null,
//         rejectedAt: ISO|null,
//         rejectionReason: string|null,
//         regenHistory: [{ at, promptOverride?, modelOverride?, ditherAlgo? }]
//       }
//     }
//   }
//
// File is rewritten atomically (write to .tmp, rename) mirroring projects.js.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const pulpAi = require('./pulp_ai');

const VALID_STATES = new Set(['pending', 'approved', 'rejected', 'regenerating']);

// Map asset type → sdk_data subdirectory (singular type → plural dir).
const TYPE_DIR = {
  scene: 'scenes',
  portrait: 'characters',
  launcher: 'launcher'
};

// Reverse lookup so listAssets can scan known dirs and tag each asset type.
const DIR_TYPE = [
  { type: 'scene', dir: 'scenes' },
  { type: 'portrait', dir: 'characters' },
  { type: 'launcher', dir: 'launcher' }
];

// 60-second regen timeout per spec line 118.
const REGEN_TIMEOUT_MS = 60 * 1000;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

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

function galleryStatePath(localPath) {
  return path.join(localPath, 'sdk_data', 'gallery_state.json');
}

function emptyGalleryState() {
  return { version: 1, lastUpdated: null, assets: {} };
}

function parseAssetId(assetId) {
  if (typeof assetId !== 'string' || !assetId.includes(':')) return null;
  const idx = assetId.indexOf(':');
  const type = assetId.slice(0, idx);
  const name = assetId.slice(idx + 1);
  if (!type || !name) return null;
  if (!TYPE_DIR[type]) return null;
  // Basic safety: name should not escape its directory.
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  return { type, name };
}

function assetIdFor(type, name) {
  return `${type}:${name}`;
}

// Reads the prompt sidecar for a PNG path (returns {} if missing/invalid).
async function readSidecar(pngAbs) {
  try {
    const sidecar = pngAbs.replace(/\.png$/i, '.prompt.json');
    const raw = await fsp.readFile(sidecar, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch (_e) {
    return {};
  }
}

// ----------------------------------------------------------------------------
// gallery_state.json read/write (atomic)
// ----------------------------------------------------------------------------

async function readGalleryState(localPath) {
  const p = galleryStatePath(localPath);
  try {
    const raw = await fsp.readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyGalleryState();
    if (!parsed.assets || typeof parsed.assets !== 'object') parsed.assets = {};
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch (_e) {
    return emptyGalleryState();
  }
}

async function writeGalleryState(localPath, state) {
  const p = galleryStatePath(localPath);
  state.version = 1;
  state.lastUpdated = new Date().toISOString();
  await fsp.mkdir(path.dirname(p), { recursive: true });
  // Atomic write: .tmp + rename (mirror projects.js:32-36 pattern).
  const tmp = p + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
  await fsp.rename(tmp, p);
}

// ----------------------------------------------------------------------------
// listAssets — walk sdk_data/{scenes,characters,launcher}/*.png
// ----------------------------------------------------------------------------

async function listAssets(projectId) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const state = await readGalleryState(localPath);

  const assets = [];

  for (const { type, dir } of DIR_TYPE) {
    const dirAbs = path.join(localPath, 'sdk_data', dir);
    let entries;
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch (_e) {
      continue;
    }

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!ent.name.toLowerCase().endsWith('.png')) continue;

      const pngAbs = path.join(dirAbs, ent.name);
      const baseName = ent.name.slice(0, -4); // strip .png

      let stat;
      try { stat = await fsp.stat(pngAbs); } catch (_e) { continue; }

      const sidecar = await readSidecar(pngAbs);
      const id = assetIdFor(type, baseName);
      const persisted = state.assets[id] || {};

      // PNG static URL — reuses existing /api/projects/:id/file/raw route.
      const relPath = `sdk_data/${dir}/${ent.name}`;
      const imageUrl =
        `/api/projects/${encodeURIComponent(projectId)}/file/raw?path=${encodeURIComponent(relPath)}`;

      assets.push({
        id,
        type,
        name: baseName,
        imageUrl,
        prompt: sidecar.prompt || null,
        model: sidecar.model || null,
        ditherAlgo: sidecar.ditherAlgo || null,
        dim: sidecar.dim || null,
        stage: sidecar.stage || null,
        createdAt: sidecar.createdAt || stat.mtime.toISOString(),
        state: persisted.state || 'pending',
        approvedAt: persisted.approvedAt || null,
        rejectedAt: persisted.rejectedAt || null,
        rejectionReason: persisted.rejectionReason || null,
        regenHistory: Array.isArray(persisted.regenHistory) ? persisted.regenHistory : []
      });
    }
  }

  // Stable sort: type group, then name alpha.
  const TYPE_ORDER = { scene: 0, portrait: 1, launcher: 2 };
  assets.sort((a, b) => {
    const ta = TYPE_ORDER[a.type] ?? 99;
    const tb = TYPE_ORDER[b.type] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  return { projectId, assets };
}

// ----------------------------------------------------------------------------
// getAsset — single-asset fetch
// ----------------------------------------------------------------------------

async function getAsset(projectId, assetId) {
  const parsed = parseAssetId(assetId);
  if (!parsed) {
    const err = new Error('invalid asset id (expected "<type>:<name>")');
    err.status = 400; err.code = 'bad_asset_id';
    throw err;
  }
  const { assets } = await listAssets(projectId);
  const found = assets.find((a) => a.id === assetId);
  if (!found) {
    const err = new Error(`asset not found: ${assetId}`);
    err.status = 404; err.code = 'not_found';
    throw err;
  }
  return found;
}

// ----------------------------------------------------------------------------
// setAssetState — mutate gallery_state.json
// ----------------------------------------------------------------------------

async function setAssetState(projectId, assetId, nextState, opts = {}) {
  if (!VALID_STATES.has(nextState)) {
    const err = new Error(`invalid state "${nextState}" (expected one of: ${[...VALID_STATES].join(', ')})`);
    err.status = 400; err.code = 'bad_state';
    throw err;
  }
  const parsed = parseAssetId(assetId);
  if (!parsed) {
    const err = new Error('invalid asset id');
    err.status = 400; err.code = 'bad_asset_id';
    throw err;
  }

  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  // Confirm the PNG actually exists before recording state — keeps
  // gallery_state.json from accumulating ghost entries.
  const pngAbs = path.join(localPath, 'sdk_data', TYPE_DIR[parsed.type], parsed.name + '.png');
  try { await fsp.stat(pngAbs); }
  catch (_e) {
    const err = new Error(`asset png missing: ${assetId}`);
    err.status = 404; err.code = 'not_found';
    throw err;
  }

  const state = await readGalleryState(localPath);
  const cur = state.assets[assetId] || {
    state: 'pending',
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    regenHistory: []
  };

  const now = new Date().toISOString();
  cur.state = nextState;
  if (nextState === 'approved') {
    cur.approvedAt = now;
    cur.rejectedAt = null;
    cur.rejectionReason = null;
  } else if (nextState === 'rejected') {
    cur.rejectedAt = now;
    cur.approvedAt = null;
    cur.rejectionReason = (opts && typeof opts.reason === 'string')
      ? opts.reason.slice(0, 512)
      : null;
  } else if (nextState === 'pending') {
    // Clear approval/rejection marks but keep history.
    cur.approvedAt = null;
    cur.rejectedAt = null;
    cur.rejectionReason = null;
  }
  // regenerating: leave marks intact (it's a transient state).

  state.assets[assetId] = cur;
  await writeGalleryState(localPath, state);

  return getAsset(projectId, assetId);
}

// ----------------------------------------------------------------------------
// regenAsset — call pulp_ai, rewrite PNG + sidecar, append regenHistory
// ----------------------------------------------------------------------------

function timeoutPromise(ms, label) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.status = 504; err.code = 'regen_timeout';
      reject(err);
    }, ms);
  });
}

async function regenAsset(projectId, assetId, overrides = {}) {
  const parsed = parseAssetId(assetId);
  if (!parsed) {
    const err = new Error('invalid asset id');
    err.status = 400; err.code = 'bad_asset_id';
    throw err;
  }
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  const dir = TYPE_DIR[parsed.type];
  const destPng = path.join(localPath, 'sdk_data', dir, parsed.name + '.png');

  // Read existing sidecar so we can fall back to its prompt when no override
  // is supplied. If neither is present, refuse with a clear error rather
  // than guess.
  const existingSidecar = await readSidecar(destPng);
  const promptOverride = (overrides && typeof overrides.promptOverride === 'string')
    ? overrides.promptOverride
    : null;
  const prompt = promptOverride || existingSidecar.prompt || null;
  if (!prompt) {
    const err = new Error(
      'cannot regen: no prompt override supplied and no .prompt.json sidecar present'
    );
    err.status = 400; err.code = 'missing_prompt';
    throw err;
  }

  const modelOverride = (overrides && typeof overrides.modelOverride === 'string')
    ? overrides.modelOverride
    : null;
  const ditherAlgo = (overrides && typeof overrides.ditherAlgo === 'string')
    ? overrides.ditherAlgo
    : (existingSidecar.ditherAlgo || null);
  // Phase 4 Patch F: reference image filenames forwarded to pulp_ai. The
  // generator resolves filenames → disk → base64 dataUrls via references.js.
  const referenceImages = (overrides && Array.isArray(overrides.referenceImages))
    ? overrides.referenceImages.filter((n) => typeof n === 'string')
    : [];

  // Flip state to 'regenerating' so the UI can show a spinner. Best-effort;
  // a state write failure shouldn't block the gen attempt itself.
  try {
    await setAssetState(projectId, assetId, 'regenerating');
  } catch (_e) { /* ignore */ }

  // Resolve generator + dim by type.
  let stage;
  let dim;
  let genFn;
  if (parsed.type === 'scene') {
    stage = 'scene_bursts';
    dim = existingSidecar.dim || [400, 240];
    genFn = pulpAi.generateScene;
  } else if (parsed.type === 'portrait') {
    stage = 'portrait_bursts';
    dim = existingSidecar.dim || [64, 64];
    genFn = pulpAi.generatePortrait;
  } else if (parsed.type === 'launcher') {
    stage = 'launcher';
    dim = existingSidecar.dim || (parsed.name === 'icon' ? [32, 32]
                                 : parsed.name === 'card' ? [350, 155]
                                 : [400, 240]);
    genFn = pulpAi.generateScene; // launcher uses scene generator (existing pattern, see sdk_autopilot.js:1130)
  } else {
    const err = new Error(`unsupported type: ${parsed.type}`);
    err.status = 400; err.code = 'bad_type';
    throw err;
  }

  let r;
  try {
    r = await Promise.race([
      genFn({
        prompt,
        model: modelOverride || undefined,
        dim,
        projectId,
        sceneId: parsed.name,
        stage,
        referenceImages
      }),
      timeoutPromise(REGEN_TIMEOUT_MS, `regen ${assetId}`)
    ]);
  } catch (e) {
    // Roll the state back to pending so the user sees a stable spinner-off.
    try { await setAssetState(projectId, assetId, 'pending'); }
    catch (_e2) { /* ignore */ }
    if (e.status) throw e;
    const wrapped = new Error(`regen failed: ${e.message}`);
    wrapped.status = 502; wrapped.code = 'regen_failed';
    throw wrapped;
  }

  if (!r || !r.pngBuffer) {
    try { await setAssetState(projectId, assetId, 'pending'); } catch (_e) { /* ignore */ }
    const err = new Error('generator returned no png buffer');
    err.status = 502; err.code = 'no_png';
    throw err;
  }

  // Write new PNG (overwrite existing canonical path).
  await fsp.mkdir(path.dirname(destPng), { recursive: true });
  await fsp.writeFile(destPng, r.pngBuffer);

  // Mirror art_source (if generator returned a raw buffer).
  if (r.sourceBuffer) {
    try {
      const artSrcDir = path.join(localPath, 'sdk_data', 'art_source', parsed.type === 'portrait' ? 'characters' : (parsed.type === 'scene' ? 'scenes' : 'launcher'));
      await fsp.mkdir(artSrcDir, { recursive: true });
      await fsp.writeFile(path.join(artSrcDir, parsed.name + '.png'), r.sourceBuffer);
    } catch (_e) { /* best-effort */ }
  }

  // Write fresh sidecar — overwrite, this is the new canonical prompt.
  const now = new Date().toISOString();
  const sidecar = {
    prompt,
    model: r.model || modelOverride || null,
    dim,
    ditherAlgo: ditherAlgo || null,
    createdAt: now,
    stage
  };
  try {
    await fsp.writeFile(
      destPng.replace(/\.png$/i, '.prompt.json'),
      JSON.stringify(sidecar, null, 2)
    );
  } catch (e) {
    console.warn('[gallery] sidecar write failed for', assetId, e.message);
  }

  // Append regen history entry, flip state to pending.
  const state = await readGalleryState(localPath);
  const cur = state.assets[assetId] || {
    state: 'pending',
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    regenHistory: []
  };
  cur.state = 'pending';
  cur.approvedAt = null;
  cur.rejectedAt = null;
  cur.rejectionReason = null;
  if (!Array.isArray(cur.regenHistory)) cur.regenHistory = [];
  cur.regenHistory.push({
    at: now,
    promptOverride: promptOverride || null,
    modelOverride: modelOverride || null,
    ditherAlgo: ditherAlgo || null
  });
  // Cap history at 50 entries to keep the file bounded.
  if (cur.regenHistory.length > 50) {
    cur.regenHistory = cur.regenHistory.slice(-50);
  }
  state.assets[assetId] = cur;
  await writeGalleryState(localPath, state);

  return getAsset(projectId, assetId);
}

// ----------------------------------------------------------------------------
// updateAssetSidecar — edit <asset>.prompt.json in place WITHOUT regen
// ----------------------------------------------------------------------------
//
// Backs the Scene Editor "Save (no regen)" button. Lets the user edit the
// prompt + model + ditherAlgo + referenceImages on the sidecar without
// burning an OpenRouter call. Preserves dim + stage + createdAt because
// those are tied to the PNG that's already on disk.
//
// fields: { prompt?, model?, ditherAlgo?, referenceImages? } — any subset.
// Missing fields are left untouched on the existing sidecar.
//
// Atomic write (.tmp + rename) mirrors writeGalleryState above.

const ALLOWED_SIDECAR_FIELDS = new Set([
  'prompt',
  'model',
  'ditherAlgo',
  'referenceImages'
]);

async function updateAssetSidecar(projectId, assetId, fields) {
  const parsed = parseAssetId(assetId);
  if (!parsed) {
    const err = new Error('invalid asset id (expected "<type>:<name>")');
    err.status = 400; err.code = 'bad_asset_id';
    throw err;
  }
  if (!fields || typeof fields !== 'object') {
    const err = new Error('fields object required');
    err.status = 400; err.code = 'bad_request';
    throw err;
  }

  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  const dir = TYPE_DIR[parsed.type];
  const destPng = path.join(localPath, 'sdk_data', dir, parsed.name + '.png');

  // Confirm the PNG actually exists — sidecars without a backing PNG would
  // accumulate into orphaned files. Same guard pattern as setAssetState.
  try { await fsp.stat(destPng); }
  catch (_e) {
    const err = new Error(`asset png missing: ${assetId}`);
    err.status = 404; err.code = 'not_found';
    throw err;
  }

  const sidecarPath = destPng.replace(/\.png$/i, '.prompt.json');
  const existing = await readSidecar(destPng);

  // Merge only the whitelisted fields; everything else (dim, stage,
  // createdAt) stays as the existing sidecar had it. Validate types
  // defensively so a typo doesn't poison the file.
  const merged = { ...existing };
  for (const key of Object.keys(fields)) {
    if (!ALLOWED_SIDECAR_FIELDS.has(key)) continue;
    const v = fields[key];
    if (key === 'prompt' && typeof v === 'string') {
      merged.prompt = v;
    } else if (key === 'model' && (typeof v === 'string' || v === null)) {
      merged.model = v;
    } else if (key === 'ditherAlgo' && (typeof v === 'string' || v === null)) {
      merged.ditherAlgo = v;
    } else if (key === 'referenceImages' && Array.isArray(v)) {
      merged.referenceImages = v.filter((n) => typeof n === 'string');
    }
  }

  // Preserve dim + stage explicitly per spec; these aren't even in the
  // allowed-fields whitelist so they couldn't be clobbered above, but be
  // defensive in case a future caller passes them and a future merge
  // strategy widens the whitelist.
  if (existing.dim) merged.dim = existing.dim;
  if (existing.stage) merged.stage = existing.stage;
  if (existing.createdAt && !merged.createdAt) merged.createdAt = existing.createdAt;
  merged.updatedAt = new Date().toISOString();

  // Atomic write: .tmp + rename.
  await fsp.mkdir(path.dirname(sidecarPath), { recursive: true });
  const tmp = sidecarPath + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(merged, null, 2));
  await fsp.rename(tmp, sidecarPath);

  // Return the updated asset shape (state, regenHistory, etc.) so the
  // caller can just patch its local state without a follow-up GET.
  return getAsset(projectId, assetId);
}

module.exports = {
  listAssets,
  getAsset,
  setAssetState,
  regenAsset,
  updateAssetSidecar,
  readGalleryState,
  writeGalleryState,
  _internals: {
    parseAssetId,
    assetIdFor,
    galleryStatePath,
    TYPE_DIR,
    VALID_STATES,
    ALLOWED_SIDECAR_FIELDS
  }
};
