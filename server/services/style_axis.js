'use strict';

// Style-axis CRUD for Phase 3 authoring system.
//
// Each axis (gameplay_style, character_style, etc.) is configured by a JSON
// file in ./style_axes/<axis_id>.json. This module:
//
//   - generateOptions(): asks the LLM for N candidate options per axis
//   - pickOption(): records the active pick for a project
//   - refineOption(): produces a new option from an existing one + feedback
//   - reuseOption(): copies a stored option from any scope into a project
//   - listLibrary(): returns stored options at a given scope
//
// Preview rendering lives in style_preview.js (separate file, separate
// checkpoint). This file only knows about option spec generation + storage.
//
// Storage layout (per CLAUDE.md):
//   per-project: <local_path>/sdk_data/asset_library/
//     index.json
//     styles/<axis_id>/options/opt_<hash>.json
//     styles/<axis_id>/picked.json
//   user-scope:  ~/.23studios/user_library/styles/<axis_id>/<hash>.json
//   global:      server/data/global_library/preset_packs/<pack>/<axis_id>.json

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const projects = require('./projects');
const claude = require('./claude');

// ----------------------------------------------------------------------------
// Paths
// ----------------------------------------------------------------------------

const AXIS_DIR = path.join(__dirname, 'style_axes');
const USER_LIB_DIR = path.join(os.homedir(), '.23studios', 'user_library');
const GLOBAL_LIB_DIR = path.join(__dirname, '..', 'data', 'global_library');

function projectAssetLibDir(localPath) {
  return path.join(localPath, 'sdk_data', 'asset_library');
}

function axisOptionsDir(localPath, axisId) {
  return path.join(projectAssetLibDir(localPath), 'styles', axisId, 'options');
}

function axisPickedPath(localPath, axisId) {
  return path.join(projectAssetLibDir(localPath), 'styles', axisId, 'picked.json');
}

function projectIndexPath(localPath) {
  return path.join(projectAssetLibDir(localPath), 'index.json');
}

function userAxisDir(axisId) {
  return path.join(USER_LIB_DIR, 'styles', axisId);
}

function presetPackPath(packName, axisId) {
  return path.join(GLOBAL_LIB_DIR, 'preset_packs', packName, `${axisId}.json`);
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const AXIS_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const OPTION_ID_RE = /^opt_[a-f0-9]{8,16}$/;
const PACK_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

function safeAxisId(id) { return typeof id === 'string' && AXIS_ID_RE.test(id); }
function safeOptionId(id) { return typeof id === 'string' && OPTION_ID_RE.test(id); }
function safePackName(n) { return typeof n === 'string' && PACK_NAME_RE.test(n); }

// ----------------------------------------------------------------------------
// Axis config loading
// ----------------------------------------------------------------------------

const axisCache = new Map();

async function loadAxis(axisId) {
  if (!safeAxisId(axisId)) throw new Error(`invalid axis id: ${axisId}`);
  if (axisCache.has(axisId)) return axisCache.get(axisId);
  const file = path.join(AXIS_DIR, `${axisId}.json`);
  const raw = await fsp.readFile(file, 'utf8');
  const cfg = JSON.parse(raw);
  if (cfg.id !== axisId) {
    throw new Error(`axis config id mismatch: file=${axisId} cfg.id=${cfg.id}`);
  }
  axisCache.set(axisId, cfg);
  return cfg;
}

async function listAxes() {
  let files;
  try { files = await fsp.readdir(AXIS_DIR); }
  catch (_e) { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!safeAxisId(id)) continue;
    try {
      const cfg = await loadAxis(id);
      out.push({
        id: cfg.id,
        display_name: cfg.display_name,
        description: cfg.description,
        option_count: cfg.option_count,
        preview_kind: cfg.preview_kind,
        consumed_by_stages: cfg.consumed_by_stages || []
      });
    } catch (_e) { /* skip malformed */ }
  }
  return out;
}

// ----------------------------------------------------------------------------
// LLM bridge — uses claude.sendMessage via project cwd
// ----------------------------------------------------------------------------

function askClaude({ projectId, cwd }, prompt, system = '') {
  return new Promise((resolve, reject) => {
    let acc = '';
    const text = (system ? system + '\n\n' : '') + prompt;
    claude.sendMessage({
      projectId, cwd, text,
      onChunk: (c) => { acc += c; },
      onDone: () => resolve(acc),
      onError: reject
    });
  });
}

// Parse the first JSON array or object from LLM text (handles ```json fences).
function safeParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  // Find first balanced JSON value (array or object)
  for (const open of ['[', '{']) {
    const close = open === '[' ? ']' : '}';
    const start = candidate.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const slice = candidate.slice(start, i + 1);
          try { return JSON.parse(slice); } catch (_e) { break; }
        }
      }
    }
  }
  return null;
}

function fillTemplate(template, vars) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (_m, key) => {
    const parts = key.split('.');
    let cur = vars;
    for (const p of parts) {
      if (cur == null) return '';
      cur = cur[p];
    }
    if (cur == null) return '';
    if (typeof cur === 'object') return JSON.stringify(cur, null, 2);
    return String(cur);
  });
}

// ----------------------------------------------------------------------------
// Option ID + persistence
// ----------------------------------------------------------------------------

function makeOptionId(axisId, spec) {
  const h = crypto
    .createHash('sha256')
    .update(axisId)
    .update('|')
    .update(JSON.stringify(spec || {}))
    .update('|')
    .update(String(Date.now()))
    .update('|')
    .update(crypto.randomBytes(4))
    .digest('hex')
    .slice(0, 12);
  return `opt_${h}`;
}

function buildOption({ axisId, spec, projectId, name, refinementHistory, tags, forReuse }) {
  const id = makeOptionId(axisId, spec);
  return {
    id,
    axis_id: axisId,
    created_at: new Date().toISOString(),
    created_by_project: projectId || null,
    name: typeof name === 'string' ? name : (spec && spec.name) || id,
    spec: spec || {},
    preview: null, // populated by style_preview.js downstream
    refinement_history: Array.isArray(refinementHistory) ? refinementHistory : [],
    tags: Array.isArray(tags) ? tags : [],
    for_reuse: !!forReuse,
    used_in_projects: projectId ? [projectId] : []
  };
}

async function writeOption({ localPath, axisId, option }) {
  const dir = axisOptionsDir(localPath, axisId);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${option.id}.json`);
  await fsp.writeFile(file, JSON.stringify(option, null, 2));
  return file;
}

async function readOption({ localPath, axisId, optionId }) {
  if (!safeOptionId(optionId)) throw new Error(`invalid option id: ${optionId}`);
  const file = path.join(axisOptionsDir(localPath, axisId), `${optionId}.json`);
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function writePicked({ localPath, axisId, optionId }) {
  const file = axisPickedPath(localPath, axisId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify({
    axis_id: axisId,
    option_id: optionId,
    picked_at: new Date().toISOString()
  }, null, 2));
  return file;
}

// ----------------------------------------------------------------------------
// Index (per-project active picks summary)
// ----------------------------------------------------------------------------

async function readIndex(localPath, projectId) {
  const file = projectIndexPath(localPath);
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return {
      project_id: projectId,
      active_picks: {},
      preset_pack_used: null,
      last_modified: new Date().toISOString()
    };
  }
}

async function writeIndex(localPath, index) {
  const file = projectIndexPath(localPath);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  index.last_modified = new Date().toISOString();
  await fsp.writeFile(file, JSON.stringify(index, null, 2));
  return file;
}

async function updateIndexPick({ localPath, projectId, axisId, optionId }) {
  const idx = await readIndex(localPath, projectId);
  if (!idx.project_id) idx.project_id = projectId;
  if (!idx.active_picks) idx.active_picks = {};
  idx.active_picks[axisId] = optionId;
  await writeIndex(localPath, idx);
  return idx;
}

// ----------------------------------------------------------------------------
// Project resolution
// ----------------------------------------------------------------------------

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) throw new Error(`project not found: ${projectId}`);
  if (!proj.local_path) throw new Error(`project ${projectId} has no local_path`);
  return proj;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Generate N candidate options for an axis. Calls the LLM with the axis's
 * prompt_template, then validates each returned object against option_schema.
 *
 * Returns the array of stored Option records (already persisted under the
 * project's asset library options/ dir).
 *
 * The preview field is left null — the caller (style_preview.js) populates
 * it after this call returns.
 */
async function generateOptions({ axisId, projectId, styleGuide, priorPicks, count }) {
  const cfg = await loadAxis(axisId);
  const proj = await resolveProject(projectId);

  const requested = Math.max(1, Math.min(8, count || cfg.option_count || 5));
  const prompt = fillTemplate(cfg.prompt_template || '', {
    style_guide: styleGuide || '(none provided)',
    prior_picks: priorPicks || {},
    count: requested
  });
  const system = [
    'You are a senior Playdate game-design author for 23studios.',
    'Return a single JSON array of exactly the requested number of distinct options.',
    'Every option must conform to the option_schema below.',
    'No prose, no preamble — JSON ONLY (a single array).',
    '',
    'option_schema:',
    JSON.stringify(cfg.option_schema || {}, null, 2)
  ].join('\n');

  const text = await askClaude(
    { projectId, cwd: proj.local_path },
    prompt,
    system
  );

  const parsed = safeParseJson(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`LLM did not return a JSON array for axis ${axisId}`);
  }

  const out = [];
  for (const spec of parsed) {
    if (!spec || typeof spec !== 'object') continue;
    const option = buildOption({
      axisId,
      spec,
      projectId,
      name: spec.name,
      tags: Array.isArray(spec.tags) ? spec.tags : []
    });
    await writeOption({ localPath: proj.local_path, axisId, option });
    out.push(option);
  }

  return out;
}

/**
 * Mark an existing option as the project's active pick for this axis.
 * Updates both styles/<axis>/picked.json and the master index.json.
 */
async function pickOption({ axisId, projectId, optionId }) {
  if (!safeAxisId(axisId)) throw new Error(`invalid axis id: ${axisId}`);
  if (!safeOptionId(optionId)) throw new Error(`invalid option id: ${optionId}`);
  const proj = await resolveProject(projectId);
  // verify the option exists
  await readOption({ localPath: proj.local_path, axisId, optionId });
  await writePicked({ localPath: proj.local_path, axisId, optionId });
  const idx = await updateIndexPick({
    localPath: proj.local_path,
    projectId,
    axisId,
    optionId
  });
  return { axis_id: axisId, option_id: optionId, index: idx };
}

/**
 * Generate a refined option from an existing one + free-text feedback.
 * Original option is kept untouched; new option is stored separately and
 * its id is appended to the original's refinement_history.
 */
async function refineOption({ axisId, projectId, optionId, feedback }) {
  const cfg = await loadAxis(axisId);
  const proj = await resolveProject(projectId);
  const original = await readOption({ localPath: proj.local_path, axisId, optionId });

  const refinementPrompt = cfg.refinement_prompt
    || 'Given the option JSON below and the user feedback, produce ONE revised option that addresses the feedback while staying within option_schema. Return JSON only (a single object).';

  const prompt = [
    refinementPrompt,
    '',
    'ORIGINAL OPTION:',
    JSON.stringify(original.spec, null, 2),
    '',
    'USER FEEDBACK:',
    String(feedback || '').slice(0, 2000),
    '',
    'option_schema:',
    JSON.stringify(cfg.option_schema || {}, null, 2)
  ].join('\n');

  const text = await askClaude(
    { projectId, cwd: proj.local_path },
    prompt,
    'You are a Playdate game-design author. Return JSON only — a single revised option object.'
  );

  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`LLM did not return a JSON object for refinement of ${optionId}`);
  }

  const refined = buildOption({
    axisId,
    spec: parsed,
    projectId,
    name: parsed.name || `${original.name} (refined)`,
    refinementHistory: [{
      parent_id: optionId,
      feedback: String(feedback || '').slice(0, 500),
      created_at: new Date().toISOString()
    }],
    tags: original.tags
  });
  await writeOption({ localPath: proj.local_path, axisId, option: refined });

  // Append breadcrumb to parent
  original.refinement_history = original.refinement_history || [];
  original.refinement_history.push({
    feedback: String(feedback || '').slice(0, 500),
    result_id: refined.id,
    created_at: new Date().toISOString()
  });
  await fsp.writeFile(
    path.join(axisOptionsDir(proj.local_path, axisId), `${original.id}.json`),
    JSON.stringify(original, null, 2)
  );

  return refined;
}

/**
 * Copy a stored option from any scope (project / user / global preset pack)
 * into the target project's library. Does not auto-pick — caller invokes
 * pickOption() after.
 *
 * source.scope: 'project' | 'user' | 'global'
 * source.project_id    (required if scope='project')
 * source.option_id     (required for project + user)
 * source.preset_pack   (required if scope='global')
 */
async function reuseOption({ axisId, source, targetProjectId }) {
  if (!safeAxisId(axisId)) throw new Error(`invalid axis id: ${axisId}`);
  if (!source || typeof source !== 'object') throw new Error('source required');

  const target = await resolveProject(targetProjectId);

  let sourceData = null;

  if (source.scope === 'project') {
    if (!safeOptionId(source.option_id)) throw new Error('source.option_id invalid');
    const srcProj = await resolveProject(source.project_id);
    sourceData = await readOption({
      localPath: srcProj.local_path,
      axisId,
      optionId: source.option_id
    });
  } else if (source.scope === 'user') {
    if (!safeOptionId(source.option_id)) throw new Error('source.option_id invalid');
    const file = path.join(userAxisDir(axisId), `${source.option_id}.json`);
    const raw = await fsp.readFile(file, 'utf8');
    sourceData = JSON.parse(raw);
  } else if (source.scope === 'global') {
    if (!safePackName(source.preset_pack)) throw new Error('source.preset_pack invalid');
    const file = presetPackPath(source.preset_pack, axisId);
    const raw = await fsp.readFile(file, 'utf8');
    sourceData = JSON.parse(raw);
  } else {
    throw new Error(`unknown source.scope: ${source.scope}`);
  }

  // Re-stamp as a fresh option owned by the target project; preserve spec + name
  const copy = buildOption({
    axisId,
    spec: sourceData.spec || sourceData,
    projectId: targetProjectId,
    name: sourceData.name || sourceData.spec?.name,
    tags: sourceData.tags || [],
    forReuse: false
  });
  copy.refinement_history = (sourceData.refinement_history || []).slice();
  copy.refinement_history.push({
    reused_from: { scope: source.scope, ...source },
    created_at: new Date().toISOString()
  });
  await writeOption({ localPath: target.local_path, axisId, option: copy });
  return copy;
}

/**
 * Flag an option as available for reuse at user-scope; copies it into
 * ~/.23studios/user_library/styles/<axis>/<option_id>.json.
 */
async function flagForReuse({ axisId, projectId, optionId }) {
  if (!safeAxisId(axisId)) throw new Error(`invalid axis id: ${axisId}`);
  if (!safeOptionId(optionId)) throw new Error(`invalid option id: ${optionId}`);
  const proj = await resolveProject(projectId);
  const opt = await readOption({ localPath: proj.local_path, axisId, optionId });
  opt.for_reuse = true;
  await fsp.writeFile(
    path.join(axisOptionsDir(proj.local_path, axisId), `${optionId}.json`),
    JSON.stringify(opt, null, 2)
  );
  await fsp.mkdir(userAxisDir(axisId), { recursive: true });
  await fsp.writeFile(
    path.join(userAxisDir(axisId), `${optionId}.json`),
    JSON.stringify(opt, null, 2)
  );
  return opt;
}

/**
 * List stored options at a given scope.
 *
 *   scope='project' -> requires projectId
 *   scope='user'    -> reads from ~/.23studios/user_library/
 *   scope='global'  -> reads from server/data/global_library/preset_packs/<pack>/
 */
async function listLibrary({ axisId, scope, projectId, presetPack }) {
  if (!safeAxisId(axisId)) throw new Error(`invalid axis id: ${axisId}`);

  if (scope === 'project') {
    const proj = await resolveProject(projectId);
    const dir = axisOptionsDir(proj.local_path, axisId);
    let files;
    try { files = await fsp.readdir(dir); }
    catch (_e) { return []; }
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await fsp.readFile(path.join(dir, f), 'utf8');
        out.push(JSON.parse(raw));
      } catch (_e) { /* skip */ }
    }
    return out;
  }

  if (scope === 'user') {
    const dir = userAxisDir(axisId);
    let files;
    try { files = await fsp.readdir(dir); }
    catch (_e) { return []; }
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await fsp.readFile(path.join(dir, f), 'utf8');
        out.push(JSON.parse(raw));
      } catch (_e) { /* skip */ }
    }
    return out;
  }

  if (scope === 'global') {
    if (!safePackName(presetPack)) throw new Error('presetPack required for global scope');
    const file = presetPackPath(presetPack, axisId);
    try {
      const raw = await fsp.readFile(file, 'utf8');
      return [JSON.parse(raw)];
    } catch (_e) { return []; }
  }

  throw new Error(`unknown scope: ${scope}`);
}

/**
 * Read the project's current active picks across all axes. Returns the
 * index.json contents, or a fresh skeleton if missing.
 */
async function getActivePicks(projectId) {
  const proj = await resolveProject(projectId);
  return readIndex(proj.local_path, projectId);
}

module.exports = {
  // axis config
  loadAxis,
  listAxes,

  // option lifecycle
  generateOptions,
  pickOption,
  refineOption,
  reuseOption,
  flagForReuse,
  listLibrary,
  getActivePicks,

  // path helpers (exported for asset_library.js + late_add.js consumption)
  paths: {
    projectAssetLibDir,
    axisOptionsDir,
    axisPickedPath,
    projectIndexPath,
    userAxisDir,
    presetPackPath
  },

  _internals: {
    safeAxisId,
    safeOptionId,
    safePackName,
    makeOptionId,
    buildOption,
    safeParseJson,
    fillTemplate
  }
};
