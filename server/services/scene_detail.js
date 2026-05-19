'use strict';

// Phase 6 B2 — Scene Manager / per-scene state machine.
//
// One scene = six stages, each one a fact about the filesystem:
//
//   1. prompt_drafted   sdk_data/scenes/<id>.json exists
//   2. asset_generated  sdk_data/scenes/<id>.png  exists
//   3. qa_passed        sdk_data/qa_results/<id>.json shows pass===true
//                       (also accepts {failed:false} or status==="pass")
//   4. lua_written      source/scenes/<id>.lua exists (composite ids like
//                       "pwnglove_panel_wires" resolve to source/scenes/
//                       pwnglove/panel_wires.lua via the same id rule B1 uses)
//   5. sim_tested       sdk_data/sim_walkthrough/<id>.png exists
//   6. shipped          released/<id>.commit_sha exists OR build/ contains
//                       at least one .pdx (latest mtime wins)
//
// No parallel "status DB" — the artifacts ARE the state. The state machine
// is therefore stateless and deterministic from a project root.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const STAGES = Object.freeze([
  'prompt_drafted',
  'asset_generated',
  'qa_passed',
  'lua_written',
  'sim_tested',
  'shipped'
]);

// Composite id → on-disk Lua path. The B1 storyboard service flattens
// nested directories into id parts joined by '_'. To recover the path we
// try every possible split that yields an existing .lua file.
async function resolveLuaPath(sourceScenesDir, sceneId) {
  if (!sceneId) return null;
  const direct = path.join(sourceScenesDir, sceneId + '.lua');
  if (await fileExists(direct)) return direct;

  const parts = sceneId.split('_');
  // try every contiguous prefix as a directory chain — longest dir prefix
  // first so deeper paths win when a name collides.
  for (let splitIdx = parts.length - 1; splitIdx >= 1; splitIdx--) {
    const dirParts = parts.slice(0, splitIdx);
    const filePart = parts.slice(splitIdx).join('_');
    const candidate = path.join(sourceScenesDir, ...dirParts, filePart + '.lua');
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function fileExists(p) {
  try { await fsp.access(p); return true; }
  catch (_e) { return false; }
}

async function readJsonSafe(p) {
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (_e) { return null; }
}

async function readTextSafe(p, maxBytes = 256 * 1024) {
  try {
    const fd = await fsp.open(p, 'r');
    try {
      const stat = await fd.stat();
      const len = Math.min(stat.size, maxBytes);
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, 0);
      return { text: buf.toString('utf8'), bytes: stat.size, truncated: stat.size > maxBytes };
    } finally { await fd.close(); }
  } catch (_e) { return null; }
}

function relish(local, abs) {
  if (!abs) return null;
  if (!local) return abs;
  return path.relative(local, abs);
}

// QA pass = explicit pass:true | status:"pass" | failed===false.
function qaIsPassing(qa) {
  if (!qa || typeof qa !== 'object') return false;
  if (qa.pass === true) return true;
  if (typeof qa.status === 'string' && qa.status.toLowerCase() === 'pass') return true;
  if (qa.failed === false && Object.prototype.hasOwnProperty.call(qa, 'failed')) return true;
  return false;
}

async function newestPdxIn(buildDir) {
  if (!await fileExists(buildDir)) return null;
  let ents;
  try { ents = await fsp.readdir(buildDir, { withFileTypes: true }); }
  catch (_e) { return null; }
  let best = null;
  for (const e of ents) {
    if (!e.name.toLowerCase().endsWith('.pdx')) continue;
    const full = path.join(buildDir, e.name);
    let stat;
    try { stat = await fsp.stat(full); }
    catch (_e) { continue; }
    if (!best || stat.mtimeMs > best.mtimeMs) {
      best = { path: full, mtimeMs: stat.mtimeMs };
    }
  }
  return best;
}

// Compute the per-stage status object. Each stage entry is:
//   { stage, status: "pending"|"done"|"failed", at: ISO|null, artifact_path: relative|null,
//     detail: string|null, error: string|null }
async function buildStageMatrix({ local, sceneId }) {
  const sdkScenesDir   = path.join(local, 'sdk_data', 'scenes');
  const qaDir          = path.join(local, 'sdk_data', 'qa_results');
  const sourceScenesDir = path.join(local, 'source', 'scenes');
  const simDir         = path.join(local, 'sdk_data', 'sim_walkthrough');
  const releasedDir    = path.join(local, 'released');
  const buildDir       = path.join(local, 'build');

  const promptJsonPath = path.join(sdkScenesDir, sceneId + '.json');
  const assetPngPath   = path.join(sdkScenesDir, sceneId + '.png');
  const qaJsonPath     = path.join(qaDir, sceneId + '.json');
  const luaAbsPath     = await resolveLuaPath(sourceScenesDir, sceneId);
  const simPngPath     = path.join(simDir, sceneId + '.png');
  const releaseShaPath = path.join(releasedDir, sceneId + '.commit_sha');

  const stages = [];

  // 1. prompt_drafted
  {
    const exists = await fileExists(promptJsonPath);
    let at = null;
    if (exists) {
      try { at = (await fsp.stat(promptJsonPath)).mtime.toISOString(); }
      catch (_e) { /* ignore */ }
    }
    stages.push({
      stage: 'prompt_drafted',
      status: exists ? 'done' : 'pending',
      at,
      artifact_path: exists ? relish(local, promptJsonPath) : null,
      detail: null,
      error: null
    });
  }

  // 2. asset_generated
  {
    const exists = await fileExists(assetPngPath);
    let at = null;
    if (exists) {
      try { at = (await fsp.stat(assetPngPath)).mtime.toISOString(); }
      catch (_e) { /* ignore */ }
    }
    stages.push({
      stage: 'asset_generated',
      status: exists ? 'done' : 'pending',
      at,
      artifact_path: exists ? relish(local, assetPngPath) : null,
      detail: null,
      error: null
    });
  }

  // 3. qa_passed
  {
    const qa = await readJsonSafe(qaJsonPath);
    const exists = qa != null;
    let status = 'pending';
    let detail = null;
    let error = null;
    if (exists) {
      if (qaIsPassing(qa)) {
        status = 'done';
        detail = qa.summary || null;
      } else {
        status = 'failed';
        error = qa.error
          || qa.reason
          || (Array.isArray(qa.failures) ? qa.failures.join('; ') : null)
          || (Array.isArray(qa.failed_checks) ? qa.failed_checks.join('; ') : null)
          || 'QA reported failure';
      }
    }
    let at = null;
    if (exists) {
      try { at = (await fsp.stat(qaJsonPath)).mtime.toISOString(); }
      catch (_e) { /* ignore */ }
    }
    stages.push({
      stage: 'qa_passed',
      status,
      at,
      artifact_path: exists ? relish(local, qaJsonPath) : null,
      detail,
      error
    });
  }

  // 4. lua_written
  {
    const exists = !!luaAbsPath;
    let at = null;
    if (exists) {
      try { at = (await fsp.stat(luaAbsPath)).mtime.toISOString(); }
      catch (_e) { /* ignore */ }
    }
    stages.push({
      stage: 'lua_written',
      status: exists ? 'done' : 'pending',
      at,
      artifact_path: exists ? relish(local, luaAbsPath) : null,
      detail: null,
      error: null
    });
  }

  // 5. sim_tested
  {
    const exists = await fileExists(simPngPath);
    let at = null;
    if (exists) {
      try { at = (await fsp.stat(simPngPath)).mtime.toISOString(); }
      catch (_e) { /* ignore */ }
    }
    stages.push({
      stage: 'sim_tested',
      status: exists ? 'done' : 'pending',
      at,
      artifact_path: exists ? relish(local, simPngPath) : null,
      detail: null,
      error: null
    });
  }

  // 6. shipped
  {
    const releaseShaExists = await fileExists(releaseShaPath);
    let shippedVia = null;
    let artifact = null;
    let at = null;
    if (releaseShaExists) {
      shippedVia = 'released_sha';
      artifact = releaseShaPath;
      try { at = (await fsp.stat(releaseShaPath)).mtime.toISOString(); }
      catch (_e) { /* ignore */ }
    } else {
      const pdx = await newestPdxIn(buildDir);
      if (pdx) {
        shippedVia = 'build_pdx';
        artifact = pdx.path;
        at = new Date(pdx.mtimeMs).toISOString();
      }
    }
    stages.push({
      stage: 'shipped',
      status: artifact ? 'done' : 'pending',
      at,
      artifact_path: artifact ? relish(local, artifact) : null,
      detail: shippedVia,
      error: null
    });
  }

  return stages;
}

// Pull metadata from the autopilot manifest + per-scene JSON for the header.
async function loadSceneMetadata({ local, sceneId }) {
  const manifestPath = path.join(local, 'sdk_data', 'project.json');
  const perScenePath = path.join(local, 'sdk_data', 'scenes', sceneId + '.json');
  const manifest = await readJsonSafe(manifestPath);
  const perScene = await readJsonSafe(perScenePath);

  let manifestEntry = null;
  if (manifest && Array.isArray(manifest.scenes)) {
    manifestEntry = manifest.scenes.find((s) => s && s.id === sceneId) || null;
  }

  const title =
    (manifestEntry && manifestEntry.name) ||
    (perScene && perScene.title) ||
    sceneId;

  const description =
    (manifestEntry && manifestEntry.description) ||
    (perScene && perScene.summary) ||
    null;

  const characters = new Set();
  if (manifestEntry && Array.isArray(manifestEntry.characters)) {
    for (const c of manifestEntry.characters) if (c) characters.add(c);
  }
  if (perScene && Array.isArray(perScene.characters_present)) {
    for (const c of perScene.characters_present) if (c) characters.add(c);
  }
  if (perScene && Array.isArray(perScene.characters)) {
    for (const c of perScene.characters) if (c) characters.add(c);
  }

  const anchors = [];
  if (manifestEntry && manifestEntry.style_reference) anchors.push(manifestEntry.style_reference);
  if (perScene && Array.isArray(perScene.anchor_refs)) {
    for (const r of perScene.anchor_refs) if (r && !anchors.includes(r)) anchors.push(r);
  }

  const canon_sections = [];
  if (perScene && Array.isArray(perScene.canon_sections)) {
    for (const s of perScene.canon_sections) if (s && !canon_sections.includes(s)) canon_sections.push(s);
  }
  if (perScene && perScene.canon_section_cited && !canon_sections.includes(perScene.canon_section_cited)) {
    canon_sections.push(perScene.canon_section_cited);
  }

  const skill_rules = [];
  if (perScene && Array.isArray(perScene.skill_rules)) {
    for (const r of perScene.skill_rules) if (r && !skill_rules.includes(r)) skill_rules.push(r);
  }

  return {
    title,
    description,
    characters_present: Array.from(characters),
    anchor_refs: anchors,
    canon_sections,
    skill_rules,
    mechanic: (manifestEntry && manifestEntry.mechanic) || (perScene && perScene.mechanic) || null,
    act: (manifestEntry && manifestEntry.act) || null
  };
}

// Read the per-stage panel payloads. Cheap on small files, gated on file size
// for Lua. Used by the right-side panel in the UI.
async function loadStagePanels({ local, sceneId }) {
  const sdkScenesDir = path.join(local, 'sdk_data', 'scenes');
  const qaDir        = path.join(local, 'sdk_data', 'qa_results');
  const simDir       = path.join(local, 'sdk_data', 'sim_walkthrough');
  const sourceScenesDir = path.join(local, 'source', 'scenes');

  const promptJson = await readJsonSafe(path.join(sdkScenesDir, sceneId + '.json'));
  const qaJson     = await readJsonSafe(path.join(qaDir, sceneId + '.json'));
  const luaAbsPath = await resolveLuaPath(sourceScenesDir, sceneId);
  const luaRead    = luaAbsPath ? await readTextSafe(luaAbsPath) : null;
  const assetPath  = path.join(sdkScenesDir, sceneId + '.png');
  const simPath    = path.join(simDir, sceneId + '.png');

  return {
    prompt: promptJson
      ? {
          // Prefer explicit prompt fields, fall back to the raw description.
          prompt_text: promptJson.prompt
            || promptJson.prompt_text
            || promptJson.image_prompt
            || promptJson.summary
            || null,
          raw: promptJson
        }
      : null,
    asset: (await fileExists(assetPath))
      ? { path: relish(local, assetPath) }
      : null,
    qa: qaJson || null,
    lua: luaRead
      ? {
          path: relish(local, luaAbsPath),
          text: luaRead.text,
          bytes: luaRead.bytes,
          truncated: luaRead.truncated
        }
      : null,
    sim: (await fileExists(simPath))
      ? { path: relish(local, simPath) }
      : null
  };
}

// Build a simple dependency map. The hand-written cross-scene wiring lives
// inside the Lua: `scene_manager.push("foo")`, `goto("foo")`, `enter_scene("foo")`.
// We treat every scene that references THIS one as an upstream (blocks),
// and every scene THIS one references as downstream (is_blocked_by).
async function buildDepMap({ local, sceneId, knownScenes }) {
  const sourceScenesDir = path.join(local, 'source', 'scenes');
  const luaForThis = await resolveLuaPath(sourceScenesDir, sceneId);
  const isBlockedBy = new Set();
  const blocks = new Set();

  if (luaForThis) {
    const text = await readTextSafe(luaForThis);
    if (text && text.text) {
      const re = /(?:scene_manager\.push|enter_scene|goto_scene|push_scene|goto)\s*\(\s*["']([\w./_-]+)["']/g;
      let m;
      while ((m = re.exec(text.text)) !== null) {
        const target = m[1].replace(/\.lua$/i, '').replace(/[\\/]/g, '_');
        if (target && target !== sceneId) isBlockedBy.add(target);
      }
    }
  }

  // Scan every other known scene for refs back to ours.
  for (const otherId of knownScenes) {
    if (otherId === sceneId) continue;
    const otherLua = await resolveLuaPath(sourceScenesDir, otherId);
    if (!otherLua) continue;
    const text = await readTextSafe(otherLua);
    if (!text || !text.text) continue;
    const re = /(?:scene_manager\.push|enter_scene|goto_scene|push_scene|goto)\s*\(\s*["']([\w./_-]+)["']/g;
    let m;
    while ((m = re.exec(text.text)) !== null) {
      const target = m[1].replace(/\.lua$/i, '').replace(/[\\/]/g, '_');
      if (target === sceneId) blocks.add(otherId);
    }
  }

  return {
    blocks: Array.from(blocks).sort(),
    is_blocked_by: Array.from(isBlockedBy).sort()
  };
}

async function listKnownSceneIds(local) {
  const sdkScenesDir = path.join(local, 'sdk_data', 'scenes');
  const sourceScenesDir = path.join(local, 'source', 'scenes');
  const ids = new Set();

  // Manifest first
  const manifest = await readJsonSafe(path.join(local, 'sdk_data', 'project.json'));
  if (manifest && Array.isArray(manifest.scenes)) {
    for (const s of manifest.scenes) if (s && s.id) ids.add(s.id);
  }

  // Per-scene JSONs
  if (await fileExists(sdkScenesDir)) {
    let ents = [];
    try { ents = await fsp.readdir(sdkScenesDir, { withFileTypes: true }); }
    catch (_e) { /* ignore */ }
    for (const e of ents) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
        ids.add(e.name.replace(/\.json$/i, ''));
      }
    }
  }

  // Lua sources
  if (await fileExists(sourceScenesDir)) {
    for await (const luaPath of walkLuaFiles(sourceScenesDir)) {
      const rel = path.relative(sourceScenesDir, luaPath).replace(/\.lua$/i, '');
      ids.add(rel.split(path.sep).join('_'));
    }
  }

  return Array.from(ids);
}

async function* walkLuaFiles(dir) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (_e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkLuaFiles(full);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.lua')) yield full;
  }
}

// Top-level entry point. Returns { scene_id, metadata, stages, panels, dep_map }.
async function buildSceneDetail(project, sceneId) {
  const local = project && project.local_path;
  if (!local || !fs.existsSync(local)) {
    const e = new Error('project local_path missing');
    e.code = 'no_local_path';
    e.status = 400;
    throw e;
  }
  if (!sceneId || typeof sceneId !== 'string') {
    const e = new Error('sceneId required');
    e.code = 'bad_scene_id';
    e.status = 400;
    throw e;
  }

  const [metadata, stages, panels, knownScenes] = await Promise.all([
    loadSceneMetadata({ local, sceneId }),
    buildStageMatrix({ local, sceneId }),
    loadStagePanels({ local, sceneId }),
    listKnownSceneIds(local)
  ]);

  const depMap = await buildDepMap({ local, sceneId, knownScenes });

  const current_stage = (() => {
    // Current = first non-done stage (or 'shipped' if all are done).
    for (const s of stages) if (s.status !== 'done') return s.stage;
    return 'shipped';
  })();

  return {
    scene_id: sceneId,
    metadata,
    stages,
    current_stage,
    panels,
    dep_map: depMap
  };
}

module.exports = {
  buildSceneDetail,
  STAGES,
  _internals: {
    resolveLuaPath,
    buildStageMatrix,
    qaIsPassing,
    newestPdxIn,
    buildDepMap,
    listKnownSceneIds
  }
};
