'use strict';

// Level editor — tile-map CRUD with imagetable refs.
//
// Per CLAUDE.md: scenes load levels via gfx.tilemap.new + setTiles. Each
// level has a flat tile array, marked wall ids, spawn points, exits to
// other scenes.
//
// Storage: <project>/sdk_data/asset_library/levels/<level_id>.json

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const assetLibrary = require('./asset_library');

const LEVEL_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

function safeLevelId(id) { return typeof id === 'string' && LEVEL_ID_RE.test(id); }

function validateLevel(level) {
  if (!level || typeof level !== 'object') throw new Error('level must be an object');
  if (!safeLevelId(level.level_id)) throw new Error(`invalid level_id: ${level.level_id}`);
  if (typeof level.imagetable_path !== 'string') throw new Error('imagetable_path required');

  const tw = Number(level.tile_width);
  const th = Number(level.tile_height);
  if (!Number.isInteger(tw) || tw < 8 || tw > 64) throw new Error(`tile_width invalid: ${tw}`);
  if (!Number.isInteger(th) || th < 8 || th > 64) throw new Error(`tile_height invalid: ${th}`);

  const gw = Number(level.grid_width);
  const gh = Number(level.grid_height);
  if (!Number.isInteger(gw) || gw < 1 || gw > 256) throw new Error(`grid_width invalid: ${gw}`);
  if (!Number.isInteger(gh) || gh < 1 || gh > 256) throw new Error(`grid_height invalid: ${gh}`);

  if (!Array.isArray(level.tiles)) throw new Error('tiles must be array');
  const expectedLen = gw * gh;
  if (level.tiles.length !== expectedLen) {
    throw new Error(`tiles length ${level.tiles.length} != grid_width*grid_height ${expectedLen}`);
  }
  for (const t of level.tiles) {
    if (!Number.isInteger(t) || t < 0 || t > 4095) {
      throw new Error(`invalid tile id: ${t}`);
    }
  }

  if (level.wall_tile_ids && !Array.isArray(level.wall_tile_ids)) {
    throw new Error('wall_tile_ids must be array');
  }
  if (level.spawns && !Array.isArray(level.spawns)) throw new Error('spawns must be array');
  if (level.exits && !Array.isArray(level.exits)) throw new Error('exits must be array');

  for (const s of (level.spawns || [])) {
    if (typeof s.id !== 'string') throw new Error('spawn.id required');
    if (!Number.isInteger(s.x) || s.x < 0 || s.x >= gw) throw new Error(`spawn ${s.id}: x out of range`);
    if (!Number.isInteger(s.y) || s.y < 0 || s.y >= gh) throw new Error(`spawn ${s.id}: y out of range`);
  }

  for (const e of (level.exits || [])) {
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y)) throw new Error('exit needs integer x,y');
    if (typeof e.to_scene !== 'string') throw new Error('exit.to_scene required');
  }

  return level;
}

function newBlankLevel({ levelId, imagetablePath, tileW = 16, tileH = 16, gridW = 25, gridH = 15 }) {
  return {
    level_id: levelId,
    imagetable_path: imagetablePath,
    tile_width: tileW,
    tile_height: tileH,
    grid_width: gridW,
    grid_height: gridH,
    tiles: new Array(gridW * gridH).fill(0),
    wall_tile_ids: [],
    spawns: [{ id: 'player_spawn', x: Math.floor(gridW / 2), y: Math.floor(gridH / 2) }],
    exits: []
  };
}

async function listLevels(projectId) {
  return assetLibrary.listLevels(projectId);
}

async function readLevel(projectId, levelId) {
  return assetLibrary.readLevel(projectId, levelId);
}

async function writeLevel(projectId, levelId, level) {
  if (!safeLevelId(levelId)) throw new Error(`invalid level_id: ${levelId}`);
  if (level.level_id !== levelId) level.level_id = levelId;
  validateLevel(level);
  return assetLibrary.writeLevel(projectId, levelId, level);
}

async function deleteLevel(projectId, levelId) {
  return assetLibrary.deleteLevel(projectId, levelId);
}

/**
 * Paint a rect into the tile array (inclusive bounds). Used by the editor
 * for bulk-fill ops.
 */
function paintRect(level, x0, y0, x1, y1, tileId) {
  const gw = level.grid_width;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (x < 0 || x >= gw || y < 0 || y >= level.grid_height) continue;
      level.tiles[y * gw + x] = tileId;
    }
  }
  return level;
}

function setTile(level, x, y, tileId) {
  const gw = level.grid_width;
  if (x < 0 || x >= gw || y < 0 || y >= level.grid_height) return level;
  level.tiles[y * gw + x] = tileId;
  return level;
}

module.exports = {
  listLevels,
  readLevel,
  writeLevel,
  deleteLevel,
  newBlankLevel,
  paintRect,
  setTile,
  _internals: { validateLevel, safeLevelId }
};
