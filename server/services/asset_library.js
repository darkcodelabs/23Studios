'use strict';

// Asset library — per-project + user + global scope index.
//
// Wraps style_axis paths with higher-level queries:
//   getActivePicks(projectId)            -> full index.json
//   getActivePicksWithSpecs(projectId)   -> {axisId: {...option}} ready for prompt injection
//   listProjectOptions(projectId, axisId?)  -> options stored for a project (filterable)
//   importPresetPack(projectId, packId)  -> copies pack picks into project library
//   setPresetPackUsed(projectId, packId) -> records which pack seeded the project
//
// Also tracks shared_assets/ (hand-imported art/audio outside the style flow)
// and npc_dialogs/ + levels/ subdirs (consumed by npc_dialog_tool + level_editor).

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const styleAxis = require('./style_axis');
const presetPacks = require('./preset_packs');

const { paths: SP } = styleAxis;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) throw new Error(`project not found: ${projectId}`);
  if (!proj.local_path) throw new Error(`project ${projectId} has no local_path`);
  return proj;
}

function sharedAssetsDir(localPath) {
  return path.join(SP.projectAssetLibDir(localPath), 'shared_assets');
}

function npcDialogsDir(localPath) {
  return path.join(SP.projectAssetLibDir(localPath), 'npc_dialogs');
}

function levelsDir(localPath) {
  return path.join(SP.projectAssetLibDir(localPath), 'levels');
}

// ----------------------------------------------------------------------------
// Active picks
// ----------------------------------------------------------------------------

async function getActivePicks(projectId) {
  return styleAxis.getActivePicks(projectId);
}

/**
 * Returns a map { axisId: optionRecord } for every axis that has an active
 * pick. Used by sdk_prompt_assembly.formatActivePicks() to inline picks into
 * the system prompt.
 */
async function getActivePicksWithSpecs(projectId) {
  const proj = await resolveProject(projectId);
  const idx = await styleAxis.getActivePicks(projectId);
  const out = {};
  if (!idx || !idx.active_picks) return out;
  for (const [axisId, optionId] of Object.entries(idx.active_picks)) {
    if (!optionId) continue;
    // optionId may be string or array (minigame_style supports multi-pick)
    const ids = Array.isArray(optionId) ? optionId : [optionId];
    const records = [];
    for (const id of ids) {
      try {
        const file = path.join(SP.axisOptionsDir(proj.local_path, axisId), `${id}.json`);
        const raw = await fsp.readFile(file, 'utf8');
        records.push(JSON.parse(raw));
      } catch (_e) { /* missing — skip */ }
    }
    out[axisId] = Array.isArray(optionId) ? records : (records[0] || null);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Project options
// ----------------------------------------------------------------------------

async function listProjectOptions(projectId, axisId) {
  const proj = await resolveProject(projectId);
  if (axisId) {
    return styleAxis.listLibrary({ axisId, scope: 'project', projectId });
  }
  // walk all axes
  const all = {};
  const stylesRoot = path.join(SP.projectAssetLibDir(proj.local_path), 'styles');
  let dirs;
  try { dirs = await fsp.readdir(stylesRoot); }
  catch (_e) { return all; }
  for (const d of dirs) {
    try {
      all[d] = await styleAxis.listLibrary({ axisId: d, scope: 'project', projectId });
    } catch (_e) { /* skip */ }
  }
  return all;
}

// ----------------------------------------------------------------------------
// Preset pack import
// ----------------------------------------------------------------------------

/**
 * Copy every axis pick from a preset pack into the project library.
 * Does NOT auto-pick — caller invokes pickOption per axis after, or calls
 * importPresetPackAndPick to do both.
 */
async function importPresetPack(projectId, packId) {
  const pack = await presetPacks.loadPack(packId);
  if (!pack) throw new Error(`unknown preset pack: ${packId}`);
  const proj = await resolveProject(projectId);

  const created = {};
  for (const [axisId, packEntry] of Object.entries(pack.axis_picks || {})) {
    if (!packEntry || !packEntry.spec) continue;
    const option = styleAxis._internals.buildOption({
      axisId,
      spec: packEntry.spec,
      projectId,
      name: packEntry.name || packEntry.spec.name,
      tags: ['from_preset_pack', packId]
    });
    // write directly via path helper (avoids re-importing style_axis private)
    const dir = SP.axisOptionsDir(proj.local_path, axisId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, `${option.id}.json`),
      JSON.stringify(option, null, 2)
    );
    created[axisId] = option;
  }

  await setPresetPackUsed(projectId, packId);
  return created;
}

async function importPresetPackAndPick(projectId, packId) {
  const created = await importPresetPack(projectId, packId);
  const picks = {};
  for (const [axisId, opt] of Object.entries(created)) {
    await styleAxis.pickOption({ axisId, projectId, optionId: opt.id });
    picks[axisId] = opt.id;
  }
  return { created, picks };
}

async function setPresetPackUsed(projectId, packId) {
  const proj = await resolveProject(projectId);
  const file = SP.projectIndexPath(proj.local_path);
  let idx;
  try { idx = JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (_e) { idx = { project_id: projectId, active_picks: {} }; }
  idx.preset_pack_used = packId;
  idx.last_modified = new Date().toISOString();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(idx, null, 2));
  return idx;
}

// ----------------------------------------------------------------------------
// Shared assets (hand-imported)
// ----------------------------------------------------------------------------

async function ensureSubdirs(projectId) {
  const proj = await resolveProject(projectId);
  await fsp.mkdir(sharedAssetsDir(proj.local_path), { recursive: true });
  await fsp.mkdir(path.join(sharedAssetsDir(proj.local_path), 'sprites'), { recursive: true });
  await fsp.mkdir(path.join(sharedAssetsDir(proj.local_path), 'sounds'), { recursive: true });
  await fsp.mkdir(path.join(sharedAssetsDir(proj.local_path), 'fonts'), { recursive: true });
  await fsp.mkdir(npcDialogsDir(proj.local_path), { recursive: true });
  await fsp.mkdir(levelsDir(proj.local_path), { recursive: true });
  return proj.local_path;
}

async function listSharedAssets(projectId, category) {
  const proj = await resolveProject(projectId);
  const dir = path.join(sharedAssetsDir(proj.local_path), category || '');
  try {
    const files = await fsp.readdir(dir);
    return files.map((f) => ({
      name: f,
      path: path.join(dir, f),
      category: category || null
    }));
  } catch (_e) { return []; }
}

// ----------------------------------------------------------------------------
// NPC + level CRUD pass-throughs (storage only — editors live elsewhere)
// ----------------------------------------------------------------------------

async function writeNpcDialog(projectId, npcId, dialogTree) {
  if (typeof npcId !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(npcId)) {
    throw new Error(`invalid npc id: ${npcId}`);
  }
  const proj = await resolveProject(projectId);
  const file = path.join(npcDialogsDir(proj.local_path), `${npcId}.json`);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(dialogTree, null, 2));
  return file;
}

async function readNpcDialog(projectId, npcId) {
  const proj = await resolveProject(projectId);
  const file = path.join(npcDialogsDir(proj.local_path), `${npcId}.json`);
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function listNpcDialogs(projectId) {
  const proj = await resolveProject(projectId);
  try {
    const files = await fsp.readdir(npcDialogsDir(proj.local_path));
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch (_e) { return []; }
}

async function deleteNpcDialog(projectId, npcId) {
  const proj = await resolveProject(projectId);
  const file = path.join(npcDialogsDir(proj.local_path), `${npcId}.json`);
  try { await fsp.unlink(file); } catch (_e) { /* ok */ }
  return true;
}

async function writeLevel(projectId, levelId, levelDef) {
  if (typeof levelId !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(levelId)) {
    throw new Error(`invalid level id: ${levelId}`);
  }
  const proj = await resolveProject(projectId);
  const file = path.join(levelsDir(proj.local_path), `${levelId}.json`);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(levelDef, null, 2));
  return file;
}

async function readLevel(projectId, levelId) {
  const proj = await resolveProject(projectId);
  const file = path.join(levelsDir(proj.local_path), `${levelId}.json`);
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function listLevels(projectId) {
  const proj = await resolveProject(projectId);
  try {
    const files = await fsp.readdir(levelsDir(proj.local_path));
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch (_e) { return []; }
}

async function deleteLevel(projectId, levelId) {
  const proj = await resolveProject(projectId);
  const file = path.join(levelsDir(proj.local_path), `${levelId}.json`);
  try { await fsp.unlink(file); } catch (_e) { /* ok */ }
  return true;
}

module.exports = {
  // active picks
  getActivePicks,
  getActivePicksWithSpecs,

  // project options
  listProjectOptions,

  // preset packs
  importPresetPack,
  importPresetPackAndPick,
  setPresetPackUsed,

  // shared assets
  ensureSubdirs,
  listSharedAssets,

  // npc dialogs
  writeNpcDialog,
  readNpcDialog,
  listNpcDialogs,
  deleteNpcDialog,

  // levels
  writeLevel,
  readLevel,
  listLevels,
  deleteLevel,

  // paths (for late_add and other consumers)
  paths: {
    projectAssetLibDir: SP.projectAssetLibDir,
    sharedAssetsDir,
    npcDialogsDir,
    levelsDir
  }
};
