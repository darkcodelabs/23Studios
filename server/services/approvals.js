'use strict';

// Asset approval queue (Phase 6 B3).
//
// Reads the generated-images queue from `<local_path>/sdk_data/approvals/queue.json`.
// Each item describes one asset awaiting human decision:
//   { id, scene_id, prompt_sent, image_path, anchor_path,
//     canon_section_cited, skill_rule_results, drift_score, status }
// Decisions are persisted into the same record (status + decided_at + decided_by).
//
// The queue file is the source of truth. The producing pipeline (image
// generation) is expected to append entries to it; here we only read +
// mutate-on-decision. If the file is missing we treat the queue as empty,
// not an error — a brand-new project has nothing to approve.

const path = require('path');
const fsp = require('fs/promises');

const projects = require('./projects');

const VALID_DECISIONS = new Set([
  'approve',
  'reject',
  'reroll_same',
  'reroll_variant',
  'fallback_safe',
  'defer'
]);

// Statuses that mean "still in the queue" for cost-so-far / progress totals.
// `defer` is a decision but keeps the item visible in the queue — the user
// can come back to it without losing the slot.
const PENDING_STATUSES = new Set(['pending', 'deferred', 'defer', null, undefined]);

function approvalsDir(project) {
  return path.join(project.local_path, 'sdk_data', 'approvals');
}

function queueFile(project) {
  return path.join(approvalsDir(project), 'queue.json');
}

async function readQueueRaw(project) {
  try {
    const raw = await fsp.readFile(queueFile(project), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) {
      return { items: parsed.items, cost_so_far: Number(parsed.cost_so_far) || 0 };
    }
    return { items: [], cost_so_far: 0 };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { items: [], cost_so_far: 0 };
    throw e;
  }
}

async function writeQueueRaw(project, data) {
  await fsp.mkdir(approvalsDir(project), { recursive: true, mode: 0o700 });
  const file = queueFile(project);
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

// Convert a file path (relative or absolute) under the project into the
// canonical `/api/projects/:id/file/raw?path=` URL the UI can fetch.
function fileUrl(projectId, project, p) {
  if (!p) return null;
  let rel = p;
  if (path.isAbsolute(p)) {
    const base = project.local_path;
    if (p.startsWith(base + path.sep)) {
      rel = path.relative(base, p);
    } else {
      // Path lives outside the project root — not exposable via /file/raw.
      return null;
    }
  }
  // URL encode each path segment to keep slashes intact.
  const enc = rel.split(path.sep).map(encodeURIComponent).join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/file/raw?path=${enc}`;
}

function shapeItem(projectId, project, item) {
  return {
    id: item.id,
    scene_id: item.scene_id || null,
    prompt_sent: item.prompt_sent || '',
    image_url: fileUrl(projectId, project, item.image_path),
    image_path: item.image_path || null,
    anchor_url: fileUrl(projectId, project, item.anchor_path),
    anchor_path: item.anchor_path || null,
    canon_section_cited: item.canon_section_cited || null,
    skill_rule_results: Array.isArray(item.skill_rule_results) ? item.skill_rule_results : [],
    drift_score: typeof item.drift_score === 'number' ? item.drift_score : null,
    status: item.status || 'pending',
    cost_usd: typeof item.cost_usd === 'number' ? item.cost_usd : 0,
    decided_at: item.decided_at || null,
    decided_by: item.decided_by || null,
    notes: item.notes || null
  };
}

async function getQueue(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) {
    const err = new Error('project not found');
    err.status = 404;
    err.code = 'not_found';
    throw err;
  }
  const raw = await readQueueRaw(project);
  const shaped = raw.items.map((it) => shapeItem(projectId, project, it));
  const pending = shaped.filter((it) => PENDING_STATUSES.has(it.status));
  const decided = shaped.filter((it) => !PENDING_STATUSES.has(it.status));
  return {
    queue: shaped,
    pending_count: pending.length,
    decided_count: decided.length,
    total: shaped.length,
    cost_so_far: raw.cost_so_far,
    gates_blocked: shaped.filter((it) => it.status === 'reject').length
  };
}

async function decide(projectId, assetId, decision, opts = {}) {
  if (!VALID_DECISIONS.has(decision)) {
    const err = new Error(`unknown decision: ${decision}`);
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  const project = await projects.getProject(projectId);
  if (!project) {
    const err = new Error('project not found');
    err.status = 404;
    err.code = 'not_found';
    throw err;
  }
  const data = await readQueueRaw(project);
  const idx = data.items.findIndex((it) => it.id === assetId);
  if (idx === -1) {
    const err = new Error('asset not found in queue');
    err.status = 404;
    err.code = 'not_found';
    throw err;
  }
  const decidedAt = new Date().toISOString();
  data.items[idx] = {
    ...data.items[idx],
    status: decision,
    decided_at: decidedAt,
    decided_by: opts.actor || 'studio'
  };
  await writeQueueRaw(project, data);
  return shapeItem(projectId, project, data.items[idx]);
}

module.exports = {
  getQueue,
  decide,
  // Exposed for tests / pipeline producers.
  _internal: { readQueueRaw, writeQueueRaw, queueFile }
};
