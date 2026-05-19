'use strict';

// Phase 6 A3 — Requirements Derivation.
//
// Reads A2 outputs (<project>/sdk_data/requirements/extracted.json +
// reference_catalog.json) plus the project's source material (bible, canon,
// SKILL.md, minigame recipe seed) and emits a structured requirements doc
// at <project>/sdk_data/requirements/derived.json.
//
// If A2 outputs are missing (parallel-dev mode), the deriver falls back to
// re-reading the source material directly so it can still produce a usable
// requirements skeleton against the bible. The orchestrator agent running A1/A2
// in parallel populates extracted.json once ready; re-running derive then
// upgrades the doc with the richer extraction.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projects = require('./projects');

// ----------------------------------------------------------------------------
// Path helpers
// ----------------------------------------------------------------------------

function reqDir(localPath) {
  return path.join(localPath, 'sdk_data', 'requirements');
}
function extractedPath(localPath) { return path.join(reqDir(localPath), 'extracted.json'); }
function refCatalogPath(localPath) { return path.join(reqDir(localPath), 'reference_catalog.json'); }
function derivedPath(localPath) { return path.join(reqDir(localPath), 'derived.json'); }
function sourceDir(localPath) { return path.join(localPath, 'sdk_data', 'source'); }
function biblePath(localPath) { return path.join(localPath, 'sdk_data', 'story_bible.md'); }
function intakeYaml(localPath) { return path.join(localPath, 'sdk_data', 'intake.yaml'); }

async function readJsonOr(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (_e) { return fallback; }
}

async function readTextOr(file, fallback) {
  try { return await fsp.readFile(file, 'utf8'); }
  catch (_e) { return fallback; }
}

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

// ----------------------------------------------------------------------------
// Cost defaults — per-kind generation cost, USD, conservative estimate based
// on HAKCD Phase 4 actuals (image-mini ~$0.08, lua via Claude subprocess ~$0,
// sfx_synth procedural ~$0). Tweak in a single place.
// ----------------------------------------------------------------------------

const KIND_COSTS = {
  scene_bg: 0.08,
  character_portrait: 0.06,
  sprite: 0.04,
  ui_surface: 0.05,
  inventory_item: 0.03,
  imagetable: 0.20,            // bigger compose pass
  launcher_asset: 0.10,
  scene_lua: 0.00,             // Claude subscription
  dialog_block: 0.00,
  sfx_cue: 0.00,               // procedural
  music_bed: 0.00              // tracker
};

const KIND_REROLL_DEFAULT = 2;

const KIND_AGENT = {
  scene_bg: 'openrouter:openai/gpt-5-image-mini',
  character_portrait: 'openrouter:openai/gpt-5-image-mini',
  sprite: 'openrouter:openai/gpt-5-image-mini',
  ui_surface: 'openrouter:openai/gpt-5-image-mini',
  inventory_item: 'openrouter:openai/gpt-5-image-mini',
  imagetable: 'pipeline:imagetable_builder',
  launcher_asset: 'pipeline:launcher',
  scene_lua: 'claude:scene_lua_stage',
  dialog_block: 'claude:dialog_stage',
  sfx_cue: 'pipeline:sfx_synth',
  music_bed: 'pipeline:music_library'
};

// SKILL.md rules that apply per requirement kind. Numbers reference docs
// SKILL.md surface (kept as opaque strings so they don't drift if the file
// itself moves).
const KIND_SKILL_RULES = {
  scene_bg: ['1bit', '400x240', 'dither_stability'],
  character_portrait: ['1bit', 'portrait_size', 'sprite_minimum'],
  sprite: ['1bit', 'sprite_minimum', 'no_runtime_scale'],
  ui_surface: ['1bit', '400x240', 'text_minimum_14px'],
  inventory_item: ['1bit', 'sprite_minimum'],
  imagetable: ['1bit', 'imagetable_naming', 'animation_dither_stability'],
  launcher_asset: ['1bit', 'launcher_name_baked_in'],
  scene_lua: ['bootstrap_pattern', 'refresh_rate_30', 'sprite_system', 'A_confirm_B_cancel'],
  dialog_block: ['text_minimum_14px'],
  sfx_cue: ['audio_44_1khz'],
  music_bed: ['audio_44_1khz']
};

// ----------------------------------------------------------------------------
// Extraction shim — reads A2 extracted.json if present, else best-effort
// parses the bible to find scene IDs + character names so the derivation can
// still produce a usable requirements doc in parallel-dev mode.
// ----------------------------------------------------------------------------

const SCENE_ID_RE = /\bSC[\- ]?(\d{2,3})\b/g;
const HEADING_SCENE_RE = /^\s*#{1,3}\s+(SC[\- ]?\d{2,3})\b[^\n]*/gmi;
const CHAR_NAME_HINT_RE = /^\s*[-*]\s+\*\*([A-Z][A-Za-z0-9_'\- ]{1,30})\*\*/gm;

function uniq(arr) {
  return Array.from(new Set(arr));
}

function normSceneId(raw) {
  if (!raw) return null;
  const m = String(raw).match(/SC[\- ]?(\d{2,3})/i);
  if (!m) return null;
  return 'SC' + m[1].padStart(2, '0');
}

async function loadExtracted(localPath) {
  const a2 = await readJsonOr(extractedPath(localPath), null);
  if (a2 && (Array.isArray(a2.scenes) || Array.isArray(a2.characters))) return a2;

  // Fallback: best-effort parse of the bible markdown so A3 can still produce
  // a working requirements doc when A2 has not run yet.
  const bibleText = await readTextOr(biblePath(localPath), '');
  if (!bibleText) {
    return { scenes: [], characters: [], locations: [], minigames: [], ui_surfaces: [], sfx: [], music: [], dialog_blocks: [], inventory_items: [] };
  }

  const sceneIds = new Set();
  let m;
  while ((m = SCENE_ID_RE.exec(bibleText))) {
    const id = normSceneId(m[0]);
    if (id) sceneIds.add(id);
  }
  while ((m = HEADING_SCENE_RE.exec(bibleText))) {
    const id = normSceneId(m[1]);
    if (id) sceneIds.add(id);
  }

  const scenes = Array.from(sceneIds).sort().map((id) => ({
    id, title: id, summary: '', characters: [], gameplay_type: 'unknown',
    anchor_refs: [], canon_section: null
  }));

  const chars = new Set();
  while ((m = CHAR_NAME_HINT_RE.exec(bibleText))) {
    const name = m[1].trim();
    if (name.length > 1) chars.add(name);
  }
  const characters = Array.from(chars).slice(0, 40).map((name) => ({
    name, traits: [], dialog_samples: [], portrait_ref: null
  }));

  return {
    scenes, characters, locations: [], minigames: [], ui_surfaces: [],
    sfx: [], music: [], dialog_blocks: [], inventory_items: [],
    _source: 'bible_fallback_parse'
  };
}

async function loadReferenceCatalog(localPath) {
  return await readJsonOr(refCatalogPath(localPath), { images: [] });
}

// ----------------------------------------------------------------------------
// Requirement builders
// ----------------------------------------------------------------------------

function shortHash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
}

function buildRequirement(kind, title, opts = {}) {
  const baseId = opts.id || `req-${kind}-${shortHash(`${kind}|${title}`)}`;
  return {
    id: baseId,
    kind,
    title,
    source_refs: opts.source_refs || [],
    anchor_refs: opts.anchor_refs || [],
    skill_rules: opts.skill_rules || KIND_SKILL_RULES[kind] || [],
    dependencies: opts.dependencies || [],
    est_cost_usd: opts.est_cost_usd != null ? opts.est_cost_usd : (KIND_COSTS[kind] || 0),
    reroll_budget: opts.reroll_budget != null ? opts.reroll_budget : KIND_REROLL_DEFAULT,
    agent_assignment: opts.agent_assignment || KIND_AGENT[kind] || null,
    gate_blocks: opts.gate_blocks || [],
    status: 'pending',
    notes: opts.notes || ''
  };
}

function findAnchorsForScene(refCatalog, sceneId) {
  const out = [];
  for (const img of (refCatalog.images || [])) {
    const anchored = img.anchored_to || {};
    const scenes = Array.isArray(anchored.scenes) ? anchored.scenes : [];
    if (scenes.includes(sceneId)) out.push(img.path || img.relpath || img.name);
  }
  return out.filter(Boolean);
}

function findAnchorsForCharacter(refCatalog, charName) {
  const out = [];
  const lower = charName.toLowerCase();
  for (const img of (refCatalog.images || [])) {
    const anchored = img.anchored_to || {};
    const chars = Array.isArray(anchored.characters) ? anchored.characters : [];
    if (chars.some((c) => String(c).toLowerCase() === lower)) {
      out.push(img.path || img.relpath || img.name);
    }
  }
  return out.filter(Boolean);
}

// ----------------------------------------------------------------------------
// Public — deriveRequirements
// ----------------------------------------------------------------------------

async function deriveRequirements(projectId, opts = {}) {
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  await fsp.mkdir(reqDir(localPath), { recursive: true });

  onEvent('phase', { phase: 'load_extracted' });
  const extracted = await loadExtracted(localPath);
  onEvent('phase', { phase: 'load_reference_catalog' });
  const refCatalog = await loadReferenceCatalog(localPath);

  onEvent('phase', { phase: 'derive' });
  const requirements = [];

  // Scenes — each contributes a scene_bg (image) + scene_lua + optional dialog_block.
  for (const sc of (extracted.scenes || [])) {
    const sceneId = sc.id || 'SC??';
    const anchors = sc.anchor_refs && sc.anchor_refs.length
      ? sc.anchor_refs
      : findAnchorsForScene(refCatalog, sceneId);

    const bgReq = buildRequirement('scene_bg', `${sceneId} background`, {
      id: `req-${sceneId}-scene_bg`,
      source_refs: [{ bible_id: sceneId, summary: sc.summary || '' }],
      anchor_refs: anchors,
      notes: sc.summary || ''
    });
    requirements.push(bgReq);

    const luaReq = buildRequirement('scene_lua', `${sceneId} scene module`, {
      id: `req-${sceneId}-scene_lua`,
      source_refs: [{ bible_id: sceneId }],
      dependencies: [bgReq.id]
    });
    requirements.push(luaReq);

    if (Array.isArray(sc.characters) && sc.characters.length > 0) {
      const dialogReq = buildRequirement('dialog_block', `${sceneId} dialog`, {
        id: `req-${sceneId}-dialog`,
        source_refs: [{ bible_id: sceneId, characters: sc.characters }],
        dependencies: [luaReq.id]
      });
      requirements.push(dialogReq);
    }
  }

  // Characters — each contributes a portrait.
  for (const ch of (extracted.characters || [])) {
    if (!ch || !ch.name) continue;
    const anchors = ch.portrait_ref
      ? [ch.portrait_ref]
      : findAnchorsForCharacter(refCatalog, ch.name);
    requirements.push(buildRequirement('character_portrait', `${ch.name} portrait`, {
      id: `req-char-${shortHash(ch.name)}-portrait`,
      source_refs: [{ character: ch.name }],
      anchor_refs: anchors,
      notes: ch.role || ''
    }));
  }

  // Locations beyond what scenes already cover — distinct backgrounds.
  for (const loc of (extracted.locations || [])) {
    if (!loc || !loc.name) continue;
    requirements.push(buildRequirement('scene_bg', `${loc.name} location background`, {
      id: `req-loc-${shortHash(loc.name)}-bg`,
      source_refs: [{ location: loc.name }],
      anchor_refs: loc.anchor_ref ? [loc.anchor_ref] : []
    }));
  }

  // UI surfaces.
  for (const ui of (extracted.ui_surfaces || [])) {
    if (!ui || !ui.name) continue;
    requirements.push(buildRequirement('ui_surface', `${ui.name} UI surface`, {
      id: `req-ui-${shortHash(ui.name)}`,
      source_refs: [{ ui: ui.name }]
    }));
  }

  // Inventory items.
  for (const item of (extracted.inventory_items || [])) {
    if (!item || !item.name) continue;
    requirements.push(buildRequirement('inventory_item', `${item.name} sprite`, {
      id: `req-item-${shortHash(item.name)}`,
      source_refs: [{ item: item.name }]
    }));
  }

  // SFX + music cues.
  for (const sfx of (extracted.sfx || [])) {
    if (!sfx || !sfx.name) continue;
    requirements.push(buildRequirement('sfx_cue', `${sfx.name} SFX`, {
      id: `req-sfx-${shortHash(sfx.name)}`,
      source_refs: [{ sfx: sfx.name, scene: sfx.scene || null }]
    }));
  }
  for (const mu of (extracted.music || [])) {
    if (!mu || !mu.name) continue;
    requirements.push(buildRequirement('music_bed', `${mu.name} music bed`, {
      id: `req-music-${shortHash(mu.name)}`,
      source_refs: [{ music: mu.name, scene: mu.scene || null }]
    }));
  }

  // Launcher card — always required for a Playdate ship.
  if (!requirements.some((r) => r.kind === 'launcher_asset')) {
    requirements.push(buildRequirement('launcher_asset', 'Launcher card + icon', {
      id: 'req-launcher',
      source_refs: [{ note: 'Required for every Playdate ship per SKILL #13' }]
    }));
  }

  // Cost totals (zero-reroll + 1.5-reroll average).
  let totalZero = 0;
  let totalReroll = 0;
  for (const r of requirements) {
    totalZero += r.est_cost_usd || 0;
    totalReroll += (r.est_cost_usd || 0) * (1 + 1.5);
  }

  const doc = {
    version: 1,
    project_id: projectId,
    project_name: proj.name || projectId,
    generated_at: new Date().toISOString(),
    extraction_source: extracted._source || 'a2_extracted',
    counts_by_kind: countsByKind(requirements),
    totals: {
      total_items: requirements.length,
      est_cost_usd_zero_reroll: round2(totalZero),
      est_cost_usd_avg_reroll_1_5: round2(totalReroll)
    },
    requirements
  };

  await fsp.writeFile(derivedPath(localPath), JSON.stringify(doc, null, 2));
  onEvent('done', { count: requirements.length });
  return doc;
}

function countsByKind(reqs) {
  const out = {};
  for (const r of reqs) out[r.kind] = (out[r.kind] || 0) + 1;
  return out;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

async function getDerived(projectId) {
  const proj = await resolveProject(projectId);
  return await readJsonOr(derivedPath(proj.local_path), null);
}

module.exports = {
  deriveRequirements,
  getDerived,
  // exposed for sibling A4 service so it doesn't have to re-load
  _paths: { derivedPath, extractedPath, refCatalogPath, reqDir },
  _internals: { buildRequirement, KIND_COSTS, KIND_AGENT, KIND_SKILL_RULES, normSceneId, shortHash }
};
