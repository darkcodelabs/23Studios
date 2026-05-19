'use strict';

// gates.js — Phase 6 B9 gate framework.
//
// A "gate" is a user-blocking checkpoint in the work graph. Per spec:
//   - GATE 1 (scope/bible review)
//   - GATE 2 (visual ship)
//   - GATE 3 (smoke test)
//
// Storage: <project>/sdk_data/gates/<gate_id>.json
//   { id, name, status, sub_decisions: [{ id, label, required, decision, decided_by, ts }],
//     description, signed_off_by, signed_off_at }
//
// status: 'pending' (not yet active) | 'active' (awaiting user) | 'signed_off'
//
// A gate can only sign off when every required sub_decision has a non-null
// decision. Sign-off appends a decision-log entry (placeholder until C2 ships)
// and freezes the gate's sub_decisions array.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');

const DEFAULT_GATES = [
  {
    id: 'GATE-1-scope',
    name: 'Gate 1 — Scope & Bible Review',
    description: 'Review the parsed bible, locked scope, and any residue from the requirements interview before any image generation runs.',
    status: 'active',
    sub_decisions: [
      { id: 'bible_parsed', label: 'Bible parsed without errors', required: true, decision: null, decided_by: null, ts: null },
      { id: 'scope_locked', label: 'Scope locked (in vs deferred)', required: true, decision: null, decided_by: null, ts: null },
      { id: 'cost_acceptable', label: 'Estimated cost within budget', required: true, decision: null, decided_by: null, ts: null },
      { id: 'open_questions_resolved', label: 'Open interview questions resolved or explicitly deferred', required: false, decision: null, decided_by: null, ts: null }
    ]
  },
  {
    id: 'GATE-2-visual-ship',
    name: 'Gate 2 — Visual Ship Review',
    description: 'Side-by-side anchor-vs-generated review for every scene and character. Approve each before the build advances.',
    status: 'pending',
    sub_decisions: [
      { id: 'all_scenes_approved', label: 'All scene backgrounds approved', required: true, decision: null, decided_by: null, ts: null },
      { id: 'all_portraits_approved', label: 'All character portraits approved', required: true, decision: null, decided_by: null, ts: null },
      { id: 'launcher_approved', label: 'Launcher card + title screen approved', required: true, decision: null, decided_by: null, ts: null },
      { id: 'cameo_dialog_reviewed', label: 'Cameo / personalization dialog blocks reviewed', required: false, decision: null, decided_by: null, ts: null }
    ]
  },
  {
    id: 'GATE-3-smoke-test',
    name: 'Gate 3 — Smoke Test',
    description: 'Verify the .pdx boots in the simulator and the critical happy-path scenes are reachable without crashes.',
    status: 'pending',
    sub_decisions: [
      { id: 'pdx_boots', label: '.pdx boots in the simulator', required: true, decision: null, decided_by: null, ts: null },
      { id: 'title_to_first_scene', label: 'Title → first scene transition works', required: true, decision: null, decided_by: null, ts: null },
      { id: 'save_state_persists', label: 'Save state persists across restart', required: true, decision: null, decided_by: null, ts: null },
      { id: 'no_crash_in_5min_play', label: 'No crashes during 5-minute play session', required: true, decision: null, decided_by: null, ts: null }
    ]
  }
];

async function gatesDir(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!project.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  const dir = path.join(project.local_path, 'sdk_data', 'gates');
  await fsp.mkdir(dir, { recursive: true });
  return { dir, project };
}

async function ensureSeed(dir) {
  for (const seed of DEFAULT_GATES) {
    const p = path.join(dir, seed.id + '.json');
    if (!fs.existsSync(p)) {
      // Deep clone so seed isn't mutated by later writes.
      const fresh = JSON.parse(JSON.stringify(seed));
      await fsp.writeFile(p, JSON.stringify(fresh, null, 2));
    }
  }
}

async function readGate(dir, gateId) {
  const p = path.join(dir, gateId + '.json');
  if (!fs.existsSync(p)) { const e = new Error('gate_not_found'); e.status = 404; throw e; }
  return JSON.parse(await fsp.readFile(p, 'utf8'));
}

async function writeGate(dir, gate) {
  const p = path.join(dir, gate.id + '.json');
  await fsp.writeFile(p, JSON.stringify(gate, null, 2));
}

async function listGates(projectId) {
  const { dir } = await gatesDir(projectId);
  await ensureSeed(dir);
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const out = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')));
    } catch (_e) { /* skip malformed */ }
  }
  return out;
}

async function getGate(projectId, gateId) {
  const { dir } = await gatesDir(projectId);
  await ensureSeed(dir);
  return readGate(dir, gateId);
}

async function decide({ projectId, gateId, subDecisionId, decision, decidedBy }) {
  const { dir } = await gatesDir(projectId);
  await ensureSeed(dir);
  const gate = await readGate(dir, gateId);
  if (gate.status === 'signed_off') {
    const e = new Error('gate_signed_off'); e.status = 409; throw e;
  }
  const sd = (gate.sub_decisions || []).find((x) => x.id === subDecisionId);
  if (!sd) { const e = new Error('sub_decision_not_found'); e.status = 404; throw e; }
  const norm = normalizeDecision(decision);
  if (norm === undefined) {
    const e = new Error('bad_decision'); e.status = 400;
    e.detail = 'decision must be one of: approve, reject, defer, null';
    throw e;
  }
  sd.decision = norm;
  sd.decided_by = decidedBy || 'user';
  sd.ts = new Date().toISOString();
  // Active-state promotion: if any sub_decision is set, the gate is active.
  if (gate.status === 'pending') gate.status = 'active';
  await writeGate(dir, gate);
  return gate;
}

async function signOff({ projectId, gateId, decidedBy, note }) {
  const { dir } = await gatesDir(projectId);
  await ensureSeed(dir);
  const gate = await readGate(dir, gateId);
  if (gate.status === 'signed_off') return gate;
  const unresolvedRequired = (gate.sub_decisions || [])
    .filter((sd) => sd.required && (sd.decision === null || sd.decision === undefined));
  if (unresolvedRequired.length > 0) {
    const e = new Error('required_decisions_pending');
    e.status = 409;
    e.detail = unresolvedRequired.map((sd) => sd.id);
    throw e;
  }
  gate.status = 'signed_off';
  gate.signed_off_by = decidedBy || 'user';
  gate.signed_off_at = new Date().toISOString();
  if (note) gate.signoff_note = String(note).slice(0, 4000);
  await writeGate(dir, gate);
  return gate;
}

function normalizeDecision(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).toLowerCase();
  if (['approve', 'approved', 'yes', 'pass', 'ok'].includes(s)) return 'approve';
  if (['reject', 'rejected', 'no', 'fail'].includes(s)) return 'reject';
  if (['defer', 'deferred', 'later', 'skip'].includes(s)) return 'defer';
  return undefined;
}

// Compact summary for banner / status calls.
function summarize(gate) {
  const required = (gate.sub_decisions || []).filter((sd) => sd.required);
  const resolved = required.filter((sd) => sd.decision != null);
  return {
    id: gate.id,
    name: gate.name,
    status: gate.status,
    description: gate.description,
    required_total: required.length,
    required_resolved: resolved.length,
    pending: required.length - resolved.length,
    signed_off_at: gate.signed_off_at || null
  };
}

async function activeGate(projectId) {
  const all = await listGates(projectId);
  // Active = first non-signed-off; if all signed off, return null.
  for (const g of all) {
    if (g.status !== 'signed_off') return g;
  }
  return null;
}

module.exports = {
  listGates, getGate, decide, signOff, summarize, activeGate, DEFAULT_GATES
};
