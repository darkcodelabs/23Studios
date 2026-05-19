'use strict';

// Phase 6 B3 — Asset Approver service.
//
// Reads the per-project approval queue and applies decisions to it. Decisions
// flow into the C2 decision_log so the audit trail is unified — the queue
// file is just operational state.
//
// On-disk layout:
//
//   <local_path>/sdk_data/approvals/queue.json    pending entries (mutable)
//   <local_path>/sdk_data/approvals/archive.jsonl decided entries (append-only)
//
// queue.json shape:
//   {
//     items: [
//       {
//         asset_id:        "scene_sc01_bg" (stable, used in URLs),
//         kind:            "scene" | "portrait" | "tile" | "ui" | "other",
//         scene_id:        string | null,
//         character_id:    string | null,
//         prompt_text:     string,            // what was sent to image-gen
//         generated_path:  "sdk_data/scenes/sc01.png",   // relative to local_path
//         anchor_path:     "refs/forest.png" | null,
//         canon_sections:  ["§3", "§7"],
//         skill_rule_checks: [
//           { rule: "#1", label: "1-bit palette", pass: true,  note: null },
//           { rule: "#4", label: "tile >= 16x16",  pass: false, note: "found 12x12" }
//         ],
//         cost_usd:        0.012,             // image-gen cost for this asset
//         queued_at:       ISO-8601,
//         attempts:        1
//       }
//     ]
//   }
//
// All path inputs are validated to live inside the project tree.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const decisionLog = require('./decision_log');
const driftDetect = require('./drift_detect');

const DECISIONS = Object.freeze([
  'approve',
  'reject',
  'reroll_same',
  'reroll_variant',
  'fallback_safe',
  'defer'
]);

// Mapping decision → behavior in queue.
// - approve/reject/reroll_*/fallback_safe — remove from queue + append to archive
// - defer — keep in queue (move to end), bump attempts (so it doesn't dominate
//   the head). The asset stays decidable; defer is explicitly "look at me later".
const REMOVES_FROM_QUEUE = new Set([
  'approve', 'reject', 'reroll_same', 'reroll_variant', 'fallback_safe'
]);

const MAX_PROMPT_BYTES = 16 * 1024;
const MAX_REASON = 4000;

function queuePath(localPath)   { return path.join(localPath, 'sdk_data', 'approvals', 'queue.json'); }
function archivePath(localPath) { return path.join(localPath, 'sdk_data', 'approvals', 'archive.jsonl'); }

// Per-project lock to serialize queue mutations.
const _chains = new Map();
function withProjectLock(projectId, fn) {
  const prev = _chains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  _chains.set(projectId, next.catch(() => {}));
  return next;
}

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) { const e = new Error('project not found'); e.status = 404; e.code = 'not_found'; throw e; }
  if (!proj.local_path) { const e = new Error('project has no local_path'); e.status = 400; e.code = 'no_local_path'; throw e; }
  return proj;
}

async function readQueueRaw(localPath) {
  const p = queuePath(localPath);
  let raw;
  try { raw = await fsp.readFile(p, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { items: [] };
    throw e;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return { items: [] };
    return parsed;
  } catch (_e) {
    return { items: [] };
  }
}

async function writeQueueAtomic(localPath, data) {
  const p = queuePath(localPath);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, p);
}

async function appendArchive(localPath, entry) {
  const p = archivePath(localPath);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.appendFile(p, JSON.stringify(entry) + '\n', { mode: 0o600 });
}

// Normalize an item out of queue.json so the UI gets predictable shapes
// regardless of how the writer stored it. Also clamps long fields.
function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const asset_id = typeof raw.asset_id === 'string' ? raw.asset_id : null;
  if (!asset_id) return null;
  const prompt = typeof raw.prompt_text === 'string' ? raw.prompt_text : '';
  const skillChecks = Array.isArray(raw.skill_rule_checks)
    ? raw.skill_rule_checks.filter((c) => c && typeof c === 'object').map((c) => ({
        rule:  String(c.rule || ''),
        label: String(c.label || ''),
        pass:  !!c.pass,
        note:  c.note == null ? null : String(c.note)
      }))
    : [];
  return {
    asset_id,
    kind: typeof raw.kind === 'string' ? raw.kind : 'other',
    scene_id:     raw.scene_id == null ? null : String(raw.scene_id),
    character_id: raw.character_id == null ? null : String(raw.character_id),
    prompt_text:  prompt.length > MAX_PROMPT_BYTES ? prompt.slice(0, MAX_PROMPT_BYTES) : prompt,
    generated_path: raw.generated_path == null ? null : String(raw.generated_path),
    anchor_path:    raw.anchor_path == null ? null : String(raw.anchor_path),
    canon_sections: Array.isArray(raw.canon_sections) ? raw.canon_sections.map(String) : [],
    skill_rule_checks: skillChecks,
    cost_usd: typeof raw.cost_usd === 'number' ? raw.cost_usd : 0,
    queued_at: raw.queued_at || null,
    attempts:  typeof raw.attempts === 'number' ? raw.attempts : 1
  };
}

async function readQueue(projectId) {
  const proj = await resolveProject(projectId);
  const data = await readQueueRaw(proj.local_path);
  const items = data.items.map(sanitizeItem).filter(Boolean);

  // Per-item drift verdict: pulled from drift_flags.jsonl if available so the
  // UI doesn't need to compute pHash on its own. Drift flags are by scene_id +
  // generated_path, so we match on whichever shape the item supplies.
  let driftIndex = new Map();
  try {
    const flags = await driftDetect.readDriftFlags(projectId, {});
    for (const f of flags.items || []) {
      const key = f.generated_path || f.scene_id;
      if (key) driftIndex.set(key, f);
    }
  } catch (_e) { /* drift flags optional */ }

  const enriched = items.map((it) => {
    const key = it.generated_path || it.scene_id;
    const drift = key ? driftIndex.get(key) || null : null;
    const failedSkill = (it.skill_rule_checks || []).filter((c) => !c.pass);
    return {
      ...it,
      drift_verdict: drift
        ? {
            flagged: true,
            perceptual_distance: drift.perceptual_distance ?? null,
            threshold: drift.threshold ?? null,
            kind: drift.kind || null,
            note: drift.note || null
          }
        : { flagged: false, perceptual_distance: null, threshold: null, kind: null, note: null },
      skill_pass: failedSkill.length === 0,
      skill_failed_count: failedSkill.length
    };
  });

  // Sort: failed skill or drift-flagged first (so the urgent ones float up),
  // then by queued_at ascending (FIFO within bucket).
  enriched.sort((a, b) => {
    const aBad = (a.drift_verdict.flagged ? 1 : 0) + (a.skill_pass ? 0 : 1);
    const bBad = (b.drift_verdict.flagged ? 1 : 0) + (b.skill_pass ? 0 : 1);
    if (aBad !== bBad) return bBad - aBad;
    const at = a.queued_at ? new Date(a.queued_at).getTime() : 0;
    const bt = b.queued_at ? new Date(b.queued_at).getTime() : 0;
    return at - bt;
  });

  const total_cost_usd = enriched.reduce((s, x) => s + (x.cost_usd || 0), 0);

  return {
    items: enriched,
    count: enriched.length,
    total_cost_usd
  };
}

function validateDecision(d) {
  if (typeof d !== 'string') return 'decision must be string';
  if (!DECISIONS.includes(d)) return `decision must be one of: ${DECISIONS.join(', ')}`;
  return null;
}

// Apply a decision. Returns { item, decision, removed, archived_at }.
async function decide(projectId, assetId, { decision, decided_by, reason, source_refs } = {}) {
  const proj = await resolveProject(projectId);

  const decErr = validateDecision(decision);
  if (decErr) { const e = new Error(decErr); e.status = 400; e.code = 'bad_decision'; throw e; }

  if (typeof assetId !== 'string' || !assetId) {
    const e = new Error('asset_id required'); e.status = 400; e.code = 'bad_asset_id'; throw e;
  }

  const safeReason = typeof reason === 'string' ? reason.slice(0, MAX_REASON) : '';

  // Mutate queue under a project lock so two concurrent decisions can't drop
  // the same entry or interleave the JSON rewrite.
  const result = await withProjectLock(projectId, async () => {
    const data = await readQueueRaw(proj.local_path);
    const idx = data.items.findIndex((x) => x && x.asset_id === assetId);
    if (idx === -1) {
      const e = new Error(`asset not in queue: ${assetId}`);
      e.status = 404; e.code = 'asset_not_in_queue'; throw e;
    }
    const item = data.items[idx];
    const decided_at = new Date().toISOString();

    if (REMOVES_FROM_QUEUE.has(decision)) {
      data.items.splice(idx, 1);
      await appendArchive(proj.local_path, {
        ...item,
        decision,
        decided_by: decided_by || 'user',
        reason: safeReason,
        decided_at
      });
    } else {
      // defer — keep in queue, push to end, bump attempts
      const moved = { ...item, attempts: (item.attempts || 1) + 1, last_deferred_at: decided_at };
      data.items.splice(idx, 1);
      data.items.push(moved);
    }

    await writeQueueAtomic(proj.local_path, data);
    return { item, decided_at };
  });

  // Mirror to C2 decision log. Best-effort — if decision_log validation rejects
  // we surface the error so the operator sees it (rather than silently losing
  // the audit trail).
  const sanitizedItem = sanitizeItem(result.item) || { asset_id: assetId };
  const refs = Array.isArray(source_refs) ? source_refs.slice() : [];
  if (sanitizedItem.canon_sections) refs.push(...sanitizedItem.canon_sections.map((s) => `canon:${s}`));
  if (sanitizedItem.generated_path) refs.push(`asset:${sanitizedItem.generated_path}`);

  try {
    await decisionLog.logDecision(projectId, {
      decided_by: decided_by || 'user',
      category: 'gate-signoff',
      question: `Asset approval: ${assetId}${sanitizedItem.scene_id ? ` (scene ${sanitizedItem.scene_id})` : ''}`,
      options: DECISIONS,
      choice: decision,
      rationale: safeReason,
      source_refs: refs,
      graph_node_id: sanitizedItem.scene_id || null
    });
  } catch (e) {
    // Re-throw — operator needs to know the audit trail failed.
    const wrapped = new Error(`decision applied but decision_log write failed: ${e.message}`);
    wrapped.status = 500;
    wrapped.code = 'decision_log_failed';
    throw wrapped;
  }

  return {
    asset_id: assetId,
    decision,
    decided_at: result.decided_at,
    removed_from_queue: REMOVES_FROM_QUEUE.has(decision),
    item: sanitizedItem
  };
}

// Helper for tests: seed the queue with N items.
async function _seedQueue(localPath, items) {
  await writeQueueAtomic(localPath, { items });
}

module.exports = {
  readQueue,
  decide,
  DECISIONS,
  _internals: {
    sanitizeItem,
    queuePath,
    archivePath,
    validateDecision,
    _seedQueue,
    REMOVES_FROM_QUEUE
  }
};
