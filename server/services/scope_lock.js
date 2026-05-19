'use strict';

// Phase 6 A6 — Scope Proposal + Lock.
//
// Reads the scope_lock_candidate.json that A5 emitted on interview lock and
// lets the caller commit a final {in_scope, deferred} split. Each lock writes
// an immutable, versioned snapshot to <project>/sdk_data/scope/v0.<N>.json;
// the latest pointer lives at <project>/sdk_data/scope/latest.json. Once a
// version is written it is never mutated — subsequent locks bump N.
//
// Public API:
//   getCandidate(projectId)          -> A5 scope_lock_candidate.json (or null)
//   proposeScope(projectId)          -> ProposedScope (candidate + costs + budget)
//   listScopes(projectId)            -> [{ version, locked_at, in_scope_count, ... }]
//   getScope(projectId, version)     -> immutable lock snapshot, or latest if no version
//   lockScope(projectId, { include_ids, defer_ids, budget_usd, notes })
//                                    -> the newly-written snapshot
//
// Schema for a locked snapshot:
//   {
//     version: 1,                       (numeric — increments per lock)
//     file_version: "v0.1.json",        (canonical filename)
//     project_id, locked_at,
//     in_scope: [requirement_id, ...],
//     deferred: [{ requirement_id, reason, est_cost_usd }],
//     totals: { in_scope_count, deferred_count, est_cost_in_scope_usd, ... },
//     budget_usd, notes,
//     based_on_candidate_generated_at
//   }

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

let decisionLog;
try { decisionLog = require('./decision_log'); }
catch (_e) { decisionLog = null; }

function scopeDir(localPath) { return path.join(localPath, 'sdk_data', 'scope'); }
function latestPointerPath(localPath) { return path.join(scopeDir(localPath), 'latest.json'); }
function lockSnapshotPath(localPath, version) {
  // version is a positive integer; on disk it lives as v0.N.json (N=version).
  return path.join(scopeDir(localPath), `v0.${version}.json`);
}
function reqDir(localPath) { return path.join(localPath, 'sdk_data', 'requirements'); }
function candidatePath(localPath) { return path.join(reqDir(localPath), 'scope_lock_candidate.json'); }
function derivedPath(localPath) { return path.join(reqDir(localPath), 'derived.json'); }

// Default per-requirement cost when derive_requirements (A3) hasn't run yet
// or doesn't carry an est_cost_usd field. Picked to match HAKCD's typical
// scene_bg + scene_lua + asset_ref triple-cost average.
const DEFAULT_REQ_COST_USD = 0.08;

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
    const err = new Error(`project not found: ${projectId}`); err.status = 404; err.code = 'not_found'; throw err;
  }
  if (!proj.local_path) {
    const err = new Error(`project ${projectId} has no local_path`); err.status = 400; err.code = 'no_local_path'; throw err;
  }
  return proj;
}

// Build a requirement-id -> est_cost_usd index. If derived.json (A3) carries
// per-requirement est_cost_usd, use it; else fall back to DEFAULT_REQ_COST_USD.
function costIndex(derived) {
  const idx = {};
  if (derived && Array.isArray(derived.requirements)) {
    for (const r of derived.requirements) {
      const cost = (typeof r.est_cost_usd === 'number' && isFinite(r.est_cost_usd))
        ? r.est_cost_usd : DEFAULT_REQ_COST_USD;
      idx[r.id] = cost;
    }
  }
  return idx;
}

function costFor(reqId, idx) {
  return Object.prototype.hasOwnProperty.call(idx, reqId)
    ? idx[reqId] : DEFAULT_REQ_COST_USD;
}

// ----------------------------------------------------------------------------
// Read-side
// ----------------------------------------------------------------------------

async function getCandidate(projectId) {
  const proj = await resolveProject(projectId);
  return await readJsonOr(candidatePath(proj.local_path), null);
}

async function proposeScope(projectId) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const candidate = await readJsonOr(candidatePath(localPath), null);
  if (!candidate) {
    const e = new Error('no scope candidate — lock the A5 interview first');
    e.status = 412; e.code = 'no_candidate'; throw e;
  }
  const derived = await readJsonOr(derivedPath(localPath), null);
  const idx = costIndex(derived);

  const inScope = (candidate.proposed_in_scope || []).map((rid) => ({
    requirement_id: rid,
    est_cost_usd: costFor(rid, idx)
  }));
  const deferred = (candidate.proposed_deferred || []).map((rid) => ({
    requirement_id: rid,
    est_cost_usd: costFor(rid, idx),
    reason: 'A5 interview marked scene/req for defer'
  }));

  const totals = {
    in_scope_count: inScope.length,
    deferred_count: deferred.length,
    est_cost_in_scope_usd: round(inScope.reduce((s, r) => s + r.est_cost_usd, 0)),
    est_cost_deferred_usd: round(deferred.reduce((s, r) => s + r.est_cost_usd, 0))
  };

  return {
    candidate_generated_at: candidate.generated_at,
    in_scope: inScope,
    deferred,
    totals,
    notes: candidate.notes || ''
  };
}

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

async function listScopes(projectId) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const dir = scopeDir(localPath);
  let entries;
  try { entries = await fsp.readdir(dir); }
  catch (_e) { return []; }
  const out = [];
  for (const name of entries) {
    if (!/^v0\.\d+\.json$/.test(name)) continue;
    try {
      const snap = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
      out.push({
        version: snap.version,
        file_version: snap.file_version || name,
        locked_at: snap.locked_at,
        in_scope_count: snap.totals?.in_scope_count ?? snap.in_scope?.length ?? 0,
        deferred_count: snap.totals?.deferred_count ?? snap.deferred?.length ?? 0,
        est_cost_in_scope_usd: snap.totals?.est_cost_in_scope_usd ?? null,
        notes: snap.notes || ''
      });
    } catch (_e) { /* ignore unreadable file */ }
  }
  out.sort((a, b) => a.version - b.version);
  return out;
}

async function getScope(projectId, version) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  if (version == null) {
    // Read pointer; if missing, return null.
    const ptr = await readJsonOr(latestPointerPath(localPath), null);
    if (!ptr || !ptr.version) return null;
    return await readJsonOr(lockSnapshotPath(localPath, ptr.version), null);
  }
  const v = parseInt(version, 10);
  if (!Number.isFinite(v) || v < 1) {
    const e = new Error('bad version'); e.status = 400; e.code = 'bad_version'; throw e;
  }
  return await readJsonOr(lockSnapshotPath(localPath, v), null);
}

// ----------------------------------------------------------------------------
// Write — lockScope
// ----------------------------------------------------------------------------

async function nextVersion(localPath) {
  const list = await listScopes_local(localPath);
  if (list.length === 0) return 1;
  return list[list.length - 1].version + 1;
}

async function listScopes_local(localPath) {
  let entries;
  try { entries = await fsp.readdir(scopeDir(localPath)); }
  catch (_e) { return []; }
  const out = [];
  for (const name of entries) {
    const m = name.match(/^v0\.(\d+)\.json$/);
    if (m) out.push({ version: parseInt(m[1], 10) });
  }
  out.sort((a, b) => a.version - b.version);
  return out;
}

async function lockScope(projectId, body = {}) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const candidate = await readJsonOr(candidatePath(localPath), null);
  if (!candidate) {
    const e = new Error('no scope candidate — lock the A5 interview first');
    e.status = 412; e.code = 'no_candidate'; throw e;
  }
  const includeIds = Array.isArray(body.include_ids) ? body.include_ids : null;
  const deferIds = Array.isArray(body.defer_ids) ? body.defer_ids : null;
  if (!includeIds || !deferIds) {
    const e = new Error('include_ids + defer_ids arrays required');
    e.status = 400; e.code = 'bad_request'; throw e;
  }
  const allCandidate = new Set([
    ...(candidate.proposed_in_scope || []),
    ...(candidate.proposed_deferred || [])
  ]);
  // Validation: every id in include/defer must come from the candidate, and
  // every candidate id must end up in exactly one bucket.
  const seen = new Set();
  for (const id of includeIds) {
    if (!allCandidate.has(id)) {
      const e = new Error(`unknown requirement_id in include_ids: ${id}`);
      e.status = 400; e.code = 'unknown_id'; throw e;
    }
    if (seen.has(id)) {
      const e = new Error(`duplicate requirement_id: ${id}`);
      e.status = 400; e.code = 'duplicate_id'; throw e;
    }
    seen.add(id);
  }
  for (const id of deferIds) {
    if (!allCandidate.has(id)) {
      const e = new Error(`unknown requirement_id in defer_ids: ${id}`);
      e.status = 400; e.code = 'unknown_id'; throw e;
    }
    if (seen.has(id)) {
      const e = new Error(`requirement_id ${id} in both include and defer`);
      e.status = 400; e.code = 'duplicate_id'; throw e;
    }
    seen.add(id);
  }
  const missing = [...allCandidate].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    const e = new Error(`candidate ids unassigned: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
    e.status = 400; e.code = 'unassigned_ids'; e.detail = missing; throw e;
  }

  const derived = await readJsonOr(derivedPath(localPath), null);
  const idx = costIndex(derived);

  const inScope = includeIds.slice();
  const deferred = deferIds.map((rid) => ({
    requirement_id: rid,
    reason: 'user-deferred at scope lock',
    est_cost_usd: costFor(rid, idx)
  }));
  const estIn = round(inScope.reduce((s, r) => s + costFor(r, idx), 0));
  const estDef = round(deferred.reduce((s, r) => s + r.est_cost_usd, 0));

  // Budget enforcement: if budget_usd is supplied and in-scope cost exceeds
  // it, refuse the lock so the user has to defer more or raise the budget.
  const budget = typeof body.budget_usd === 'number' && body.budget_usd > 0
    ? body.budget_usd : null;
  if (budget != null && estIn > budget) {
    const e = new Error(`in-scope cost $${estIn} exceeds budget $${budget}`);
    e.status = 412; e.code = 'over_budget';
    e.detail = { est_cost_in_scope_usd: estIn, budget_usd: budget };
    throw e;
  }

  const version = await nextVersion(localPath);
  const fileVersion = `v0.${version}.json`;
  const snapshot = {
    version,
    file_version: fileVersion,
    project_id: projectId,
    locked_at: new Date().toISOString(),
    based_on_candidate_generated_at: candidate.generated_at,
    in_scope: inScope,
    deferred,
    totals: {
      in_scope_count: inScope.length,
      deferred_count: deferred.length,
      est_cost_in_scope_usd: estIn,
      est_cost_deferred_usd: estDef
    },
    budget_usd: budget,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 4000) : ''
  };

  await writeJson(lockSnapshotPath(localPath, version), snapshot);
  // Update latest pointer.
  await writeJson(latestPointerPath(localPath), {
    version, file_version: fileVersion, locked_at: snapshot.locked_at
  });

  if (decisionLog && typeof decisionLog.logDecision === 'function') {
    try {
      await decisionLog.logDecision(projectId, {
        decided_by: 'user',
        category: 'scope',
        question: `Lock scope ${fileVersion}?`,
        options: ['lock', 'keep editing'],
        choice: `lock ${fileVersion}`,
        rationale: snapshot.notes || `${inScope.length} in-scope, ${deferred.length} deferred ($${estIn})`,
        source_refs: ['phase6-A6', `scope/${fileVersion}`],
        graph_node_id: null,
        escalated_from: null
      });
    } catch (_e) { /* best-effort */ }
  }

  return snapshot;
}

module.exports = {
  getCandidate,
  proposeScope,
  listScopes,
  getScope,
  lockScope,
  DEFAULT_REQ_COST_USD,
  _paths: { scopeDir, latestPointerPath, lockSnapshotPath, candidatePath }
};
