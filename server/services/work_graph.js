'use strict';

// Phase 6 A7 — Work Graph generation.
//
// Reads the latest scope lock snapshot (A6) + derived.json (A3) + extracted.json
// (A2) and emits <project>/sdk_data/work_graph.json — the DAG every downstream
// agent reads from + writes status back to.
//
// Node schema (spec §A7):
//   id, requirement_id, kind, title, agent_assignment, prompt_source,
//   anchor_inputs, skill_rules, depends_on, blocks, est_cost_usd,
//   reroll_budget, gate_blocks, status, started_at, finished_at,
//   attempt_log, output_paths, notes
//
// Public API:
//   generateGraph(projectId, opts?)       -> writes + returns the graph
//   getGraph(projectId)                   -> last-written graph or null
//   updateNode(projectId, nodeId, patch)  -> mutates status / finished_at / etc.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

let scopeLock;
try { scopeLock = require('./scope_lock'); }
catch (_e) { scopeLock = null; }

function graphPath(localPath) { return path.join(localPath, 'sdk_data', 'work_graph.json'); }
function reqDir(localPath) { return path.join(localPath, 'sdk_data', 'requirements'); }
function derivedPath(localPath) { return path.join(reqDir(localPath), 'derived.json'); }
function extractedPath(localPath) { return path.join(reqDir(localPath), 'extracted.json'); }
function latestScopePath(localPath) { return path.join(localPath, 'sdk_data', 'scope', 'latest.json'); }
function scopeSnapshotPath(localPath, version) {
  return path.join(localPath, 'sdk_data', 'scope', `v0.${version}.json`);
}

// Defaults tuned for HAKCD-style projects: per-kind agent + cost + skill rules.
const KIND_DEFAULTS = {
  scene_bg: {
    agent_assignment: 'openrouter:openai/gpt-5-image-mini',
    skill_rules: ['1bit', '400x240'],
    est_cost_usd: 0.08,
    reroll_budget: 2,
    gate_blocks: ['GATE-2-visual-ship']
  },
  scene_lua: {
    agent_assignment: 'claude:claude-opus-4-7',
    skill_rules: ['playdate-sdk-3.0.6', 'no-unused-vars'],
    est_cost_usd: 0.04,
    reroll_budget: 2,
    gate_blocks: ['GATE-3-runtime-ship']
  },
  asset_portrait: {
    agent_assignment: 'openrouter:openai/gpt-5-image-mini',
    skill_rules: ['1bit', '80x80', 'dither-floyd'],
    est_cost_usd: 0.05,
    reroll_budget: 3,
    gate_blocks: ['GATE-2-visual-ship']
  },
  asset_sfx: {
    agent_assignment: 'internal:sfx_synth',
    skill_rules: ['8bit-mono', '22khz'],
    est_cost_usd: 0.0,
    reroll_budget: 1,
    gate_blocks: ['GATE-2-visual-ship']
  },
  npc_dialog: {
    agent_assignment: 'claude:claude-sonnet-4-6',
    skill_rules: ['voice-from-canon'],
    est_cost_usd: 0.02,
    reroll_budget: 2,
    gate_blocks: ['GATE-1-canon-ship']
  },
  minigame_recipe: {
    agent_assignment: 'claude:claude-opus-4-7',
    skill_rules: ['playdate-sdk-3.0.6'],
    est_cost_usd: 0.06,
    reroll_budget: 2,
    gate_blocks: ['GATE-3-runtime-ship']
  }
};
const FALLBACK_DEFAULTS = {
  agent_assignment: 'claude:claude-opus-4-7',
  skill_rules: [],
  est_cost_usd: 0.05,
  reroll_budget: 1,
  gate_blocks: []
};

const NODE_STATUSES = new Set(['pending', 'in_progress', 'done', 'failed', 'blocked', 'skipped']);

async function readJsonOr(file, fb) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (_e) { return fb; }
}
async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}
async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) {
    const e = new Error(`project not found: ${projectId}`); e.status = 404; e.code = 'not_found'; throw e;
  }
  if (!proj.local_path) {
    const e = new Error(`project ${projectId} has no local_path`); e.status = 400; e.code = 'no_local_path'; throw e;
  }
  return proj;
}

// Try the injected scope_lock service first; fall back to reading from disk so
// the graph can be generated even if scope_lock.js is somehow unavailable
// (keeps A7 testable in isolation).
async function loadLatestScope(localPath) {
  if (scopeLock && typeof scopeLock.getScope === 'function') {
    // We don't have a projectId here — read latest pointer directly so the
    // helper stays pure on localPath.
  }
  const ptr = await readJsonOr(latestScopePath(localPath), null);
  if (!ptr || !ptr.version) return null;
  return await readJsonOr(scopeSnapshotPath(localPath, ptr.version), null);
}

// Parse "req-<SCENE_ID>-<kind>" -> { scene_id, kind }. Kind may include
// underscores; the SCENE_ID is the second token. If parsing fails, returns
// { scene_id: null, kind: 'unknown' }.
function parseRequirementId(rid) {
  const m = String(rid).match(/^req-([^-]+)-(.+)$/);
  if (!m) return { scene_id: null, kind: 'unknown' };
  return { scene_id: m[1], kind: m[2] };
}

function titleFor(rid, sceneTitleIdx) {
  const { scene_id, kind } = parseRequirementId(rid);
  const sceneTitle = scene_id && sceneTitleIdx[scene_id] ? sceneTitleIdx[scene_id] : null;
  if (sceneTitle) return `${scene_id} ${sceneTitle} — ${kind.replace(/_/g, ' ')}`;
  if (scene_id) return `${scene_id} — ${kind.replace(/_/g, ' ')}`;
  return kind.replace(/_/g, ' ');
}

function anchorInputsFor(rid, refCatalogByScene) {
  const { scene_id } = parseRequirementId(rid);
  if (!scene_id) return [];
  return refCatalogByScene[scene_id] || [];
}

function promptSourceFor(rid) {
  const { scene_id, kind } = parseRequirementId(rid);
  if (kind === 'scene_bg') return scene_id ? `canon:${scene_id}` : 'canon:GLOBAL_STYLE';
  if (kind === 'scene_lua') return scene_id ? `bible:${scene_id}` : 'bible:GLOBAL';
  if (kind === 'npc_dialog') return 'canon:characters';
  return 'derived';
}

// Build a derived-requirement -> derived-req-record index. If derived.json
// (A3) is absent we synthesize minimal records from the scope ids.
function buildReqIdx(derived, includedIds, deferredIds) {
  const all = new Set([...includedIds, ...deferredIds]);
  const idx = {};
  if (derived && Array.isArray(derived.requirements)) {
    for (const r of derived.requirements) {
      if (all.has(r.id)) idx[r.id] = r;
    }
  }
  for (const rid of all) {
    if (!idx[rid]) {
      const { kind } = parseRequirementId(rid);
      idx[rid] = { id: rid, kind };
    }
  }
  return idx;
}

// Hard-coded conservative dependency rules. The orchestrator can refine these
// later; the spec only requires "correct dependencies" for the HAKCD case,
// where canon-shipping precedes visual-shipping precedes runtime-shipping.
function depsFor(rid, includedSet) {
  const { scene_id, kind } = parseRequirementId(rid);
  const deps = [];
  if (kind === 'scene_lua' && scene_id) {
    const bgId = `req-${scene_id}-scene_bg`;
    if (includedSet.has(bgId)) deps.push(`task-${scene_id}-scene_bg`);
  }
  if (kind === 'minigame_recipe' && scene_id) {
    const bgId = `req-${scene_id}-scene_bg`;
    if (includedSet.has(bgId)) deps.push(`task-${scene_id}-scene_bg`);
  }
  return deps;
}

function nodeIdFor(rid) {
  const { scene_id, kind } = parseRequirementId(rid);
  return scene_id ? `task-${scene_id}-${kind}` : `task-${rid.replace(/^req-/, '')}`;
}

// ----------------------------------------------------------------------------
// Public — generateGraph
// ----------------------------------------------------------------------------

async function generateGraph(projectId, opts = {}) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  const scope = await loadLatestScope(localPath);
  if (!scope) {
    const e = new Error('no scope snapshot — lock scope (A6) first');
    e.status = 412; e.code = 'no_scope'; throw e;
  }
  const includedIds = scope.in_scope || [];
  const deferredIds = (scope.deferred || []).map((d) => d.requirement_id);

  const derived = await readJsonOr(derivedPath(localPath), null);
  const extracted = await readJsonOr(extractedPath(localPath), { scenes: [] });
  const refCatalog = await readJsonOr(path.join(reqDir(localPath), 'reference_catalog.json'), { images: [] });

  // scene_id -> title lookup
  const sceneTitleIdx = {};
  for (const sc of (extracted.scenes || [])) {
    if (sc && sc.id) sceneTitleIdx[sc.id] = sc.title || '';
  }
  // scene_id -> anchor file paths lookup
  const refCatalogByScene = {};
  for (const img of (refCatalog.images || [])) {
    const sid = img.anchor_scene || img.scene_id;
    if (sid && img.path) {
      (refCatalogByScene[sid] = refCatalogByScene[sid] || []).push(img.path);
    }
  }

  const reqIdx = buildReqIdx(derived, includedIds, deferredIds);
  const includedSet = new Set(includedIds);

  // Preserve status/attempt_log/output_paths from any prior graph so a
  // regenerate doesn't blow away in-flight progress.
  const prior = await readJsonOr(graphPath(localPath), null);
  const priorByNodeId = {};
  if (prior && Array.isArray(prior.nodes)) {
    for (const n of prior.nodes) priorByNodeId[n.id] = n;
  }

  const nodes = [];
  for (const rid of includedIds) {
    const rec = reqIdx[rid];
    const kind = rec.kind || 'unknown';
    const defaults = KIND_DEFAULTS[kind] || FALLBACK_DEFAULTS;
    const id = nodeIdFor(rid);
    const dep = depsFor(rid, includedSet);
    const node = {
      id,
      requirement_id: rid,
      kind,
      title: titleFor(rid, sceneTitleIdx),
      agent_assignment: rec.agent_assignment || defaults.agent_assignment,
      prompt_source: rec.prompt_source || promptSourceFor(rid),
      anchor_inputs: rec.anchor_inputs || anchorInputsFor(rid, refCatalogByScene),
      skill_rules: rec.skill_rules || defaults.skill_rules,
      depends_on: dep,
      blocks: [],
      est_cost_usd: (typeof rec.est_cost_usd === 'number' && isFinite(rec.est_cost_usd))
        ? rec.est_cost_usd : defaults.est_cost_usd,
      reroll_budget: rec.reroll_budget != null ? rec.reroll_budget : defaults.reroll_budget,
      gate_blocks: rec.gate_blocks || defaults.gate_blocks,
      status: 'pending',
      started_at: null,
      finished_at: null,
      attempt_log: [],
      output_paths: [],
      notes: ''
    };
    if (priorByNodeId[id]) {
      const p = priorByNodeId[id];
      node.status = p.status || 'pending';
      node.started_at = p.started_at || null;
      node.finished_at = p.finished_at || null;
      node.attempt_log = Array.isArray(p.attempt_log) ? p.attempt_log : [];
      node.output_paths = Array.isArray(p.output_paths) ? p.output_paths : [];
      node.notes = typeof p.notes === 'string' ? p.notes : '';
    }
    nodes.push(node);
  }
  // Back-fill 'blocks' from depends_on so the graph is bidirectionally
  // walkable without extra computation.
  const byId = {};
  for (const n of nodes) byId[n.id] = n;
  for (const n of nodes) {
    for (const depId of n.depends_on) {
      if (byId[depId]) byId[depId].blocks.push(n.id);
    }
  }

  const graph = {
    version: 1,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    scope_file_version: scope.file_version,
    scope_version: scope.version,
    totals: {
      node_count: nodes.length,
      pending_count: nodes.filter((n) => n.status === 'pending').length,
      in_progress_count: nodes.filter((n) => n.status === 'in_progress').length,
      done_count: nodes.filter((n) => n.status === 'done').length,
      failed_count: nodes.filter((n) => n.status === 'failed').length,
      est_cost_total_usd: round(nodes.reduce((s, n) => s + (n.est_cost_usd || 0), 0))
    },
    deferred: deferredIds,
    nodes
  };

  await writeJson(graphPath(localPath), graph);
  if (typeof opts.onEvent === 'function') opts.onEvent('done', { nodes: nodes.length });
  return graph;
}

async function getGraph(projectId) {
  const proj = await resolveProject(projectId);
  return await readJsonOr(graphPath(proj.local_path), null);
}

// Mutate a single node's status/output_paths/notes. Used by agents reporting
// back as work completes. Recomputes the rollup counters in graph.totals.
async function updateNode(projectId, nodeId, patch = {}) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const graph = await readJsonOr(graphPath(localPath), null);
  if (!graph) {
    const e = new Error('no work graph — generate it first'); e.status = 412; e.code = 'no_graph'; throw e;
  }
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n) {
    const e = new Error(`node not found: ${nodeId}`); e.status = 404; e.code = 'not_found'; throw e;
  }
  if (patch.status != null) {
    if (!NODE_STATUSES.has(patch.status)) {
      const e = new Error(`bad status: ${patch.status}`); e.status = 400; e.code = 'bad_status'; throw e;
    }
    n.status = patch.status;
    if (patch.status === 'in_progress' && !n.started_at) n.started_at = new Date().toISOString();
    if (patch.status === 'done' || patch.status === 'failed') n.finished_at = new Date().toISOString();
  }
  if (Array.isArray(patch.output_paths)) n.output_paths = patch.output_paths;
  if (typeof patch.notes === 'string') n.notes = patch.notes.slice(0, 4000);
  if (patch.attempt) {
    n.attempt_log = Array.isArray(n.attempt_log) ? n.attempt_log : [];
    n.attempt_log.push({
      ts: new Date().toISOString(),
      ok: !!patch.attempt.ok,
      cost_usd: typeof patch.attempt.cost_usd === 'number' ? patch.attempt.cost_usd : null,
      note: typeof patch.attempt.note === 'string' ? patch.attempt.note.slice(0, 1000) : ''
    });
  }
  // Recount rollups.
  graph.totals.pending_count = graph.nodes.filter((x) => x.status === 'pending').length;
  graph.totals.in_progress_count = graph.nodes.filter((x) => x.status === 'in_progress').length;
  graph.totals.done_count = graph.nodes.filter((x) => x.status === 'done').length;
  graph.totals.failed_count = graph.nodes.filter((x) => x.status === 'failed').length;
  graph.updated_at = new Date().toISOString();

  await writeJson(graphPath(localPath), graph);
  return n;
}

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

module.exports = {
  generateGraph,
  getGraph,
  updateNode,
  KIND_DEFAULTS, FALLBACK_DEFAULTS, NODE_STATUSES: Array.from(NODE_STATUSES),
  _internals: { parseRequirementId, depsFor, nodeIdFor }
};
