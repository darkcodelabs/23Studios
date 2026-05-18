'use strict';

// Minigame editor — per-kit configurators for the recipes in
// server/data/minigame_recipes.seed.json that benefit from visual config.
//
// Per CLAUDE.md: reference minigame_recipes.seed.json, don't duplicate.
// This module reads the seed catalog, validates per-kit config JSON, and
// stores per-scene config under <project>/sdk_data/minigame_configs/<scene_id>.json
//
// Supported kits with editors:
//   crank_lockpick     — pin positions on the dial
//   rhythm_crank       — note timeline synced to a music track
//   code_lock_combo    — 4 digit combo + wrong-attempt punishment
//   memory_recall      — symbol set + round-by-round sequence lengths
//
// Kits without editors (use defaults from the recipe seed): tilt_maze,
// dialog_wheel, character_creator_crank, conveyor_sort, wave_defense,
// top_down_explore, side_scroll_platform.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

const RECIPES_PATH = path.join(__dirname, '..', 'data', 'minigame_recipes.seed.json');
const CONFIG_SUBDIR = path.join('sdk_data', 'minigame_configs');

const SCENE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const SUPPORTED_KITS = new Set(['crank_lockpick', 'rhythm_crank', 'code_lock_combo', 'memory_recall']);

let recipesCache = null;
function loadRecipes() {
  if (recipesCache) return recipesCache;
  try {
    recipesCache = JSON.parse(fs.readFileSync(RECIPES_PATH, 'utf8'));
  } catch (_e) { recipesCache = { recipes: {} }; }
  return recipesCache;
}

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) throw new Error(`project not found: ${projectId}`);
  if (!proj.local_path) throw new Error(`project ${projectId} has no local_path`);
  return proj;
}

function configPath(localPath, sceneId) {
  return path.join(localPath, CONFIG_SUBDIR, `${sceneId}.json`);
}

// ----------------------------------------------------------------------------
// Per-kit validators
// ----------------------------------------------------------------------------

const VALIDATORS = {
  crank_lockpick(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('config required');
    if (!Array.isArray(cfg.pins) || cfg.pins.length < 3 || cfg.pins.length > 7) {
      throw new Error('pins: array of 3-7 entries required');
    }
    for (const [i, p] of cfg.pins.entries()) {
      if (typeof p.angle !== 'number' || p.angle < 0 || p.angle >= 360) {
        throw new Error(`pin ${i}: angle 0..359 required`);
      }
      if (typeof p.window_deg !== 'number' || p.window_deg < 4 || p.window_deg > 60) {
        throw new Error(`pin ${i}: window_deg 4..60 required`);
      }
    }
    if (cfg.tension_threshold !== undefined
        && (typeof cfg.tension_threshold !== 'number' || cfg.tension_threshold <= 0)) {
      throw new Error('tension_threshold must be positive number');
    }
    return cfg;
  },

  rhythm_crank(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('config required');
    if (typeof cfg.bpm !== 'number' || cfg.bpm < 40 || cfg.bpm > 240) {
      throw new Error('bpm 40..240 required');
    }
    if (typeof cfg.music_track !== 'string') throw new Error('music_track required');
    if (!Array.isArray(cfg.notes)) throw new Error('notes array required');
    for (const [i, n] of cfg.notes.entries()) {
      if (typeof n.beat !== 'number' || n.beat < 0) throw new Error(`note ${i}: beat required`);
      if (typeof n.direction !== 'string' || !['cw', 'ccw', 'press'].includes(n.direction)) {
        throw new Error(`note ${i}: direction cw|ccw|press required`);
      }
    }
    return cfg;
  },

  code_lock_combo(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('config required');
    if (!Array.isArray(cfg.combo) || cfg.combo.length !== 4) {
      throw new Error('combo: array of 4 digits required');
    }
    for (const [i, d] of cfg.combo.entries()) {
      if (!Number.isInteger(d) || d < 0 || d > 9) throw new Error(`combo[${i}]: 0-9 required`);
    }
    if (cfg.wrong_attempt_punishment !== undefined
        && !['none', 'reset_dial', 'lock_for_seconds'].includes(cfg.wrong_attempt_punishment)) {
      throw new Error('wrong_attempt_punishment: none | reset_dial | lock_for_seconds');
    }
    if (cfg.lock_seconds !== undefined
        && (!Number.isInteger(cfg.lock_seconds) || cfg.lock_seconds < 0)) {
      throw new Error('lock_seconds must be non-negative integer');
    }
    return cfg;
  },

  memory_recall(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('config required');
    if (!Array.isArray(cfg.symbols) || cfg.symbols.length < 2 || cfg.symbols.length > 16) {
      throw new Error('symbols: array of 2-16 entries required');
    }
    for (const [i, s] of cfg.symbols.entries()) {
      if (typeof s !== 'string') throw new Error(`symbols[${i}] must be string`);
    }
    if (!Array.isArray(cfg.round_lengths)) throw new Error('round_lengths required');
    for (const [i, n] of cfg.round_lengths.entries()) {
      if (!Number.isInteger(n) || n < 1 || n > 32) {
        throw new Error(`round_lengths[${i}]: 1-32 required`);
      }
    }
    return cfg;
  }
};

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

function listSupportedKits() {
  return Array.from(SUPPORTED_KITS);
}

function getKitRecipe(kitId) {
  const recipes = loadRecipes();
  return (recipes.recipes && recipes.recipes[kitId]) || null;
}

function defaultConfigForKit(kitId) {
  switch (kitId) {
    case 'crank_lockpick':
      return {
        pins: [
          { angle: 30, window_deg: 15 },
          { angle: 90, window_deg: 12 },
          { angle: 180, window_deg: 10 },
          { angle: 250, window_deg: 12 },
          { angle: 320, window_deg: 15 }
        ],
        tension_threshold: 1.0
      };
    case 'rhythm_crank':
      return {
        bpm: 120,
        music_track: 'sounds/song_01.wav',
        notes: [
          { beat: 1, direction: 'cw' },
          { beat: 2, direction: 'cw' },
          { beat: 3, direction: 'press' },
          { beat: 4, direction: 'ccw' }
        ]
      };
    case 'code_lock_combo':
      return {
        combo: [4, 2, 0, 7],
        wrong_attempt_punishment: 'reset_dial',
        lock_seconds: 0
      };
    case 'memory_recall':
      return {
        symbols: ['up', 'down', 'left', 'right'],
        round_lengths: [3, 4, 5, 6, 7]
      };
    default:
      return null;
  }
}

async function readConfig(projectId, sceneId) {
  if (!SCENE_ID_RE.test(sceneId || '')) throw new Error(`invalid scene id: ${sceneId}`);
  const proj = await resolveProject(projectId);
  try {
    const raw = await fsp.readFile(configPath(proj.local_path, sceneId), 'utf8');
    return JSON.parse(raw);
  } catch (_e) { return null; }
}

async function writeConfig(projectId, sceneId, kitId, cfg) {
  if (!SCENE_ID_RE.test(sceneId || '')) throw new Error(`invalid scene id: ${sceneId}`);
  if (!SUPPORTED_KITS.has(kitId)) throw new Error(`unsupported kit: ${kitId}`);
  const validator = VALIDATORS[kitId];
  if (!validator) throw new Error(`no validator for kit: ${kitId}`);
  const validated = validator(cfg);
  const proj = await resolveProject(projectId);
  const file = configPath(proj.local_path, sceneId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const payload = { kit_id: kitId, scene_id: sceneId, config: validated, saved_at: new Date().toISOString() };
  await fsp.writeFile(file, JSON.stringify(payload, null, 2));
  return payload;
}

async function listConfigs(projectId) {
  const proj = await resolveProject(projectId);
  const dir = path.join(proj.local_path, CONFIG_SUBDIR);
  try {
    const files = await fsp.readdir(dir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch (_e) { return []; }
}

async function deleteConfig(projectId, sceneId) {
  if (!SCENE_ID_RE.test(sceneId || '')) throw new Error(`invalid scene id: ${sceneId}`);
  const proj = await resolveProject(projectId);
  try { await fsp.unlink(configPath(proj.local_path, sceneId)); } catch (_e) { /* ok */ }
  return true;
}

module.exports = {
  listSupportedKits,
  getKitRecipe,
  defaultConfigForKit,
  readConfig,
  writeConfig,
  listConfigs,
  deleteConfig,
  _internals: { VALIDATORS, SUPPORTED_KITS }
};
