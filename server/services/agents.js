'use strict';

// Live agent dashboard data source (Phase 6 B6).
//
// Reads ~/.claude/teams/*/config.json + per-agent inbox JSON to produce a
// snapshot of every agent across every team the user has spawned.
//
// Per the HAKCD-Phase-4 pain that motivated B6: agents pipe their tool
// permission requests as JSON messages of `type: permission_request` into
// the team-lead inbox; if nobody acts on them, the agent stalls silently.
// We surface those pending requests on each agent's card with approve/deny.
//
// v1 is read-mostly. Approval piping back to the claude CLI is a separate
// channel (the running CLI uses --permission-prompt-tool stdio) — for v1 we
// write the operator's intent to a flag file at
//   ~/.claude/teams/<team>/permission_decisions/<request_id>.json
// so external tooling (or the operator's CLI session) can pick it up. The
// dashboard itself never shells out — that scope creep belongs in v1.5.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const TEAMS_ROOT = path.join(os.homedir(), '.claude', 'teams');
const DECISIONS_SUBDIR = 'permission_decisions';

const SAFE_TEAM_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-]{0,127}$/;
const SAFE_AGENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-@]{0,127}$/;
const SAFE_REQ_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-]{0,127}$/;

function isSafeTeam(t) { return typeof t === 'string' && SAFE_TEAM_RE.test(t); }
function isSafeAgent(a) { return typeof a === 'string' && SAFE_AGENT_RE.test(a); }
function isSafeReqId(r) { return typeof r === 'string' && SAFE_REQ_RE.test(r); }

// ----------------------------------------------------------------------------
// Discovery
// ----------------------------------------------------------------------------

async function listTeams() {
  let entries;
  try { entries = await fsp.readdir(TEAMS_ROOT, { withFileTypes: true }); }
  catch (_e) { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!isSafeTeam(e.name)) continue;
    out.push(e.name);
  }
  out.sort();
  return out;
}

async function readTeamConfig(teamName) {
  if (!isSafeTeam(teamName)) return null;
  const file = path.join(TEAMS_ROOT, teamName, 'config.json');
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (_e) { return null; }
}

async function readInbox(teamName, agentName) {
  if (!isSafeTeam(teamName) || !isSafeAgent(agentName)) return [];
  const file = path.join(TEAMS_ROOT, teamName, 'inboxes', `${agentName}.json`);
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
}

// ----------------------------------------------------------------------------
// Permission request extraction
// ----------------------------------------------------------------------------

// Walks a team's *team-lead* inbox (where permission_request messages land
// per the in-process agent runtime) and groups by request_id. Returns the
// open (unanswered) requests keyed by the originating agent's name.
async function listPendingPermissions(teamName) {
  const inbox = await readInbox(teamName, 'team-lead');
  const decisions = await readDecisions(teamName);

  // Each entry's text may be plain prose OR a JSON-encoded protocol message.
  // Only the JSON ones interest us; we tolerate parse failures silently.
  const byAgent = {};
  const seenIds = new Set();
  for (const msg of inbox) {
    if (!msg || typeof msg.text !== 'string') continue;
    let body;
    try { body = JSON.parse(msg.text); }
    catch (_e) { continue; }
    if (!body || body.type !== 'permission_request') continue;
    const reqId = String(body.request_id || '').trim();
    if (!reqId || !isSafeReqId(reqId)) continue;
    if (seenIds.has(reqId)) continue;
    // If a decision file exists for this request, treat it as resolved.
    if (decisions[reqId]) continue;
    seenIds.add(reqId);

    const agentName = body.agent_id || msg.from || 'unknown';
    if (!byAgent[agentName]) byAgent[agentName] = [];
    byAgent[agentName].push({
      request_id: reqId,
      tool_name: body.tool_name || null,
      tool_use_id: body.tool_use_id || null,
      description: body.description || null,
      input: body.input || null,
      permission_suggestions: Array.isArray(body.permission_suggestions) ? body.permission_suggestions : [],
      requested_at: msg.timestamp || null
    });
  }
  return byAgent;
}

async function readDecisions(teamName) {
  const dir = path.join(TEAMS_ROOT, teamName, DECISIONS_SUBDIR);
  const out = {};
  let files;
  try { files = await fsp.readdir(dir); }
  catch (_e) { return out; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const reqId = f.slice(0, -5);
    if (!isSafeReqId(reqId)) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, f), 'utf8');
      out[reqId] = JSON.parse(raw);
    } catch (_e) { /* skip */ }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Last-activity probe — uses the agent's INCOMING inbox mtime (cheap proxy)
// ----------------------------------------------------------------------------

async function agentLastActivity(teamName, agentName) {
  // Most-recent of: their inbox file mtime + their newest sent message ts
  // recorded in team-lead inbox.
  let inboxMtime = null;
  try {
    const st = await fsp.stat(path.join(TEAMS_ROOT, teamName, 'inboxes', `${agentName}.json`));
    inboxMtime = st.mtimeMs;
  } catch (_e) { /* maybe never received */ }
  let sentLatestMs = null;
  try {
    const lead = await readInbox(teamName, 'team-lead');
    for (const m of lead) {
      if (m.from !== agentName) continue;
      const ms = m.timestamp ? Date.parse(m.timestamp) : null;
      if (ms && (sentLatestMs === null || ms > sentLatestMs)) sentLatestMs = ms;
    }
  } catch (_e) { /* ignore */ }
  if (inboxMtime === null && sentLatestMs === null) return null;
  if (inboxMtime === null) return sentLatestMs;
  if (sentLatestMs === null) return inboxMtime;
  return Math.max(inboxMtime, sentLatestMs);
}

// ----------------------------------------------------------------------------
// Per-agent last messages (newest N from their inbox)
// ----------------------------------------------------------------------------

async function agentRecentMessages(teamName, agentName, limit = 10) {
  const inbox = await readInbox(teamName, agentName);
  // inbox entries are append-ordered; take last N, reverse so newest first.
  return inbox.slice(-limit).reverse().map((m) => ({
    from: m.from || null,
    summary: m.summary || null,
    text_preview: typeof m.text === 'string' ? m.text.slice(0, 280) : null,
    timestamp: m.timestamp || null,
    read: !!m.read
  }));
}

// ----------------------------------------------------------------------------
// Composite snapshot
// ----------------------------------------------------------------------------

async function snapshot() {
  const teams = await listTeams();
  const out = [];
  for (const teamName of teams) {
    const cfg = await readTeamConfig(teamName);
    if (!cfg) continue;
    const pendingByAgent = await listPendingPermissions(teamName);
    const members = Array.isArray(cfg.members) ? cfg.members : [];
    for (const member of members) {
      const name = member.name || member.agentId;
      if (!name || !isSafeAgent(name)) continue;
      const pending = pendingByAgent[name] || [];
      const lastActivityMs = await agentLastActivity(teamName, name);
      // Status heuristic: pending if has open permission_request, else idle
      // if any activity, else unknown. The in-process agent runtime doesn't
      // expose a true running/stopped flag through these files — surfacing
      // permission gates was the load-bearing requirement.
      const status = pending.length > 0
        ? 'awaiting_permission'
        : (lastActivityMs ? 'idle' : 'unknown');
      out.push({
        team: teamName,
        name,
        agent_id: member.agentId || `${name}@${teamName}`,
        agent_type: member.agentType || null,
        color: member.color || null,
        model: member.model || null,
        cwd: member.cwd || cfg.cwd || null,
        backend_type: member.backendType || null,
        is_lead: cfg.leadAgentId === member.agentId,
        joined_at: member.joinedAt || null,
        last_activity_ms: lastActivityMs,
        last_activity_iso: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
        status,
        pending_permissions: pending,
        // Big-blob fields kept out of the list view; available via detail.
      });
    }
  }
  // Sort: pending first (oldest pending first), then most-recently-active.
  out.sort((a, b) => {
    if (a.status === 'awaiting_permission' && b.status !== 'awaiting_permission') return -1;
    if (b.status === 'awaiting_permission' && a.status !== 'awaiting_permission') return 1;
    const ap = a.pending_permissions[0];
    const bp = b.pending_permissions[0];
    if (ap && bp) {
      const ta = ap.requested_at ? Date.parse(ap.requested_at) : 0;
      const tb = bp.requested_at ? Date.parse(bp.requested_at) : 0;
      return ta - tb; // oldest pending first
    }
    return (b.last_activity_ms || 0) - (a.last_activity_ms || 0);
  });
  return out;
}

async function detail(teamName, agentName) {
  if (!isSafeTeam(teamName)) { const e = new Error('bad team'); e.status = 400; throw e; }
  if (!isSafeAgent(agentName)) { const e = new Error('bad agent name'); e.status = 400; throw e; }
  const cfg = await readTeamConfig(teamName);
  if (!cfg) { const e = new Error('team not found'); e.status = 404; throw e; }
  const member = (cfg.members || []).find((m) => (m.name || m.agentId) === agentName);
  if (!member) { const e = new Error('agent not found'); e.status = 404; throw e; }
  const messages = await agentRecentMessages(teamName, agentName, 25);
  const pendingByAgent = await listPendingPermissions(teamName);
  const lastActivityMs = await agentLastActivity(teamName, agentName);
  return {
    team: teamName,
    name: agentName,
    agent_id: member.agentId,
    agent_type: member.agentType || null,
    model: member.model || null,
    cwd: member.cwd || cfg.cwd || null,
    backend_type: member.backendType || null,
    is_lead: cfg.leadAgentId === member.agentId,
    joined_at: member.joinedAt || null,
    prompt: typeof member.prompt === 'string' ? member.prompt : null,
    last_activity_ms: lastActivityMs,
    last_activity_iso: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
    pending_permissions: pendingByAgent[agentName] || [],
    recent_messages: messages
  };
}

// ----------------------------------------------------------------------------
// Permission decision (operator response)
//
// Writes the operator's decision to a flag file. The dashboard does NOT shell
// out to the claude CLI here — the running CLI uses stdio-bound permission
// prompts and reading from this file is a follow-up integration. v1's job is
// to make the gate VISIBLE and to record the operator's intent.
// ----------------------------------------------------------------------------

async function recordDecision(teamName, agentName, requestId, approve, reason) {
  if (!isSafeTeam(teamName)) { const e = new Error('bad team'); e.status = 400; throw e; }
  if (!isSafeAgent(agentName)) { const e = new Error('bad agent name'); e.status = 400; throw e; }
  if (!isSafeReqId(requestId)) { const e = new Error('bad request_id'); e.status = 400; throw e; }
  const decisionsDir = path.join(TEAMS_ROOT, teamName, DECISIONS_SUBDIR);
  await fsp.mkdir(decisionsDir, { recursive: true });
  const file = path.join(decisionsDir, `${requestId}.json`);
  const body = {
    request_id: requestId,
    agent: agentName,
    team: teamName,
    approve: !!approve,
    reason: typeof reason === 'string' ? reason.slice(0, 1024) : null,
    decided_at: new Date().toISOString(),
    decided_by: 'dashboard'
  };
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(body, null, 2));
  await fsp.rename(tmp, file);
  return body;
}

module.exports = {
  snapshot,
  detail,
  recordDecision,
  // exposed for tests
  _internals: {
    listTeams, readTeamConfig, readInbox,
    listPendingPermissions, agentLastActivity, agentRecentMessages,
    isSafeTeam, isSafeAgent, isSafeReqId,
    TEAMS_ROOT, DECISIONS_SUBDIR
  }
};
