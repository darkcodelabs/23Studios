'use strict';

// Phase 6 A4 — Coverage Gap Analysis.
//
// Cross-references the derived requirements doc (A3) against canon, the
// reference catalog (A2), and the minigame recipe seed library.
// For each requirement, marks coverage:
//   - "covered"      explicit canon prompt + anchor reference present
//   - "derivable"    has canon OR adjacent-scene anchor, can fill the gap
//   - "needs_canon"  bible mentions it but no canon entry / no anchor
//   - "uncovered"    no canon, no anchor, would require new source
//
// Plus three rollup buckets (scenes / references / minigames) matching the
// human-readable coverage report in the spec.
//
// Output: <project>/sdk_data/requirements/coverage_report.json
// Read at any time via getCoverageReport(projectId).

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

function reqDir(localPath) { return path.join(localPath, 'sdk_data', 'requirements'); }
function derivedPath(localPath) { return path.join(reqDir(localPath), 'derived.json'); }
function refCatalogPath(localPath) { return path.join(reqDir(localPath), 'reference_catalog.json'); }
function extractedPath(localPath) { return path.join(reqDir(localPath), 'extracted.json'); }
function coveragePath(localPath) { return path.join(reqDir(localPath), 'coverage_report.json'); }
function canonPath(localPath) { return path.join(localPath, 'sdk_data', 'source', 'canon.md'); }
function biblePath(localPath) { return path.join(localPath, 'sdk_data', 'story_bible.md'); }

const RECIPE_SEED = path.join(__dirname, '..', 'data', 'minigame_recipes.seed.json');

async function readJsonOr(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (_e) { return fallback; }
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
// Canon parsing — extract section IDs (§1..§N) and the subjects each cites.
// We don't need full markdown parsing; just match heading lines.
// ----------------------------------------------------------------------------

const CANON_SECTION_RE = /^\s*(?:#{1,3})?\s*§\s*(\d+)[.\s\-:]+([^\n]+)$/gm;
const SCENE_MENTION_RE = /\bSC[\- ]?(\d{2,3})\b/g;

function parseCanon(canonText) {
  const sections = [];
  if (!canonText) return sections;
  let m;
  CANON_SECTION_RE.lastIndex = 0;
  while ((m = CANON_SECTION_RE.exec(canonText))) {
    sections.push({
      id: '§' + m[1],
      title: m[2].trim(),
      offset: m.index
    });
  }
  // Attach the slice of text following each heading as `body`, up to the next
  // section. Used for scene-mention detection.
  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].offset;
    const end = i + 1 < sections.length ? sections[i + 1].offset : canonText.length;
    sections[i].body = canonText.slice(start, end);
    sections[i].scene_mentions = [];
    let sm;
    SCENE_MENTION_RE.lastIndex = 0;
    while ((sm = SCENE_MENTION_RE.exec(sections[i].body))) {
      sections[i].scene_mentions.push('SC' + sm[1].padStart(2, '0'));
    }
  }
  return sections;
}

// Returns the §id that explicitly mentions a scene, else null.
function canonForScene(canonSections, sceneId) {
  for (const sec of canonSections) {
    if (sec.scene_mentions.includes(sceneId)) return sec.id;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Anchor index — quick scene → has-anchor + adjacent-scene fallback lookup.
// ----------------------------------------------------------------------------

function indexAnchorsByScene(refCatalog) {
  const map = new Map(); // sceneId -> [refPath]
  for (const img of (refCatalog.images || [])) {
    const anchored = img.anchored_to || {};
    const scenes = Array.isArray(anchored.scenes) ? anchored.scenes : [];
    for (const s of scenes) {
      const list = map.get(s) || [];
      list.push(img.path || img.relpath || img.name);
      map.set(s, list);
    }
  }
  return map;
}

function adjacentSceneAnchor(sceneIndex, sceneId) {
  // Try -1 and +1 (numeric neighbors) so SC04 can borrow SC03 / SC05.
  const m = sceneId.match(/^SC(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const tryIds = [
    'SC' + String(n - 1).padStart(m[1].length, '0'),
    'SC' + String(n + 1).padStart(m[1].length, '0')
  ];
  for (const id of tryIds) {
    const a = sceneIndex.get(id);
    if (a && a.length > 0) return { borrowed_from: id, refs: a };
  }
  return null;
}

// ----------------------------------------------------------------------------
// Recipe library — load once, exposes mechanic-name → recipe lookup.
// ----------------------------------------------------------------------------

let _recipeCache = null;
async function loadRecipes() {
  if (_recipeCache) return _recipeCache;
  try {
    const raw = await fsp.readFile(RECIPE_SEED, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.recipes || []);
    _recipeCache = list;
  } catch (_e) { _recipeCache = []; }
  return _recipeCache;
}

function findRecipe(recipes, mechanicName) {
  if (!mechanicName) return null;
  const lower = String(mechanicName).toLowerCase().replace(/[_\s\-]+/g, '');
  for (const r of recipes) {
    const candidates = [r.id, r.slug, r.name, r.recipe_id].filter(Boolean).map((s) => String(s).toLowerCase().replace(/[_\s\-]+/g, ''));
    if (candidates.some((c) => c === lower || lower.includes(c) || c.includes(lower))) return r;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Per-requirement coverage classification.
// ----------------------------------------------------------------------------

function classifyRequirement(req, ctx) {
  const { canonSections, sceneAnchors } = ctx;
  const hasAnchor = req.anchor_refs && req.anchor_refs.length > 0;

  // Pull scene_id off the requirement's source_refs or title.
  let sceneId = null;
  for (const sr of req.source_refs || []) {
    if (sr.bible_id) { sceneId = sr.bible_id; break; }
  }
  if (!sceneId) {
    const m = (req.title || '').match(/\bSC\d{2,3}\b/);
    if (m) sceneId = m[0];
  }

  let canonSection = null;
  let borrowed = null;
  if (sceneId) {
    canonSection = canonForScene(canonSections, sceneId);
    if (!hasAnchor) borrowed = adjacentSceneAnchor(sceneAnchors, sceneId);
  }

  let status, reason;
  if (hasAnchor && canonSection) {
    status = 'covered';
    reason = `explicit canon ${canonSection} + ${req.anchor_refs.length} anchor(s)`;
  } else if (canonSection && borrowed) {
    status = 'derivable';
    reason = `canon ${canonSection}; anchor borrowable from ${borrowed.borrowed_from}`;
  } else if (canonSection) {
    status = 'derivable';
    reason = `canon ${canonSection}; no anchor, derive from GLOBAL_STYLE master`;
  } else if (hasAnchor) {
    status = 'derivable';
    reason = `anchor ref present; no explicit canon, derive from canon §3 preamble`;
  } else if (borrowed) {
    status = 'needs_canon';
    reason = `no canon; adjacent-scene anchor available (${borrowed.borrowed_from})`;
  } else {
    status = 'uncovered';
    reason = 'no canon entry, no reference anchor';
  }

  return {
    requirement_id: req.id,
    title: req.title,
    kind: req.kind,
    scene_id: sceneId,
    has_anchor: hasAnchor,
    canon_section: canonSection,
    borrowed_anchor: borrowed,
    status,
    reason
  };
}

// ----------------------------------------------------------------------------
// Public — analyzeCoverage
// ----------------------------------------------------------------------------

async function analyzeCoverage(projectId, opts = {}) {
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  await fsp.mkdir(reqDir(localPath), { recursive: true });

  onEvent('phase', { phase: 'load_inputs' });
  const derived = await readJsonOr(derivedPath(localPath), null);
  if (!derived) {
    const err = new Error('derived.json not found — run requirements derive first');
    err.status = 412; err.code = 'no_derived';
    throw err;
  }
  const refCatalog = await readJsonOr(refCatalogPath(localPath), { images: [] });
  const extracted = await readJsonOr(extractedPath(localPath), { scenes: [], minigames: [] });
  const canonText = await readTextOr(canonPath(localPath), '');
  const canonSections = parseCanon(canonText);
  const sceneAnchors = indexAnchorsByScene(refCatalog);
  const recipes = await loadRecipes();

  onEvent('phase', { phase: 'classify' });
  const perRequirement = derived.requirements.map((r) =>
    classifyRequirement(r, { canonSections, sceneAnchors })
  );

  // Rollups
  const sceneIds = (extracted.scenes || []).map((s) => s.id).filter(Boolean);
  const sceneRollup = {
    total: sceneIds.length,
    covered: [], derivable: [], needs_canon: [], uncovered: []
  };
  for (const sid of sceneIds) {
    const sceneReqs = perRequirement.filter((p) => p.scene_id === sid);
    // Worst-case status across all requirements for this scene drives the rollup.
    const statuses = sceneReqs.map((p) => p.status);
    let bucket;
    if (statuses.length === 0) bucket = 'uncovered';
    else if (statuses.includes('uncovered')) bucket = 'uncovered';
    else if (statuses.includes('needs_canon')) bucket = 'needs_canon';
    else if (statuses.includes('derivable')) bucket = 'derivable';
    else bucket = 'covered';
    sceneRollup[bucket].push(sid);
  }

  const refRollup = {
    total: (refCatalog.images || []).length,
    anchored: 0, ambiguous: [], unanchored: []
  };
  for (const img of (refCatalog.images || [])) {
    const a = img.anchored_to || {};
    const anchored =
      (Array.isArray(a.scenes) && a.scenes.length) ||
      (Array.isArray(a.characters) && a.characters.length) ||
      (Array.isArray(a.ui) && a.ui.length);
    if (anchored) {
      refRollup.anchored += 1;
    } else {
      refRollup.unanchored.push(img.path || img.relpath || img.name);
    }
    if (img.ambiguous_reason) refRollup.ambiguous.push({
      path: img.path || img.relpath || img.name,
      reason: img.ambiguous_reason
    });
  }
  // Bible-named items with no reference image
  const bibleText = await readTextOr(biblePath(localPath), '');
  const namedButUnreferenced = [];
  for (const ch of (extracted.characters || [])) {
    if (!ch || !ch.name) continue;
    const hasRef = (refCatalog.images || []).some((img) => {
      const a = img.anchored_to || {};
      return Array.isArray(a.characters) && a.characters.includes(ch.name);
    });
    if (!hasRef) namedButUnreferenced.push({ kind: 'character', name: ch.name });
  }
  refRollup.named_but_unreferenced = namedButUnreferenced;
  refRollup._bible_chars_unreferenced = namedButUnreferenced.length;

  const minigameRollup = {
    total: (extracted.minigames || []).length,
    covered: [], needs_custom_recipe: [], deferred_by_default: []
  };
  for (const mg of (extracted.minigames || [])) {
    if (!mg || !mg.name) continue;
    const recipe = findRecipe(recipes, mg.recipe_hint || mg.mechanic || mg.name);
    if (recipe) {
      minigameRollup.covered.push({ name: mg.name, recipe: recipe.id || recipe.name });
    } else if (mg.has_spec) {
      minigameRollup.needs_custom_recipe.push(mg.name);
    } else {
      minigameRollup.deferred_by_default.push(mg.name);
    }
  }

  // Bucket counts
  const totals = {
    requirements: perRequirement.length,
    covered: perRequirement.filter((p) => p.status === 'covered').length,
    derivable: perRequirement.filter((p) => p.status === 'derivable').length,
    needs_canon: perRequirement.filter((p) => p.status === 'needs_canon').length,
    uncovered: perRequirement.filter((p) => p.status === 'uncovered').length
  };

  const report = {
    version: 1,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    canon_sections_found: canonSections.length,
    totals,
    scenes: sceneRollup,
    references: refRollup,
    minigames: minigameRollup,
    per_requirement: perRequirement
  };

  await fsp.writeFile(coveragePath(localPath), JSON.stringify(report, null, 2));
  onEvent('done', { totals });
  return report;
}

async function getCoverageReport(projectId) {
  const proj = await resolveProject(projectId);
  return await readJsonOr(coveragePath(proj.local_path), null);
}

module.exports = {
  analyzeCoverage,
  getCoverageReport,
  _paths: { coveragePath, derivedPath, refCatalogPath },
  _internals: { parseCanon, indexAnchorsByScene, adjacentSceneAnchor, classifyRequirement, findRecipe }
};
