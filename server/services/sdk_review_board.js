'use strict';

// sdk_review_board.js — user-facing review board + decisions log surface.
//
// Produces two human-readable files per project:
//   <sdkRoot>/sdk_data/review_board.md   — checklist of every pending item
//   <sdkRoot>/sdk_data/review_board.json — machine-readable mirror
//
// And two decisions-log files:
//   <sdkRoot>/sdk_data/decisions.md    — append-only human-readable log
//   <sdkRoot>/sdk_data/decisions.jsonl — machine-readable mirror
//
// All exports are async. sync() is the primary entry point.

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');

const projects     = require('./projects');
const gates        = require('./gates');
const decisionLog  = require('./decision_log');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SDK_DATA_REL = 'sdk_data';

async function resolveProject(projectId) {
  const proj = await projects.getProject(projectId);
  if (!proj) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!proj.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  return proj;
}

function sdkDataDir(sdkRoot) {
  return sdkRoot.endsWith(SDK_DATA_REL) ? sdkRoot : path.join(sdkRoot, SDK_DATA_REL);
}

function boardJsonPath(sdkRoot)   { return path.join(sdkDataDir(sdkRoot), 'review_board.json'); }
function boardMdPath(sdkRoot)     { return path.join(sdkDataDir(sdkRoot), 'review_board.md'); }
function decisionsMdPath(sdkRoot) { return path.join(sdkDataDir(sdkRoot), 'decisions.md'); }
function decisionsJsonlPath(sdkRoot) { return path.join(sdkDataDir(sdkRoot), 'decisions.jsonl'); }

// Phase-number → human label
const PHASE_LABELS = {
  0: 'Phase 0 — Initial Concept',
  1: 'Phase 1 — Scope & Bible',
  2: 'Phase 2 — Visual Ship',
  3: 'Phase 3 — Code Review',
  4: 'Phase 4 — Release',
};

function phaseLabel(n) { return PHASE_LABELS[n] || `Phase ${n}`; }

// Map gate ids to phases + types
function gatePhase(gateId) {
  if (gateId === 'concept_pick')       return 0;
  if (gateId === 'GATE-1-scope')       return 1;
  if (gateId === 'GATE-2-visual-ship') return 2;
  if (gateId === 'GATE-3-smoke-test')  return 3;
  return 4;
}

// Command grammar per spec
const COMMAND_GRAMMAR = {
  concept_pick:       (id) => `APPROVE CONCEPT ${id}`,
  concept_revise:     (id) => `REVISE CONCEPT ${id}: <your notes>`,
  gate_approve:       (n)  => `APPROVE PHASE ${n}`,
  gate_revise:        (n)  => `REVISE PHASE ${n}: <your notes>`,
  batch_review:       ()   => `SHOW SAMPLE`,
  milestone_build:    ()   => `BUILD SAMPLE`,
  sim_run:            ()   => `RUN SIMULATOR`,
  lock_design:        ()   => `LOCK DESIGN`,
  kick_off:           ()   => `KICK OFF FULL BUILD`,
  release:            ()   => `APPROVE RELEASE`,
};

// Review questions per item type
const REVIEW_QUESTIONS = {
  concept:   ['Does the core fantasy hold up?', 'Is the tone right?', 'Does the Playdate mechanic hook feel unique?'],
  gate:      ['Are all required decisions resolved?', 'Is the scope realistic for a 400×240 1-bit game?', 'Any open questions that should be deferred?'],
  batch:     ['Does the art style match the visual brief?', 'Is the 1-bit dither quality acceptable?', 'Any scenes that need a revise pass?'],
  milestone: ['Did the build succeed?', 'Does it boot in the Simulator?', 'Any runtime errors in the first 60 seconds?'],
  release:   ['Is the .pdx clean?', 'Did preflight pass all checks?', 'Ready to ship?'],
};

function questionsFor(type) { return REVIEW_QUESTIONS[type] || REVIEW_QUESTIONS.gate; }

// ---------------------------------------------------------------------------
// Item collectors
// ---------------------------------------------------------------------------

async function collectConceptItems(localPath) {
  const items = [];
  const gatesDir = path.join(localPath, SDK_DATA_REL, 'gates');
  const conceptPickPath = path.join(gatesDir, 'concept_pick.json');
  if (!fs.existsSync(conceptPickPath)) return items;

  let gate;
  try { gate = JSON.parse(fs.readFileSync(conceptPickPath, 'utf8')); }
  catch (_e) { return items; }

  const conceptsDir = path.join(localPath, SDK_DATA_REL, 'concepts');
  const conceptIds = Array.isArray(gate.concepts) ? gate.concepts : [];

  for (const cid of conceptIds) {
    const cPath = path.join(conceptsDir, cid + '.json');
    let concept = null;
    try { concept = JSON.parse(fs.readFileSync(cPath, 'utf8')); } catch (_e) { /* */ }

    const isChosen = gate.chosen === cid;
    const status = gate.status === 'awaiting_pick'
      ? 'draft'
      : (isChosen ? 'approved' : 'revise');

    items.push({
      id: `concept:${cid}`,
      phase: 0,
      type: 'concept',
      status,
      files: [cPath],
      approve_cmd: COMMAND_GRAMMAR.concept_pick(cid),
      revise_cmd:  COMMAND_GRAMMAR.concept_revise(cid),
      review_questions: questionsFor('concept'),
      preview_cmd: `SHOW SAMPLE`,
      meta: { concept_id: cid, title: concept && concept.title || cid, gate_status: gate.status }
    });
  }

  return items;
}

async function collectGateItems(projectId, localPath) {
  const items = [];
  let gateList = [];
  try { gateList = await gates.listGates(projectId); } catch (_e) { /* */ }

  for (const g of gateList) {
    const phase = gatePhase(g.id);
    const status = g.status === 'signed_off' ? 'locked'
      : g.status === 'active' ? 'draft' : 'draft';

    items.push({
      id: `gate:${g.id}`,
      phase,
      type: 'gate',
      status,
      files: [path.join(localPath, SDK_DATA_REL, 'gates', g.id + '.json')],
      approve_cmd: COMMAND_GRAMMAR.gate_approve(phase),
      revise_cmd:  COMMAND_GRAMMAR.gate_revise(phase),
      review_questions: questionsFor('gate'),
      preview_cmd: `SHOW SAMPLE`,
      meta: {
        gate_id: g.id,
        name: g.name,
        description: g.description,
        required_total: (g.sub_decisions || []).filter((sd) => sd.required).length,
        required_resolved: (g.sub_decisions || []).filter((sd) => sd.required && sd.decision != null).length,
        signed_off_at: g.signed_off_at || null
      }
    });
  }
  return items;
}

async function collectMilestoneItems(localPath) {
  const items = [];
  const milestonesDir = path.join(localPath, SDK_DATA_REL, 'milestones');
  if (!fs.existsSync(milestonesDir)) return items;

  let mDirs = [];
  try { mDirs = fs.readdirSync(milestonesDir).filter((d) => {
    return fs.statSync(path.join(milestonesDir, d)).isDirectory();
  }); } catch (_e) { return items; }

  for (const mId of mDirs) {
    const statusPath = path.join(milestonesDir, mId, 'status.json');
    if (!fs.existsSync(statusPath)) continue;
    let ms;
    try { ms = JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch (_e) { continue; }

    // Only surface milestones with failures on the board
    if (ms.boots === true && (!ms.errors || ms.errors.length === 0)) continue;

    items.push({
      id: `milestone:${mId}`,
      phase: 3,
      type: 'milestone',
      status: 'revise',
      files: [statusPath, path.join(milestonesDir, mId, 'log.txt')],
      approve_cmd: COMMAND_GRAMMAR.milestone_build(),
      revise_cmd:  `BUILD SAMPLE`,
      review_questions: questionsFor('milestone'),
      preview_cmd: `RUN SIMULATOR`,
      meta: {
        milestone_id: mId,
        boots: ms.boots,
        errors: Array.isArray(ms.errors) ? ms.errors : [],
        built_at: ms.built_at || null
      }
    });
  }
  return items;
}

// Cache of per-project gh release-list lookups so a sync that surfaces N
// release rows doesn't fire N gh subprocesses.
const _ghReleaseCache = new Map(); // projectId -> { ts, releases }

async function ghListReleases(projectId, repoUrl) {
  const cached = _ghReleaseCache.get(projectId);
  if (cached && Date.now() - cached.ts < 30_000) return cached.releases;

  const m = String(repoUrl || '').match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!m) return [];
  const slug = `${m[1]}/${m[2]}`;
  const { spawn } = require('child_process');
  const releases = await new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('gh', ['release', 'list', '--repo', slug, '--limit', '20',
                          '--json', 'tagName,name,publishedAt,isLatest'],
                         { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (_e) { return resolve([]); }
    let out = '';
    proc.stdout.on('data', (b) => { out += b; });
    proc.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch (_e) {} resolve([]); }, 5000);
    proc.on('error', () => { clearTimeout(timer); resolve([]); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve([]);
      try { resolve(JSON.parse(out)); } catch (_e) { resolve([]); }
    });
  });
  _ghReleaseCache.set(projectId, { ts: Date.now(), releases });
  return releases;
}

const RELEASE_TAG_RE = /^[a-zA-Z0-9._+-]{1,64}$/;

async function collectReleaseItems(projectId, localPath, repoUrl) {
  const items = [];
  const releaseRoot = path.join(localPath, 'release');
  if (!fs.existsSync(releaseRoot)) return items;

  let tagDirs = [];
  try {
    tagDirs = fs.readdirSync(releaseRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && RELEASE_TAG_RE.test(d.name))
      .map((d) => d.name);
  } catch (_e) { return items; }
  if (tagDirs.length === 0) return items;

  const ghReleases = await ghListReleases(projectId, repoUrl);
  const ghByTag = new Map(ghReleases.map((r) => [r.tagName, r]));

  // Sort newest-first so the row order matches the dashboard's release dropdown.
  const ranked = tagDirs.map((name) => {
    let mtime = 0;
    try { mtime = fs.statSync(path.join(releaseRoot, name)).mtimeMs; } catch (_e) {}
    return { name, mtime };
  }).sort((a, b) => b.mtime - a.mtime);

  for (const { name: tag } of ranked) {
    const dir = path.join(releaseRoot, tag);
    let pdxName = null;
    let pdxBytes = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.toLowerCase().endsWith('.pdx.zip')) {
          const st = fs.statSync(path.join(dir, f));
          if (st.size > pdxBytes) { pdxName = f; pdxBytes = st.size; }
        }
      }
    } catch (_e) {}
    // Skip empty stubs (< 1 KiB) — leftover from failed pack attempts that
    // wrote a zero-byte zip before bailing.
    if (!pdxName || pdxBytes < 1024) continue;

    const ghRel = ghByTag.get(tag);
    const published = !!ghRel;
    // Locked = already pushed to GitHub. Draft = packed locally, not yet pushed.
    const status = published ? 'locked' : 'draft';

    items.push({
      id: `release:${tag}`,
      phase: 4,
      type: 'release',
      status,
      files: [path.join(dir, pdxName)],
      approve_cmd: published
        ? `OPEN https://github.com/${(repoUrl || '').replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')}/releases/tag/${tag}`
        : COMMAND_GRAMMAR.release(),
      revise_cmd: `REVISE RELEASE ${tag}: <your notes>`,
      review_questions: questionsFor('release'),
      preview_cmd: `BUILD SAMPLE`,
      meta: {
        tag,
        pdx_name: pdxName,
        pdx_bytes: pdxBytes,
        published_to_github: published,
        published_at: ghRel ? ghRel.publishedAt : null,
        is_latest: ghRel ? !!ghRel.isLatest : false,
        github_url: published && repoUrl
          ? `https://github.com/${(repoUrl).replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')}/releases/tag/${tag}`
          : null
      }
    });
  }
  return items;
}

async function collectBatchItems(localPath) {
  const items = [];
  const batchesDir = path.join(localPath, SDK_DATA_REL, 'batches');
  if (!fs.existsSync(batchesDir)) return items;

  let batchFiles = [];
  try {
    batchFiles = fs.readdirSync(batchesDir).filter((f) => f.endsWith('.json'));
  } catch (_e) { return items; }

  for (const bf of batchFiles) {
    const bPath = path.join(batchesDir, bf);
    let batch;
    try { batch = JSON.parse(fs.readFileSync(bPath, 'utf8')); } catch (_e) { continue; }
    if (batch.status !== 'awaiting_review') continue;

    items.push({
      id: `batch:${batch.id || bf.replace('.json', '')}`,
      phase: 2,
      type: 'batch',
      status: 'draft',
      files: [bPath],
      approve_cmd: COMMAND_GRAMMAR.gate_approve(2),
      revise_cmd:  COMMAND_GRAMMAR.gate_revise(2),
      review_questions: questionsFor('batch'),
      preview_cmd: `SHOW SAMPLE`,
      meta: { batch_id: batch.id || bf, batch_status: batch.status }
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function itemStatusPill(status) {
  const pills = { draft: '[ ]', approved: '[x]', revise: '[!]', locked: '[=]' };
  return pills[status] || '[ ]';
}

function renderBoardMd(items, syncedAt) {
  const grouped = {};
  for (const item of items) {
    const ph = item.phase;
    if (!grouped[ph]) grouped[ph] = [];
    grouped[ph].push(item);
  }

  const lines = [];
  lines.push('# Review Board');
  lines.push('');
  lines.push(`_Last synced: ${syncedAt}_`);
  lines.push('');
  lines.push('## How to use');
  lines.push('');
  lines.push('Each item below includes a **copy command** — paste it into the chat or terminal');
  lines.push('to take action. Commands are not parsed automatically yet; they are copy targets.');
  lines.push('');
  lines.push('| Symbol | Meaning |');
  lines.push('|--------|---------|');
  lines.push('| `[ ]`  | Draft / pending review |');
  lines.push('| `[x]`  | Approved |');
  lines.push('| `[!]`  | Needs revision |');
  lines.push('| `[=]`  | Locked (signed off) |');
  lines.push('');
  lines.push('**Command grammar:**');
  lines.push('```');
  lines.push('APPROVE PHASE <n>');
  lines.push('REVISE PHASE <n>: <changes>');
  lines.push('SHOW SAMPLE');
  lines.push('BUILD SAMPLE');
  lines.push('RUN SIMULATOR');
  lines.push('LOCK DESIGN');
  lines.push('KICK OFF FULL BUILD');
  lines.push('APPROVE CONCEPT <id>');
  lines.push('REVISE CONCEPT <id>: <changes>');
  lines.push('APPROVE RELEASE');
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');

  const phases = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  for (const ph of phases) {
    lines.push(`## ${phaseLabel(ph)}`);
    lines.push('');
    for (const item of grouped[ph]) {
      lines.push(`### ${itemStatusPill(item.status)} ${item.id}`);
      lines.push('');
      lines.push(`- **Type:** ${item.type}`);
      lines.push(`- **Status:** ${item.status}`);
      if (item.meta && item.meta.name) lines.push(`- **Name:** ${item.meta.name}`);
      if (item.meta && item.meta.description) lines.push(`- **Description:** ${item.meta.description}`);
      if (item.meta && item.meta.title) lines.push(`- **Title:** ${item.meta.title}`);
      if (item.meta && typeof item.meta.required_total === 'number') {
        lines.push(`- **Required decisions:** ${item.meta.required_resolved}/${item.meta.required_total} resolved`);
      }
      if (item.meta && Array.isArray(item.meta.errors) && item.meta.errors.length > 0) {
        lines.push(`- **Errors:** ${item.meta.errors.slice(0, 3).join('; ')}`);
      }
      lines.push('');
      if (item.files && item.files.length > 0) {
        lines.push('**Files:**');
        for (const f of item.files) lines.push(`- \`${f}\``);
        lines.push('');
      }
      lines.push('**Review questions:**');
      for (const q of item.review_questions) lines.push(`- ${q}`);
      lines.push('');
      lines.push('**Commands:**');
      lines.push(`\`\`\`\n${item.approve_cmd}\n\`\`\``);
      lines.push(`\`\`\`\n${item.revise_cmd}\n\`\`\``);
      if (item.preview_cmd) lines.push(`\`\`\`\n${item.preview_cmd}\n\`\`\``);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  if (items.length === 0) {
    lines.push('_No items currently need review. Run the autopilot to generate content._');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * sync(projectId, sdkRoot) — collect all pending items, write review_board.md
 * and review_board.json. Returns the board JSON.
 */
async function sync(projectId, sdkRoot) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const dataDir = sdkDataDir(sdkRoot);
  await fsp.mkdir(dataDir, { recursive: true });

  // Collect items from all sources
  const [conceptItems, gateItems, milestoneItems, batchItems, releaseItems] = await Promise.all([
    collectConceptItems(localPath),
    collectGateItems(projectId, localPath),
    collectMilestoneItems(localPath),
    collectBatchItems(localPath),
    collectReleaseItems(projectId, localPath, proj.repo),
  ]);

  // Merge, deduplicate by id
  const seen = new Set();
  const items = [];
  for (const item of [...conceptItems, ...gateItems, ...milestoneItems, ...batchItems, ...releaseItems]) {
    if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
  }

  // Sort: phase asc, then status (draft first, then revise, then approved, locked last)
  const statusOrder = { draft: 0, revise: 1, approved: 2, locked: 3 };
  items.sort((a, b) => {
    const pd = a.phase - b.phase;
    if (pd !== 0) return pd;
    return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
  });

  const syncedAt = new Date().toISOString();
  const board = { project_id: projectId, synced_at: syncedAt, items };

  await fsp.writeFile(boardJsonPath(sdkRoot), JSON.stringify(board, null, 2));
  await fsp.writeFile(boardMdPath(sdkRoot), renderBoardMd(items, syncedAt));

  return board;
}

/**
 * recordDecision(projectId, sdkRoot, decision) — append to decisions.md and
 * decisions.jsonl. Decision shape:
 *   { id, made_at, by, phase, category, decision_text, rationale, references }
 */
async function recordDecision(projectId, sdkRoot, decision) {
  const dataDir = sdkDataDir(sdkRoot);
  await fsp.mkdir(dataDir, { recursive: true });

  const entry = {
    id:            decision.id || `dec-${Date.now()}`,
    made_at:       decision.made_at || new Date().toISOString(),
    by:            decision.by || 'user',
    phase:         typeof decision.phase === 'number' ? decision.phase : 0,
    category:      decision.category || 'other',
    decision_text: String(decision.decision_text || '').slice(0, 2000),
    rationale:     String(decision.rationale || '').slice(0, 4000),
    references:    Array.isArray(decision.references) ? decision.references.slice(0, 32) : [],
  };

  // Append to decisions.jsonl
  const jsonlLine = JSON.stringify(entry) + '\n';
  await fsp.appendFile(decisionsJsonlPath(sdkRoot), jsonlLine, { mode: 0o600 });

  // Append to decisions.md
  const dateStr = entry.made_at.slice(0, 16).replace('T', ' ');
  const refs = entry.references.length > 0
    ? entry.references.map((r) => `\`${r}\``).join(', ')
    : '_none_';
  const mdBlock = [
    `## ${dateStr} — ${entry.category}`,
    `**Decision:** ${entry.decision_text}  `,
    `**Rationale:** ${entry.rationale}  `,
    `**References:** ${refs}`,
    '',
  ].join('\n') + '\n';

  // Ensure header exists
  const mdPath = decisionsMdPath(sdkRoot);
  if (!fs.existsSync(mdPath)) {
    await fsp.writeFile(mdPath, '# Decisions Log\n\n_Append-only. Each entry records a human approval decision._\n\n');
  }
  await fsp.appendFile(mdPath, mdBlock, { mode: 0o600 });

  return entry;
}

/**
 * list(projectId, sdkRoot) — return the parsed board JSON.
 */
async function list(projectId, sdkRoot) {
  const p = boardJsonPath(sdkRoot);
  if (!fs.existsSync(p)) return { project_id: projectId, synced_at: null, items: [] };
  return JSON.parse(await fsp.readFile(p, 'utf8'));
}

/**
 * pendingCount(projectId, sdkRoot) — count items not yet approved or locked.
 */
async function pendingCount(projectId, sdkRoot) {
  const board = await list(projectId, sdkRoot);
  const items = Array.isArray(board.items) ? board.items : [];
  return items.filter((i) => i.status !== 'approved' && i.status !== 'locked').length;
}

/**
 * markItemStatus(projectId, sdkRoot, itemId, status, changes) — update a
 * single item's status in the board JSON and re-render the md.
 */
async function markItemStatus(projectId, sdkRoot, itemId, status, changes) {
  const board = await list(projectId, sdkRoot);
  const item = (board.items || []).find((i) => i.id === itemId);
  if (!item) {
    const e = new Error('item_not_found'); e.status = 404; throw e;
  }
  item.status = status;
  if (changes) item.changes_notes = String(changes).slice(0, 2000);

  const syncedAt = new Date().toISOString();
  board.synced_at = syncedAt;

  const dataDir = sdkDataDir(sdkRoot);
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(boardJsonPath(sdkRoot), JSON.stringify(board, null, 2));
  await fsp.writeFile(boardMdPath(sdkRoot), renderBoardMd(board.items, syncedAt));
  return board;
}

/**
 * listDecisions(projectId, sdkRoot) — parse decisions.jsonl into an array.
 */
async function listDecisions(projectId, sdkRoot) {
  const p = decisionsJsonlPath(sdkRoot);
  if (!fs.existsSync(p)) return [];
  const raw = await fsp.readFile(p, 'utf8');
  const items = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { items.push(JSON.parse(line)); } catch (_e) { /* skip corrupt */ }
  }
  return items;
}

module.exports = { sync, recordDecision, list, pendingCount, markItemStatus, listDecisions };
