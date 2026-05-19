'use strict';

// Phase 6 B2 — Scene Manager service.
//
// Given a (project, scene_id) returns everything the drilldown UI needs:
//   - card (same shape as B1 storyboard card)
//   - 6-stage state machine status:
//       prompt_drafted, asset_generated, qa_passed, lua_written,
//       sim_tested, shipped
//   - per-stage detail blobs (prompt text, qa report, lua source, etc.)
//   - dependency map: scenes that block this one, scenes this one blocks
//   - canon section cited (if recorded in sdk_data/scenes/<id>.json)
//
// Stage derivation rules (kept dumb on purpose — the source of truth is the
// filesystem + sdk_data/project.json, not a parallel status DB):
//
//   prompt_drafted  -> sdk_data/scenes/<id>.json exists with a non-empty
//                      `prompt` OR project.json.scenes[i].description set
//   asset_generated -> sdk_data/scenes/<id>.png exists
//   qa_passed       -> sdk_data/scenes/<id>.json.qa.failed === false
//                      OR sdk_data/qa_report.json[id].failed === false
//   lua_written     -> source/scenes/<id>.lua (or nested equivalent) exists
//                      OR project.json.scenes[i].lua non-empty
//   sim_tested      -> sdk_data/sim_results.json[id].passed === true
//   shipped         -> build/<latest>.pdx/scenes/<id>.* exists OR
//                      project.json.scenes[i].shipped === true

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const storyboard = require('./storyboard');

async function readJsonSafe(p) {
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); }
  catch (_e) { return null; }
}
async function readTextSafe(p, max = 64 * 1024) {
  try {
    const stat = await fsp.stat(p);
    if (!stat.isFile()) return null;
    const fd = await fsp.open(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, max));
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      return buf.slice(0, bytesRead).toString('utf8');
    } finally { await fd.close(); }
  } catch (_e) { return null; }
}

// Find the matching Lua file for a scene_id, including the nested
// composite-id encoding storyboard.js uses (pwnglove_panel_wires ->
// pwnglove/panel_wires.lua).
async function findLuaForScene(root, sceneId) {
  const scenesDir = path.join(root, 'source', 'scenes');
  if (!fs.existsSync(scenesDir)) return null;
  const direct = path.join(scenesDir, sceneId + '.lua');
  if (fs.existsSync(direct)) return direct;
  // Try splitting composite ids on '_' from the left, longest first.
  const parts = sceneId.split('_');
  for (let i = parts.length - 1; i >= 1; i--) {
    const dir = parts.slice(0, i).join('/');
    const file = parts.slice(i).join('_') + '.lua';
    const cand = path.join(scenesDir, dir, file);
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function relIfUnder(root, abs) {
  if (!abs) return null;
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return null;
  return rel;
}

async function buildSceneDetail(project, sceneId) {
  const local = project.local_path;
  if (!local || !fs.existsSync(local)) {
    const e = new Error('local_path_missing');
    e.status = 500;
    throw e;
  }

  // Reuse storyboard.buildStoryboard so the card shape stays in lockstep.
  const board = await storyboard.buildStoryboard(project);
  const card = board.scenes.find((s) => s.scene_id === sceneId);
  if (!card) {
    const e = new Error('scene_not_found');
    e.status = 404;
    throw e;
  }

  const sdkProjectFile = path.join(local, 'sdk_data', 'project.json');
  const sdkProject = await readJsonSafe(sdkProjectFile);
  const manifestScene =
    (sdkProject && Array.isArray(sdkProject.scenes))
      ? sdkProject.scenes.find((s) => s.id === sceneId) || null
      : null;

  const sceneJsonPath = path.join(local, 'sdk_data', 'scenes', sceneId + '.json');
  const sceneJson = await readJsonSafe(sceneJsonPath);

  const luaAbs = await findLuaForScene(local, sceneId);
  const luaText = luaAbs ? await readTextSafe(luaAbs) : null;

  const pngAbs = path.join(local, 'sdk_data', 'scenes', sceneId + '.png');
  const pngExists = fs.existsSync(pngAbs);

  // QA report — either inline on the per-scene json or in a global file.
  let qaReport = null;
  if (sceneJson && sceneJson.qa) qaReport = sceneJson.qa;
  if (!qaReport) {
    const globalQa = await readJsonSafe(path.join(local, 'sdk_data', 'qa_report.json'));
    if (globalQa && globalQa[sceneId]) qaReport = globalQa[sceneId];
  }

  // Sim results — same pattern.
  let simResult = null;
  if (sceneJson && sceneJson.sim) simResult = sceneJson.sim;
  if (!simResult) {
    const globalSim = await readJsonSafe(path.join(local, 'sdk_data', 'sim_results.json'));
    if (globalSim && globalSim[sceneId]) simResult = globalSim[sceneId];
  }

  // Shipped check — look in any build/<*>.pdx for a matching scene asset.
  let shipped = false;
  const buildDir = path.join(local, 'build');
  if (fs.existsSync(buildDir)) {
    try {
      const pdxes = (await fsp.readdir(buildDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name.endsWith('.pdx'));
      for (const d of pdxes) {
        const cand = path.join(buildDir, d.name, 'scenes', sceneId + '.pdz');
        const candPng = path.join(buildDir, d.name, 'scenes', sceneId + '.png');
        if (fs.existsSync(cand) || fs.existsSync(candPng)) { shipped = true; break; }
      }
    } catch (_e) { /* ignore */ }
  }
  if (manifestScene && manifestScene.shipped) shipped = true;

  const promptText =
    (sceneJson && sceneJson.prompt) ||
    (manifestScene && (manifestScene.prompt || manifestScene.description)) ||
    null;

  const stages = {
    prompt_drafted: {
      done: !!promptText,
      prompt: promptText || null
    },
    asset_generated: {
      done: pngExists,
      asset_path: pngExists ? relIfUnder(local, pngAbs) : null
    },
    qa_passed: {
      done: !!(qaReport && qaReport.failed === false),
      report: qaReport || null
    },
    lua_written: {
      done: !!(luaText && luaText.trim().length > 0) || !!(manifestScene && manifestScene.lua),
      lua_path: luaAbs ? relIfUnder(local, luaAbs) : null,
      lua_text: luaText || (manifestScene && manifestScene.lua) || null
    },
    sim_tested: {
      done: !!(simResult && simResult.passed === true),
      result: simResult || null
    },
    shipped: {
      done: shipped
    }
  };

  // Dependency map — derive from sceneJson.dependencies + reverse-lookup.
  let blockedBy = [];
  let blocks = [];
  if (sceneJson && Array.isArray(sceneJson.dependencies)) {
    blockedBy = sceneJson.dependencies.slice();
  }
  if (manifestScene && Array.isArray(manifestScene.dependencies)) {
    for (const d of manifestScene.dependencies) if (!blockedBy.includes(d)) blockedBy.push(d);
  }
  // Reverse-lookup blocks: scan every other manifest scene's deps for this id.
  if (sdkProject && Array.isArray(sdkProject.scenes)) {
    for (const s of sdkProject.scenes) {
      if (!s || s.id === sceneId) continue;
      const deps = Array.isArray(s.dependencies) ? s.dependencies : [];
      if (deps.includes(sceneId)) blocks.push(s.id);
    }
  }

  // Canon section cited.
  const canonSection =
    (sceneJson && (sceneJson.canon_section || sceneJson.canon)) ||
    (manifestScene && (manifestScene.canon_section || manifestScene.canon)) ||
    null;

  // Skill rules invoked (free-form list).
  const skillRules =
    (sceneJson && Array.isArray(sceneJson.skill_rules) ? sceneJson.skill_rules : null) ||
    (manifestScene && Array.isArray(manifestScene.skill_rules) ? manifestScene.skill_rules : null) ||
    [];

  return {
    project_id: project.id,
    project_name: project.name,
    local_path: project.local_path,
    card,
    canon_section: canonSection,
    skill_rules: skillRules,
    stages,
    dependencies: {
      blocked_by: blockedBy,
      blocks
    }
  };
}

module.exports = { buildSceneDetail, _internals: { findLuaForScene } };
