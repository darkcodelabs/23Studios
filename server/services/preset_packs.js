'use strict';

// Preset packs — curated style picks across all 14 axes that work together.
//
// Layout: one JSON file per pack at server/data/global_library/preset_packs/<pack>.json
// Schema:
//   {
//     "id": "noir_thriller",
//     "display_name": "Noir Thriller",
//     "description": "Hard-boiled detective vibes...",
//     "axis_picks": {
//       "pacing_style": { "name": "Slow burn", "spec": {...} },
//       "gameplay_style": { "name": "Top-down photographer", "spec": {...} },
//       ...
//     }
//   }
//
// Packs are SEEDS, not final picks — the LLM can generate alternates that
// replace them. The 8 shipped packs (per Cory): classic_adventure,
// noir_thriller, 1bit_horror, cozy_sim, rhythm_game, metroidvania,
// twine_visual_novel, arcade_action. HAKCD becomes the 9th in Phase 4.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', 'data', 'global_library', 'preset_packs');

// Pack ids allow leading digit (e.g. "1bit_horror"). snake_case only.
const PACK_ID_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

const packCache = new Map();

function safePackId(id) { return typeof id === 'string' && PACK_ID_RE.test(id); }

async function listPacks() {
  let files;
  try { files = await fsp.readdir(PACKS_DIR); }
  catch (_e) { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!safePackId(id)) continue;
    try {
      const pack = await loadPack(id);
      out.push({
        id: pack.id,
        display_name: pack.display_name,
        description: pack.description,
        axis_count: Object.keys(pack.axis_picks || {}).length
      });
    } catch (_e) { /* skip malformed */ }
  }
  return out;
}

async function loadPack(packId) {
  if (!safePackId(packId)) throw new Error(`invalid pack id: ${packId}`);
  if (packCache.has(packId)) return packCache.get(packId);
  const file = path.join(PACKS_DIR, `${packId}.json`);
  const raw = await fsp.readFile(file, 'utf8');
  const pack = JSON.parse(raw);
  if (pack.id !== packId) {
    throw new Error(`pack id mismatch: file=${packId} pack.id=${pack.id}`);
  }
  packCache.set(packId, pack);
  return pack;
}

function clearCache() { packCache.clear(); }

module.exports = {
  listPacks,
  loadPack,
  clearCache,
  PACKS_DIR,
  _internals: { safePackId }
};
