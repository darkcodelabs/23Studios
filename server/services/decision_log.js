'use strict';

// Decision Log (Phase 6 C2).
//
// Append-only JSONL at <project>/sdk_data/decisions.jsonl. Every entry is one
// JSON object on its own line. We never rewrite or compact — the file is the
// audit trail. Concurrent writers are serialized through an in-process chain
// per project so two callers in the same Node process can't interleave bytes
// mid-line. Cross-process safety is provided by POSIX append semantics for
// writes under the OS page size; the schema is bounded to keep us inside
// that envelope.
//
// Schema (per spec C2):
//   {
//     ts:            ISO-8601 string,
//     decided_by:    "orchestrator" | "user" | "agent:<name>",
//     category:      one of CATEGORIES,
//     question:      string (what was being decided),
//     options:       string[] (what was on offer),
//     choice:        string  (what was picked),
//     rationale:     string  (why),
//     source_refs:   string[] (canon §X, SKILL.md rule Y, etc),
//     graph_node_id: string | null (B6 work graph node, if any),
//     escalated_from: string | null (decided_by that punted up, if any)
//   }
//
// Filters (readDecisions) match exactly on decided_by + category, and on a
// half-open [from, to) timestamp window. Anything else is client-side.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

const CATEGORIES = new Set([
  'scope',
  'scene-content',
  'prompt-variant',
  'fallback-vs-original',
  'gate-signoff',
  'filter-safe-vs-canon',
  'drift',
  'grounding',
  'other'
]);

const MAX_QUESTION = 2000;
const MAX_RATIONALE = 4000;
const MAX_CHOICE = 1000;
const MAX_OPTION = 1000;
const MAX_OPTIONS = 32;
const MAX_SOURCE_REFS = 32;
const MAX_SOURCE_REF = 200;
const MAX_LINE_BYTES = 64 * 1024;

// One promise chain per project so appends serialize.
const _chains = new Map();
function withProjectLock(projectId, fn) {
  const prev = _chains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  _chains.set(projectId, next.catch(() => {}));
  return next;
}

function decisionsPath(localPath) {
  return path.join(localPath, 'sdk_data', 'decisions.jsonl');
}

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) {
    const e = new Error(`project not found: ${projectId}`);
    e.status = 404; e.code = 'not_found';
    throw e;
  }
  if (!proj.local_path) {
    const e = new Error(`project ${projectId} has no local_path`);
    e.status = 400; e.code = 'no_local_path';
    throw e;
  }
  return proj;
}

function clampStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

function validateDecidedBy(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === 'orchestrator' || s === 'user') return s;
  if (s.startsWith('agent:')) {
    const name = s.slice(6).trim();
    if (!name) return null;
    if (name.length > 80) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9_\-./]{0,79}$/.test(name)) return null;
    return `agent:${name}`;
  }
  return null;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') {
    const e = new Error('entry must be an object');
    e.status = 400; e.code = 'bad_entry';
    throw e;
  }
  const decided_by = validateDecidedBy(raw.decided_by);
  if (!decided_by) {
    const e = new Error('decided_by must be "orchestrator", "user", or "agent:<name>"');
    e.status = 400; e.code = 'bad_decided_by';
    throw e;
  }
  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
  if (!CATEGORIES.has(category)) {
    const e = new Error(`category must be one of: ${Array.from(CATEGORIES).join(', ')}`);
    e.status = 400; e.code = 'bad_category';
    throw e;
  }
  const question = clampStr(raw.question, MAX_QUESTION);
  if (!question) {
    const e = new Error('question is required');
    e.status = 400; e.code = 'bad_question';
    throw e;
  }
  const choice = clampStr(raw.choice, MAX_CHOICE);
  if (!choice) {
    const e = new Error('choice is required');
    e.status = 400; e.code = 'bad_choice';
    throw e;
  }
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions
    .slice(0, MAX_OPTIONS)
    .map((o) => clampStr(o, MAX_OPTION))
    .filter(Boolean);
  const rationale = clampStr(raw.rationale, MAX_RATIONALE);
  const rawRefs = Array.isArray(raw.source_refs) ? raw.source_refs : [];
  const source_refs = rawRefs
    .slice(0, MAX_SOURCE_REFS)
    .map((r) => clampStr(r, MAX_SOURCE_REF))
    .filter(Boolean);
  const graph_node_id = raw.graph_node_id == null
    ? null
    : clampStr(raw.graph_node_id, 200) || null;
  const escalated_from = raw.escalated_from == null
    ? null
    : (validateDecidedBy(raw.escalated_from) || null);

  // Allow caller-provided ts (so a worker can backfill historic decisions),
  // but always validate as ISO-8601. Default to now.
  let ts;
  if (raw.ts) {
    const t = new Date(raw.ts);
    if (Number.isNaN(t.getTime())) {
      const e = new Error('ts must be ISO-8601');
      e.status = 400; e.code = 'bad_ts';
      throw e;
    }
    ts = t.toISOString();
  } else {
    ts = new Date().toISOString();
  }

  return { ts, decided_by, category, question, options, choice, rationale, source_refs, graph_node_id, escalated_from };
}

async function logDecision(projectId, entry) {
  const proj = await resolveProject(projectId);
  const normalized = normalizeEntry(entry);
  const line = JSON.stringify(normalized) + '\n';
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    const e = new Error(`entry exceeds ${MAX_LINE_BYTES} bytes`);
    e.status = 413; e.code = 'entry_too_large';
    throw e;
  }
  return withProjectLock(projectId, async () => {
    const file = decisionsPath(proj.local_path);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, line, { mode: 0o600 });
    return normalized;
  });
}

function parseTimeFilter(v) {
  if (!v) return null;
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  return t.getTime();
}

async function readDecisions(projectId, filters = {}) {
  const proj = await resolveProject(projectId);
  const file = decisionsPath(proj.local_path);

  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { items: [], count: 0 };
    throw e;
  }

  const decidedBy = typeof filters.decided_by === 'string' ? filters.decided_by.trim() : '';
  const category = typeof filters.category === 'string' ? filters.category.trim() : '';
  const fromMs = parseTimeFilter(filters.from);
  const toMs = parseTimeFilter(filters.to);

  const items = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); }
    catch (_e) { continue; } // skip corrupt line, don't fail the whole read
    if (decidedBy && obj.decided_by !== decidedBy) continue;
    if (category && obj.category !== category) continue;
    if (fromMs != null || toMs != null) {
      const ts = obj.ts ? new Date(obj.ts).getTime() : NaN;
      if (Number.isNaN(ts)) continue;
      if (fromMs != null && ts < fromMs) continue;
      if (toMs != null && ts >= toMs) continue;
    }
    items.push(obj);
  }
  return { items, count: items.length };
}

module.exports = {
  logDecision,
  readDecisions,
  CATEGORIES: Array.from(CATEGORIES),
  _internals: { normalizeEntry, validateDecidedBy }
};
