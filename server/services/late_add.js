'use strict';

// Late-add operations — non-destructive grafts onto a 95%-complete SDK
// project. Per CLAUDE.md: NEVER re-run the full 9-stage autopilot. Only
// regenerate assets whose consumed_by_stages includes a swapped axis.
// Keep replaced assets in the asset library so they can be reverted.
//
// Ops (per Phase 3 plan §6):
//   addScene({ projectId, pitch, insertedAfterSceneId, sceneType, minigameKitId })
//   addMinigameToScene({ projectId, sceneId, minigameKitId, customRecipeSpec })
//   swapStylePick({ projectId, axisId, newOptionId, dryRun })
//   retrofitFeature({ projectId, featureId, params })
//   addLevel({ projectId, levelName, baseTemplate, sourceSceneId })
//   recompile({ projectId })
//
// Each op returns { changes: [...], affected: { scenes: [], chars: [], ... } }.
// The route layer (server/routes/late_add.js) presents the diff to the user
// before commit when dryRun is supported.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projects = require('./projects');
const claude = require('./claude');
const assembly = require('./sdk_prompt_assembly');
const assetLibrary = require('./asset_library');
const styleAxis = require('./style_axis');
const pulpAi = require('./pulp_ai');
const sfxSynth = require('./sfx_synth');
const musicLib = require('./music_library');
const validator = require('./playdate_validator');

const SDK_DATA = 'sdk_data';
const SCENE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const FEATURE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) throw new Error(`project not found: ${projectId}`);
  if (!proj.local_path) throw new Error(`project ${projectId} has no local_path`);
  return proj;
}

function sdkDataPath(localPath) { return path.join(localPath, SDK_DATA); }
function projectJsonPath(localPath) { return path.join(sdkDataPath(localPath), 'project.json'); }
function storyBiblePath(localPath) { return path.join(sdkDataPath(localPath), 'story_bible.md'); }

async function readSdk(localPath) {
  try {
    const raw = await fsp.readFile(projectJsonPath(localPath), 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return { scenes: [], characters: [], startup_scene: null };
  }
}

async function writeSdk(localPath, sdk) {
  await fsp.mkdir(sdkDataPath(localPath), { recursive: true });
  await fsp.writeFile(projectJsonPath(localPath), JSON.stringify(sdk, null, 2));
}

async function readStoryBible(localPath) {
  try {
    const raw = await fsp.readFile(storyBiblePath(localPath), 'utf8');
    return raw.length > 16000 ? raw.slice(0, 16000) + '\n\n[... truncated ...]' : raw;
  } catch (_e) { return null; }
}

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

function safeParseJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const c = fence ? fence[1] : text;
  try { return JSON.parse(c); } catch (_e) {}
  const start = c.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < c.length; i++) {
    if (esc) { esc = false; continue; }
    if (c[i] === '\\') { esc = true; continue; }
    if (c[i] === '"') inStr = !inStr;
    if (inStr) continue;
    if (c[i] === '{') depth++;
    else if (c[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(c.slice(start, i + 1)); } catch (_e) { return null; }
      }
    }
  }
  return null;
}

function newSceneId(name) {
  const base = (name || 'scene').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const hash = crypto.randomBytes(2).toString('hex');
  return `${base.slice(0, 40)}_${hash}`;
}

// ----------------------------------------------------------------------------
// 6.1 Add a new scene
// ----------------------------------------------------------------------------

async function addScene({ projectId, pitch, insertedAfterSceneId, sceneType, minigameKitId }) {
  if (!pitch || typeof pitch !== 'string') throw new Error('pitch required');
  const proj = await resolveProject(projectId);
  const sdk = await readSdk(proj.local_path);
  const storyBible = await readStoryBible(proj.local_path);
  const picks = await assetLibrary.getActivePicksWithSpecs(projectId);
  const claudeCtx = { projectId, cwd: proj.local_path };

  // Ask Claude for a single scene spec consistent with picks + bible
  const sys = assembly.assembleSystemPrompt({
    stageId: 'story',
    storyBible,
    vars: { intake: sdk.intake || {} },
    activePicks: picks,
    extras: 'You output STRICT JSON only. One scene object, NOT an array.'
  });
  const text = await askClaude(
    claudeCtx,
    `Generate ONE new scene matching this pitch: "${pitch}". `
    + `Scene type: ${sceneType || 'auto'}. `
    + (minigameKitId ? `Use minigame kit: ${minigameKitId}. ` : '')
    + 'Return a JSON object with: id, name, description, type, mood, music_intent, '
    + 'mechanic_kit (or null), feature_set (array), exits (array). '
    + 'IMPORTANT: do NOT touch any other scene. id MUST be lowercase snake_case.',
    sys
  );

  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('scene generation failed: bad JSON');

  // Generate stable id if Claude didn't provide one
  if (!parsed.id || !SCENE_ID_RE.test(parsed.id)) {
    parsed.id = newSceneId(parsed.name || 'scene');
  }
  if (minigameKitId && !parsed.mechanic_kit) {
    parsed.mechanic_kit = minigameKitId;
  }

  // Insert into scenes array at the right position
  sdk.scenes = sdk.scenes || [];
  let insertIdx = sdk.scenes.length;
  if (insertedAfterSceneId) {
    const i = sdk.scenes.findIndex((s) => s && s.id === insertedAfterSceneId);
    if (i < 0) throw new Error(`insertedAfterSceneId not found: ${insertedAfterSceneId}`);
    insertIdx = i + 1;
    // Re-wire exits: previous scene's exits become new scene's exits;
    // previous scene now exits to new scene.
    const prev = sdk.scenes[i];
    parsed.exits = Array.isArray(prev.exits) ? prev.exits.slice() : [];
    prev.exits = [{ to_scene: parsed.id, label: 'continue' }];
  }
  sdk.scenes.splice(insertIdx, 0, parsed);

  await writeSdk(proj.local_path, sdk);

  // Generate scene background + Lua via existing helpers
  const generated = { scene_id: parsed.id, assets: [] };

  // Scene background
  const burstPrompt = `${parsed.name}. ${parsed.description || ''} EMPTY scene background — NO human figure visible. 1-bit Playdate, 400x240.`;
  try {
    const r = await pulpAi.generateScene({ prompt: burstPrompt, dim: [400, 240] });
    if (r && r.pngBuffer) {
      const destPng = path.join(sdkDataPath(proj.local_path), 'scenes', `${parsed.id}.png`);
      await fsp.mkdir(path.dirname(destPng), { recursive: true });
      await fsp.writeFile(destPng, r.pngBuffer);
      generated.assets.push({ kind: 'scene_bg', path: destPng });
    }
  } catch (e) {
    generated.assets.push({ kind: 'scene_bg', error: e.message });
  }

  // Scene Lua module
  try {
    const lua = assembly.buildSceneLuaFromFeatures(parsed, parsed.feature_set || [], '');
    const luaPath = path.join(sdkDataPath(proj.local_path), 'scenes', `${parsed.id}.lua`);
    await fsp.writeFile(luaPath, lua);
    generated.assets.push({ kind: 'scene_lua', path: luaPath });
  } catch (e) {
    generated.assets.push({ kind: 'scene_lua', error: e.message });
  }

  // Per-scene BGM via music_library
  try {
    const bgm = await musicLib.pickForScene({
      sceneName: parsed.name,
      sceneDescription: parsed.description,
      moodHint: parsed.mood
    });
    if (bgm) generated.assets.push({ kind: 'scene_music', path: bgm });
  } catch (_e) { /* music optional */ }

  return {
    op: 'addScene',
    changes: [`added scene ${parsed.id}`, ...(insertedAfterSceneId ? [`rewired exits of ${insertedAfterSceneId}`] : [])],
    affected: { scenes: insertedAfterSceneId ? [insertedAfterSceneId, parsed.id] : [parsed.id] },
    scene: parsed,
    generated
  };
}

// ----------------------------------------------------------------------------
// 6.2 Add a new minigame to existing scene
// ----------------------------------------------------------------------------

async function addMinigameToScene({ projectId, sceneId, minigameKitId, customRecipeSpec }) {
  if (!SCENE_ID_RE.test(sceneId || '')) throw new Error(`invalid scene id: ${sceneId}`);
  const proj = await resolveProject(projectId);
  const sdk = await readSdk(proj.local_path);
  const scene = (sdk.scenes || []).find((s) => s && s.id === sceneId);
  if (!scene) throw new Error(`scene not found: ${sceneId}`);

  // Update scene's mechanic kit
  scene.mechanic_kit = minigameKitId || 'custom';
  if (customRecipeSpec && typeof customRecipeSpec === 'object') {
    scene.custom_spec = customRecipeSpec;
  }
  scene.feature_set = Array.from(new Set([...(scene.feature_set || []), 'minigame_runner']));

  await writeSdk(proj.local_path, sdk);

  // Re-emit the scene's Lua to include the kit
  const lua = assembly.buildSceneLuaFromFeatures(scene, scene.feature_set, '');
  const luaPath = path.join(sdkDataPath(proj.local_path), 'scenes', `${scene.id}.lua`);
  await fsp.writeFile(luaPath, lua);

  return {
    op: 'addMinigameToScene',
    changes: [`added minigame ${scene.mechanic_kit} to scene ${sceneId}`],
    affected: { scenes: [sceneId] },
    scene
  };
}

// ----------------------------------------------------------------------------
// 6.3 Swap a style pick mid-project
// ----------------------------------------------------------------------------

async function swapStylePick({ projectId, axisId, newOptionId, dryRun }) {
  const axis = await styleAxis.loadAxis(axisId);
  const proj = await resolveProject(projectId);
  const sdk = await readSdk(proj.local_path);

  const affectedStages = axis.consumed_by_stages || [];
  const affectedScenes = [];
  for (const s of (sdk.scenes || [])) {
    if (!s) continue;
    if (affectedStages.includes('scene_lua')
        || affectedStages.includes('scene_bursts')) {
      affectedScenes.push(s.id);
    }
  }
  const affectedChars = (affectedStages.includes('characters')
    || affectedStages.includes('portrait_bursts'))
    ? (sdk.characters || []).map((c) => c.id).filter(Boolean)
    : [];

  if (dryRun) {
    return {
      op: 'swapStylePick',
      dryRun: true,
      changes: [
        `would swap ${axisId} active pick → ${newOptionId}`,
        `would regenerate ${affectedScenes.length} scene asset(s)`,
        `would regenerate ${affectedChars.length} character portrait(s)`
      ],
      affected: { scenes: affectedScenes, chars: affectedChars, stages: affectedStages }
    };
  }

  // Commit the pick
  await styleAxis.pickOption({ axisId, projectId, optionId: newOptionId });

  const regenerated = { scenes: [], chars: [] };

  // Regenerate scene backgrounds for affected stages
  if (affectedStages.includes('scene_bursts')) {
    for (const sid of affectedScenes) {
      const scene = sdk.scenes.find((s) => s.id === sid);
      if (!scene) continue;
      try {
        const prompt = `${scene.name}. ${scene.description || ''} 1-bit Playdate, 400x240.`;
        const r = await pulpAi.generateScene({ prompt, dim: [400, 240] });
        if (r && r.pngBuffer) {
          const destPng = path.join(sdkDataPath(proj.local_path), 'scenes', `${sid}.png`);
          await fsp.writeFile(destPng, r.pngBuffer);
          regenerated.scenes.push(sid);
        }
      } catch (_e) { /* continue */ }
    }
  }

  // Re-emit scene Lua for affected stages
  if (affectedStages.includes('scene_lua')) {
    for (const sid of affectedScenes) {
      const scene = sdk.scenes.find((s) => s.id === sid);
      if (!scene) continue;
      try {
        const lua = assembly.buildSceneLuaFromFeatures(scene, scene.feature_set || [], '');
        const luaPath = path.join(sdkDataPath(proj.local_path), 'scenes', `${sid}.lua`);
        await fsp.writeFile(luaPath, lua);
        if (!regenerated.scenes.includes(sid)) regenerated.scenes.push(sid);
      } catch (_e) { /* continue */ }
    }
  }

  // Regenerate character portraits
  if (affectedStages.includes('portrait_bursts')) {
    for (const cid of affectedChars) {
      const c = (sdk.characters || []).find((x) => x.id === cid);
      if (!c || !c.portrait_prompt) continue;
      try {
        const r = await pulpAi.generatePortrait({ prompt: c.portrait_prompt });
        if (r && r.pngBuffer) {
          const destPng = path.join(sdkDataPath(proj.local_path), 'characters', `${cid}.png`);
          await fsp.writeFile(destPng, r.pngBuffer);
          regenerated.chars.push(cid);
        }
      } catch (_e) { /* continue */ }
    }
  }

  return {
    op: 'swapStylePick',
    changes: [
      `swapped ${axisId} → ${newOptionId}`,
      `regenerated ${regenerated.scenes.length} scenes`,
      `regenerated ${regenerated.chars.length} portraits`
    ],
    affected: { scenes: regenerated.scenes, chars: regenerated.chars, stages: affectedStages }
  };
}

// ----------------------------------------------------------------------------
// 6.4 Retrofit feature
// ----------------------------------------------------------------------------

const RETROFIT_HANDLERS = {
  save_state_on_scene_change: async ({ sdk, params }) => {
    // Add gameWillTerminate + deviceWillSleep handlers + save calls on scene exit
    sdk.global_features = sdk.global_features || {};
    sdk.global_features.save_on_scene_change = true;
    return { changes: ['enabled save_on_scene_change global feature'] };
  },

  system_menu_item: async ({ sdk, params }) => {
    if (!params || typeof params.slot !== 'number' || typeof params.title !== 'string') {
      throw new Error('system_menu_item requires { slot, title, action }');
    }
    if (params.slot < 1 || params.slot > 3) throw new Error('slot must be 1-3');
    sdk.system_menu = sdk.system_menu || { items: [] };
    const items = sdk.system_menu.items.filter((it) => it.slot !== params.slot);
    items.push({ slot: params.slot, title: params.title, action: params.action || null });
    items.sort((a, b) => a.slot - b.slot);
    sdk.system_menu.items = items;
    return { changes: [`set system menu slot ${params.slot} → "${params.title}"`] };
  },

  pause_image: async ({ sdk, params, projLocalPath }) => {
    sdk.pause_image = sdk.pause_image || {};
    if (params && params.image_path) {
      sdk.pause_image.path = params.image_path;
      return { changes: [`pause_image set from provided path`] };
    }
    if (params && params.image_prompt) {
      try {
        const r = await pulpAi.generateScene({ prompt: params.image_prompt, dim: [400, 240] });
        if (r && r.pngBuffer) {
          const dest = path.join(sdkDataPath(projLocalPath), 'pause_image.png');
          await fsp.writeFile(dest, r.pngBuffer);
          sdk.pause_image.path = dest;
          return { changes: [`pause_image generated at ${dest}`] };
        }
      } catch (e) {
        return { changes: [`pause_image gen failed: ${e.message}`] };
      }
    }
    throw new Error('pause_image requires image_path or image_prompt');
  },

  crank_indicator_for_scene: async ({ sdk, params }) => {
    if (!params || !SCENE_ID_RE.test(params.scene_id || '')) {
      throw new Error('crank_indicator_for_scene requires { scene_id }');
    }
    const scene = (sdk.scenes || []).find((s) => s.id === params.scene_id);
    if (!scene) throw new Error(`scene not found: ${params.scene_id}`);
    scene.feature_set = Array.from(new Set([...(scene.feature_set || []), 'crank_indicator']));
    return { changes: [`enabled crank_indicator on scene ${params.scene_id}`] };
  },

  accelerometer_for_scene: async ({ sdk, params }) => {
    if (!params || !SCENE_ID_RE.test(params.scene_id || '')) {
      throw new Error('accelerometer_for_scene requires { scene_id, use_pattern }');
    }
    const pattern = params.use_pattern || 'tilt_motion';
    if (!['tilt_motion', 'shake_detection', 'orientation_lock'].includes(pattern)) {
      throw new Error(`invalid use_pattern: ${pattern}`);
    }
    const scene = (sdk.scenes || []).find((s) => s.id === params.scene_id);
    if (!scene) throw new Error(`scene not found: ${params.scene_id}`);
    scene.feature_set = Array.from(new Set([...(scene.feature_set || []), `accelerometer_${pattern}`]));
    return { changes: [`enabled accelerometer (${pattern}) on scene ${params.scene_id}`] };
  },

  screen_shake_helper: async ({ sdk }) => {
    sdk.global_features = sdk.global_features || {};
    sdk.global_features.screen_shake_helper = true;
    return { changes: ['screen_shake_helper available to scenes via runtime/animation.lua'] };
  }
};

async function retrofitFeature({ projectId, featureId, params }) {
  if (!FEATURE_ID_RE.test(featureId || '')) throw new Error(`invalid feature id: ${featureId}`);
  const handler = RETROFIT_HANDLERS[featureId];
  if (!handler) throw new Error(`unknown retrofit feature: ${featureId}`);
  const proj = await resolveProject(projectId);
  const sdk = await readSdk(proj.local_path);

  const result = await handler({ sdk, params, projLocalPath: proj.local_path });
  await writeSdk(proj.local_path, sdk);

  // Re-emit scene Lua for any scene whose feature_set was touched (cheap; only
  // affected scenes get rewritten)
  const reemitted = [];
  if (params && SCENE_ID_RE.test(params.scene_id || '')) {
    const scene = (sdk.scenes || []).find((s) => s.id === params.scene_id);
    if (scene) {
      const lua = assembly.buildSceneLuaFromFeatures(scene, scene.feature_set || [], '');
      const luaPath = path.join(sdkDataPath(proj.local_path), 'scenes', `${scene.id}.lua`);
      await fsp.writeFile(luaPath, lua);
      reemitted.push(scene.id);
    }
  }

  return {
    op: 'retrofitFeature',
    feature_id: featureId,
    changes: result.changes,
    affected: { scenes: reemitted }
  };
}

// ----------------------------------------------------------------------------
// 6.5 Add a new level
// ----------------------------------------------------------------------------

async function addLevel({ projectId, levelName, baseTemplate, sourceSceneId }) {
  if (typeof levelName !== 'string' || levelName.length === 0) {
    throw new Error('levelName required');
  }
  const proj = await resolveProject(projectId);
  const sdk = await readSdk(proj.local_path);

  // Find source scene to copy its tile imagetable
  let sourceScene = null;
  if (sourceSceneId) {
    sourceScene = (sdk.scenes || []).find((s) => s.id === sourceSceneId);
  }

  const levelId = newSceneId(levelName);
  const levelDef = {
    level_id: levelId,
    name: levelName,
    base_template: baseTemplate || 'blank',
    source_scene_id: sourceSceneId || null,
    imagetable_path: sourceScene && sourceScene.imagetable_path
      ? sourceScene.imagetable_path
      : 'assets/tiles/default',
    tile_width: 16,
    tile_height: 16,
    grid_width: 25,
    grid_height: 15,
    tiles: new Array(25 * 15).fill(0),
    wall_tile_ids: [],
    spawns: [{ id: 'player_spawn', x: 12, y: 7 }],
    exits: []
  };

  await assetLibrary.writeLevel(projectId, levelId, levelDef);

  // Create a scene shell that loads the level
  const scene = {
    id: levelId,
    name: levelName,
    type: 'level',
    mood: 'neutral',
    music_intent: 'ambient',
    mechanic_kit: 'level_tilemap',
    feature_set: ['level_tilemap', 'player_controls'],
    exits: []
  };
  sdk.scenes = sdk.scenes || [];
  sdk.scenes.push(scene);
  await writeSdk(proj.local_path, sdk);

  const lua = assembly.buildSceneLuaFromFeatures(scene, scene.feature_set, '');
  const luaPath = path.join(sdkDataPath(proj.local_path), 'scenes', `${levelId}.lua`);
  await fsp.writeFile(luaPath, lua);

  return {
    op: 'addLevel',
    changes: [`added level ${levelId} (${levelName})`],
    affected: { levels: [levelId], scenes: [levelId] },
    level: levelDef
  };
}

// ----------------------------------------------------------------------------
// 6.6 Recompile + rebuild
// ----------------------------------------------------------------------------

async function recompile({ projectId }) {
  // Delegates to sdk_export.startExport — late_add doesn't run pdc directly to
  // avoid duplicating the QA checklist / cleanup logic. The route layer can
  // chain this op via sdk_export.startExport after returning.
  return {
    op: 'recompile',
    changes: ['queue rebuild via POST /api/projects/:id/sdk/export'],
    next: { method: 'POST', path: `/api/projects/${projectId}/sdk/export` }
  };
}

module.exports = {
  addScene,
  addMinigameToScene,
  swapStylePick,
  retrofitFeature,
  addLevel,
  recompile,
  RETROFIT_HANDLERS,
  _internals: { safeParseJson, newSceneId }
};
