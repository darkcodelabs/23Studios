'use strict';

// sdk_incremental_regen.js — plan + apply incremental regeneration from bible diffs.
//
// plan(projectId)  — reads diff, returns a regen plan with cost estimate.
// apply(projectId, plan) — executes items in plan selectively.
//
// Does NOT re-run the full 9-stage autopilot. Only regenerates affected assets.
// After apply: calls bible.compile() + bibleDiff.snapshot() to mark committed.
//
// Routes (mounted in routes/regen.js):
//   POST /api/projects/:id/regen/plan
//   POST /api/projects/:id/regen/apply
//   GET  /api/projects/:id/regen/history

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projects = require('./projects');
const pulpAi = require('./pulp_ai');
const bible = require('./sdk_bible');
const bibleDiff = require('./sdk_bible_diff');
const assembly = require('./sdk_prompt_assembly');

const SDK_DATA = 'sdk_data';

// Cost estimates (USD, rough)
const COST = {
  portrait: 0.04,
  scene: 0.06,
  lua: 0.005,
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) { const e = new Error(`project not found: ${projectId}`); e.status = 404; throw e; }
  if (!proj.local_path) { const e = new Error('no_local_path'); e.status = 422; throw e; }
  return proj;
}

function sdkRoot(localPath) {
  return path.join(localPath, SDK_DATA);
}

async function readSdk(localPath) {
  const fp = path.join(sdkRoot(localPath), 'project.json');
  try {
    const raw = await fsp.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return { scenes: [], characters: [] };
  }
}

function regenLogPath(localPath) {
  return path.join(sdkRoot(localPath), 'regen_log.jsonl');
}

async function appendRegenLog(localPath, entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await fsp.appendFile(regenLogPath(localPath), line);
}

async function readRegenLog(localPath) {
  try {
    const raw = await fsp.readFile(regenLogPath(localPath), 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_e) { return null; }
    }).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

// ----------------------------------------------------------------------------
// plan(projectId)
// ----------------------------------------------------------------------------

async function plan(projectId) {
  const proj = await resolveProject(projectId);
  const dfResult = await bibleDiff.diff(proj.local_path, 'latest');
  const sdk = await readSdk(proj.local_path);

  const { impact, since, added, modified, removed } = dfResult;

  // Tone / DO NOT changed → full pipeline required.
  if (impact.tone_changed || impact.do_not_changed) {
    return {
      plan_id: crypto.randomBytes(6).toString('hex'),
      since,
      diff: { added, modified, removed },
      regen_characters: [],
      regen_scenes: [],
      regen_lua: [],
      full_pipeline_required: true,
      full_pipeline_reason: impact.do_not_changed
        ? 'DO NOT section changed — global constraint; full re-run required'
        : 'Tone section changed — global style shift; full re-run required',
      estimated_cost_usd: 0,
    };
  }

  const regen_characters = [];
  const regen_scenes = [];
  const regen_lua = [];

  // Character regeneration from changed cast sections.
  for (const charId of (impact.characters_changed || [])) {
    const c = (sdk.characters || []).find((x) => x && (
      x.id === charId ||
      (x.name || '').toLowerCase().replace(/\s+/g, '_') === charId
    ));
    if (c) {
      regen_characters.push({
        id: c.id,
        name: c.name,
        reason: 'cast section modified',
        would_call: 'runPortraitForChar',
      });
    }
  }

  // Scene asset + lua regeneration from scene_*.md changes.
  const allChangedFiles = [...added, ...modified, ...removed];
  for (const sceneId of (impact.scenes_changed || [])) {
    const scene = (sdk.scenes || []).find((s) => s && s.id === sceneId);
    if (scene) {
      regen_scenes.push({
        id: sceneId,
        name: scene.name,
        reason: `scene_${sceneId}.md modified`,
        would_call: 'runSceneBurstForScene',
      });
      regen_lua.push({
        scene_id: sceneId,
        reason: `scene_${sceneId}.md modified — lua needs re-emit`,
      });
    }
  }

  // Setting anchors change triggers scene asset regen for all scenes (but not full pipeline).
  if (impact.setting_anchors_changed) {
    for (const scene of (sdk.scenes || [])) {
      if (!scene || !scene.id) continue;
      if (!regen_scenes.find((s) => s.id === scene.id)) {
        regen_scenes.push({
          id: scene.id,
          name: scene.name,
          reason: 'setting anchors changed — scene backgrounds need refresh',
          would_call: 'runSceneBurstForScene',
        });
      }
    }
  }

  const cost = regen_characters.length * COST.portrait
    + regen_scenes.length * COST.scene
    + regen_lua.length * COST.lua;

  return {
    plan_id: crypto.randomBytes(6).toString('hex'),
    since,
    diff: { added, modified, removed },
    regen_characters,
    regen_scenes,
    regen_lua,
    full_pipeline_required: false,
    full_pipeline_reason: null,
    estimated_cost_usd: Math.round(cost * 10000) / 10000,
  };
}

// ----------------------------------------------------------------------------
// apply(projectId, planObj, opts)
// opts.items: { characters?: string[], scenes?: string[], lua?: string[] }
//   — subset filter; null = run everything in the plan.
// ----------------------------------------------------------------------------

async function apply(projectId, planObj, opts) {
  if (!planObj) throw new Error('plan required');
  if (planObj.full_pipeline_required) {
    throw Object.assign(new Error('full_pipeline_required'), { status: 422 });
  }

  const proj = await resolveProject(projectId);
  const sdk = await readSdk(proj.local_path);
  const root = sdkRoot(proj.local_path);

  const filter = (opts && opts.items) || null;
  const charFilter = filter && filter.characters ? new Set(filter.characters) : null;
  const sceneFilter = filter && filter.scenes ? new Set(filter.scenes) : null;
  const luaFilter = filter && filter.lua ? new Set(filter.lua) : null;

  const results = { characters: [], scenes: [], lua: [], errors: [] };

  // Regenerate character portraits.
  for (const item of (planObj.regen_characters || [])) {
    if (charFilter && !charFilter.has(item.id)) continue;
    const c = (sdk.characters || []).find((x) => x && x.id === item.id);
    if (!c) { results.errors.push({ id: item.id, kind: 'character', error: 'not_found' }); continue; }
    try {
      const anchor = c.visual_anchor || `${c.role || 'character'} anchor`;
      const promptText = (c.portrait_prompt && c.portrait_prompt.includes(anchor))
        ? c.portrait_prompt
        : `${anchor}. ${c.portrait_prompt || (c.name + ' - ' + c.role)}`;
      const r = await pulpAi.generatePortrait({ prompt: promptText, dim: 64, projectId });
      if (!r.pngBuffer) throw new Error('no png returned');
      const destPng = path.join(root, 'characters', c.id + '.png');
      await fsp.mkdir(path.dirname(destPng), { recursive: true });
      await fsp.writeFile(destPng, r.pngBuffer);
      if (r.sourceBuffer) {
        const srcDir = path.join(root, 'art_source', 'characters');
        await fsp.mkdir(srcDir, { recursive: true });
        await fsp.writeFile(path.join(srcDir, c.id + '.png'), r.sourceBuffer);
      }
      results.characters.push({ id: c.id, bytes: r.pngBuffer.length });
    } catch (e) {
      results.errors.push({ id: item.id, kind: 'character', error: e.message });
    }
  }

  // Regenerate scene backgrounds.
  for (const item of (planObj.regen_scenes || [])) {
    if (sceneFilter && !sceneFilter.has(item.id)) continue;
    const scene = (sdk.scenes || []).find((s) => s && s.id === item.id);
    if (!scene) { results.errors.push({ id: item.id, kind: 'scene', error: 'not_found' }); continue; }
    try {
      const prompt = `${scene.name}. ${scene.description || ''} EMPTY scene background — NO human figure visible. 1-bit Playdate, 400x240.`;
      const r = await pulpAi.generateScene({ prompt, dim: [400, 240], projectId });
      if (!r.pngBuffer) throw new Error('no png returned');
      const destPng = path.join(root, 'scenes', scene.id + '.png');
      await fsp.mkdir(path.dirname(destPng), { recursive: true });
      await fsp.writeFile(destPng, r.pngBuffer);
      if (r.sourceBuffer) {
        const srcDir = path.join(root, 'art_source', 'scenes');
        await fsp.mkdir(srcDir, { recursive: true });
        await fsp.writeFile(path.join(srcDir, scene.id + '.png'), r.sourceBuffer);
      }
      results.scenes.push({ id: scene.id, bytes: r.pngBuffer.length });
    } catch (e) {
      results.errors.push({ id: item.id, kind: 'scene', error: e.message });
    }
  }

  // Re-emit scene Lua for changed scenes.
  for (const item of (planObj.regen_lua || [])) {
    if (luaFilter && !luaFilter.has(item.scene_id)) continue;
    const scene = (sdk.scenes || []).find((s) => s && s.id === item.scene_id);
    if (!scene) { results.errors.push({ id: item.scene_id, kind: 'lua', error: 'not_found' }); continue; }
    try {
      const lua = assembly.buildSceneLuaFromFeatures(scene, scene.feature_set || [], '');
      const luaPath = path.join(root, 'scenes', scene.id + '.lua');
      await fsp.mkdir(path.dirname(luaPath), { recursive: true });
      await fsp.writeFile(luaPath, lua);
      results.lua.push({ scene_id: scene.id });
    } catch (e) {
      results.errors.push({ id: item.scene_id, kind: 'lua', error: e.message });
    }
  }

  // Compile bible + snapshot to mark this regen committed.
  try { await bible.compile(proj.local_path); } catch (_e) { /* non-fatal */ }
  try { await bibleDiff.snapshot(proj.local_path); } catch (_e) { /* non-fatal */ }

  const logEntry = {
    plan_id: planObj.plan_id || null,
    projectId,
    results,
    since: planObj.since || null,
  };
  await appendRegenLog(proj.local_path, logEntry);

  return results;
}

// ----------------------------------------------------------------------------
// history(projectId)
// ----------------------------------------------------------------------------

async function history(projectId) {
  const proj = await resolveProject(projectId);
  return readRegenLog(proj.local_path);
}

module.exports = { plan, apply, history };
