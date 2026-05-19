'use strict';

// Phase 6 A5 — Interactive Requirements Interview.
//
// Reads coverage_report.json (A4) + extracted.json (A2) and emits a question
// queue keyed off the gaps the coverage report identified. The user answers
// from the UI; each answer mutates the requirements doc + appends to the
// decision log (C2). When all critical gaps are answered the interview can
// be "locked", which freezes the question queue and emits a scope_lock.json
// candidate that A6 consumes.
//
// State files (all under <project>/sdk_data/requirements/):
//   - question_queue.json     ordered + mutable list of question objects
//   - interview_state.json    { started_at, locked_at, answers: { qid: {...} } }
//
// Question schema (per spec A5):
//   { id, category, question_text, default_options, related_scenes,
//     severity ("low"|"medium"|"high"|"critical"), source, requirement_id }

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projects = require('./projects');

let decisionLog;
try { decisionLog = require('./decision_log'); }
catch (_e) { decisionLog = null; }

function reqDir(localPath) { return path.join(localPath, 'sdk_data', 'requirements'); }
function queuePath(localPath) { return path.join(reqDir(localPath), 'question_queue.json'); }
function statePath(localPath) { return path.join(reqDir(localPath), 'interview_state.json'); }
function derivedPath(localPath) { return path.join(reqDir(localPath), 'derived.json'); }
function coveragePath(localPath) { return path.join(reqDir(localPath), 'coverage_report.json'); }
function extractedPath(localPath) { return path.join(reqDir(localPath), 'extracted.json'); }
function scopeCandidatePath(localPath) { return path.join(reqDir(localPath), 'scope_lock_candidate.json'); }

const ACTIONS = new Set(['answer', 'skip', 'autopilot', 'think', 'defer']);
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const CATEGORIES = {
  MINIGAME: 'minigames_mechanics',
  ASSET: 'additional_assets',
  CONTEXT: 'context_research',
  URLS: 'urls_external',
  NOTES: 'notes_anecdotes',
  APP_FOUND: 'app_found_gaps'
};

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

function shortHash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
}

// ----------------------------------------------------------------------------
// Question builders — one per category. Each takes the coverage report +
// extracted source and returns a Question[] for the queue.
// ----------------------------------------------------------------------------

function buildMinigameQuestions(coverage, extracted) {
  const out = [];
  const mg = coverage.minigames || { needs_custom_recipe: [], deferred_by_default: [] };
  // Deferred-by-default: ask user to confirm scope-out / scope-in.
  for (const name of mg.deferred_by_default || []) {
    out.push({
      id: `q-minigame-defer-${shortHash(name)}`,
      category: CATEGORIES.MINIGAME,
      question_text: `Minigame "${name}" is deferred by default (no bible spec, no platform recipe). Scope into v0.x?`,
      default_options: ['defer to v0.2', 'in v0.x — provide spec', 'in v0.x — autopilot picks mechanic'],
      related_scenes: [],
      severity: 'medium',
      source: 'coverage.minigames.deferred_by_default',
      requirement_id: null
    });
  }
  for (const name of mg.needs_custom_recipe || []) {
    out.push({
      id: `q-minigame-recipe-${shortHash(name)}`,
      category: CATEGORIES.MINIGAME,
      question_text: `Minigame "${name}" has a bible spec but no platform recipe. Input mechanic? Win/loss state? Difficulty curve?`,
      default_options: ['crank-driven', 'd-pad timing', 'A-button rhythm', 'autopilot decides'],
      related_scenes: [],
      severity: 'high',
      source: 'coverage.minigames.needs_custom_recipe',
      requirement_id: null
    });
  }
  // Multi-instance puzzles (heuristic — minigames whose name suggests N instances)
  for (const m of (extracted.minigames || [])) {
    const n = m && m.name;
    if (!n) continue;
    if (/\b(\d{2,})\b/.test(n) || /coins?/i.test(n)) {
      out.push({
        id: `q-minigame-multi-${shortHash(n)}`,
        category: CATEGORIES.MINIGAME,
        question_text: `"${n}": N distinct puzzles or N instances of one mechanic? Per-puzzle solve logic or gallery-only?`,
        default_options: ['N distinct', 'N instances of one', 'gallery only (no logic)'],
        related_scenes: [],
        severity: 'medium',
        source: 'extracted.minigames.multi_instance_heuristic',
        requirement_id: null
      });
    }
  }
  return out;
}

function buildAssetQuestions(coverage) {
  const out = [];
  // Unanchored scenes
  const scenes = coverage.scenes || { uncovered: [], needs_canon: [], derivable: [] };
  for (const sid of (scenes.uncovered || [])) {
    out.push({
      id: `q-scene-uncov-${shortHash(sid)}`,
      category: CATEGORIES.ASSET,
      question_text: `${sid} has no canon + no reference anchor. Options?`,
      default_options: [
        '(a) write new canon entry now',
        '(b) derive from GLOBAL_STYLE + bible only (anchor-less)',
        '(c) defer to v0.2'
      ],
      related_scenes: [sid],
      severity: 'critical',
      source: 'coverage.scenes.uncovered',
      requirement_id: null
    });
  }
  for (const sid of (scenes.needs_canon || [])) {
    out.push({
      id: `q-scene-needscanon-${shortHash(sid)}`,
      category: CATEGORIES.ASSET,
      question_text: `${sid} has an adjacent-scene anchor available but no canon. Reuse the adjacent visual state or distinct?`,
      default_options: ['reuse adjacent', 'distinct — write canon now', 'autopilot decides'],
      related_scenes: [sid],
      severity: 'high',
      source: 'coverage.scenes.needs_canon',
      requirement_id: null
    });
  }
  // Missing portraits (bible-named chars w/ no ref)
  const refs = coverage.references || { named_but_unreferenced: [] };
  for (const item of (refs.named_but_unreferenced || [])) {
    if (item.kind !== 'character') continue;
    out.push({
      id: `q-portrait-${shortHash(item.name)}`,
      category: CATEGORIES.ASSET,
      question_text: `Character "${item.name}" has no reference portrait. Provide a ref or describe-and-derive?`,
      default_options: ['upload ref now', 'describe-and-derive', 'voice-only (no portrait)'],
      related_scenes: [],
      severity: 'high',
      source: 'coverage.references.named_but_unreferenced',
      requirement_id: null
    });
  }
  return out;
}

function buildAppFoundQuestions(coverage, extracted) {
  const out = [];
  // Scenes mentioned in extraction with empty summary (bible-mentioned-but-undescribed)
  for (const sc of (extracted.scenes || [])) {
    if (!sc || !sc.id) continue;
    const sum = (sc.summary || '').trim();
    if (sum.length < 10) {
      out.push({
        id: `q-scene-emptysummary-${shortHash(sc.id)}`,
        category: CATEGORIES.APP_FOUND,
        question_text: `${sc.id} (${sc.title || 'untitled'}) has no description in the bible. What happens?`,
        default_options: ['autopilot fills from canon §3 preamble', 'I will dictate it now (voice)', 'defer'],
        related_scenes: [sc.id],
        severity: 'medium',
        source: 'extracted.scenes.empty_summary',
        requirement_id: null
      });
    }
  }
  // Characters w/ no dialog samples
  for (const ch of (extracted.characters || [])) {
    if (!ch || !ch.name) continue;
    const samples = Array.isArray(ch.dialog_samples) ? ch.dialog_samples : [];
    if (samples.length === 0) {
      out.push({
        id: `q-char-novoice-${shortHash(ch.name)}`,
        category: CATEGORIES.APP_FOUND,
        question_text: `Character "${ch.name}" has no dialog samples in the bible. Derive voice from traits or provide samples?`,
        default_options: ['derive from traits', 'I will dictate samples', 'voice-less (no dialog)'],
        related_scenes: [],
        severity: 'low',
        source: 'extracted.characters.no_dialog_samples',
        requirement_id: null
      });
    }
  }
  return out;
}

function buildContextQuestions(extracted) {
  const out = [];
  // Era / setting confirmation
  const era = extracted.setting_era || extracted.era;
  if (era) {
    out.push({
      id: 'q-context-era-cascade',
      category: CATEGORIES.CONTEXT,
      question_text: `Era is "${era}". Confirm cascading defaults: modem speed, browser refs, AOL version?`,
      default_options: ['use canonical era defaults', 'I will pin specifics', 'autopilot decides'],
      related_scenes: [],
      severity: 'low',
      source: 'extracted.setting_era',
      requirement_id: null
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Public — buildQuestionQueue
// ----------------------------------------------------------------------------

async function buildQuestionQueue(projectId, opts = {}) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;

  const coverage = await readJsonOr(coveragePath(localPath), null);
  if (!coverage) {
    const e = new Error('coverage_report.json missing — run A4 coverage first');
    e.status = 412; e.code = 'no_coverage'; throw e;
  }
  const extracted = await readJsonOr(extractedPath(localPath), { scenes: [], characters: [], minigames: [] });

  const questions = [
    ...buildMinigameQuestions(coverage, extracted),
    ...buildAssetQuestions(coverage),
    ...buildAppFoundQuestions(coverage, extracted),
    ...buildContextQuestions(extracted)
  ];

  // Stable sort by severity (critical > high > medium > low) then by id.
  const sevWeight = { critical: 0, high: 1, medium: 2, low: 3 };
  questions.sort((a, b) => {
    const sa = sevWeight[a.severity] ?? 4;
    const sb = sevWeight[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });

  // Preserve existing answers if re-build is run mid-interview.
  const existingState = await readJsonOr(statePath(localPath), null);
  const answeredIds = new Set(existingState ? Object.keys(existingState.answers || {}) : []);

  const queue = {
    version: 1,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    total_questions: questions.length,
    answered_count: 0,
    pending_count: 0,
    questions: questions.map((q) => ({
      ...q,
      status: answeredIds.has(q.id) ? 'answered' : 'pending'
    }))
  };
  queue.answered_count = queue.questions.filter((q) => q.status === 'answered').length;
  queue.pending_count = queue.questions.length - queue.answered_count;

  await writeJson(queuePath(localPath), queue);

  if (!existingState) {
    await writeJson(statePath(localPath), {
      started_at: new Date().toISOString(),
      locked_at: null,
      answers: {}
    });
  }

  if (typeof opts.onEvent === 'function') opts.onEvent('done', { total: queue.total_questions });
  return queue;
}

async function getQueue(projectId) {
  const proj = await resolveProject(projectId);
  return await readJsonOr(queuePath(proj.local_path), null);
}

async function getState(projectId) {
  const proj = await resolveProject(projectId);
  return await readJsonOr(statePath(proj.local_path), null);
}

// ----------------------------------------------------------------------------
// Answer mutation — appends decision log entry + flips question status + may
// mutate the derived doc (e.g., marking a requirement deferred).
// ----------------------------------------------------------------------------

async function answerQuestion(projectId, questionId, action, value, meta = {}) {
  if (!ACTIONS.has(action)) {
    const e = new Error(`bad action: ${action}`); e.status = 400; e.code = 'bad_action'; throw e;
  }
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const queue = await readJsonOr(queuePath(localPath), null);
  if (!queue) {
    const e = new Error('question queue not built — POST /interview/queue first');
    e.status = 412; e.code = 'no_queue'; throw e;
  }
  const state = (await readJsonOr(statePath(localPath), null)) || {
    started_at: new Date().toISOString(), locked_at: null, answers: {}
  };
  if (state.locked_at) {
    const e = new Error('interview is locked'); e.status = 409; e.code = 'interview_locked'; throw e;
  }
  const q = queue.questions.find((x) => x.id === questionId);
  if (!q) {
    const e = new Error('question not found'); e.status = 404; e.code = 'not_found'; throw e;
  }

  // Compute a stable choice string for the decision log.
  let choice;
  if (action === 'answer') choice = (typeof value === 'string' && value.trim()) || JSON.stringify(value);
  else if (action === 'skip') choice = '(skipped)';
  else if (action === 'autopilot') choice = '(autopilot decides)';
  else if (action === 'think') choice = '(I need to think)';
  else if (action === 'defer') choice = '(deferred to v0.2)';

  const entry = {
    ts: new Date().toISOString(),
    question_id: questionId,
    action,
    value: value == null ? null : value,
    user_note: typeof meta.note === 'string' ? meta.note.slice(0, 1000) : '',
    high_stakes: !!meta.high_stakes
  };
  state.answers[questionId] = entry;
  q.status = action === 'answer' ? 'answered'
    : action === 'defer' ? 'deferred'
    : action === 'autopilot' ? 'autopilot'
    : action === 'skip' ? 'skipped'
    : 'thinking';

  await writeJson(statePath(localPath), state);
  // Recount.
  queue.answered_count = queue.questions.filter((x) => x.status === 'answered').length;
  queue.pending_count = queue.questions.filter((x) => x.status === 'pending').length;
  await writeJson(queuePath(localPath), queue);

  // Best-effort decision log (won't fail the answer flow if the log isn't wired).
  if (decisionLog && typeof decisionLog.logDecision === 'function') {
    try {
      await decisionLog.logDecision(projectId, {
        decided_by: action === 'autopilot' ? 'orchestrator' : 'user',
        category: 'scope',
        question: q.question_text,
        options: q.default_options,
        choice,
        rationale: entry.user_note || `interview action=${action}`,
        source_refs: [q.source],
        graph_node_id: null,
        escalated_from: null
      });
    } catch (_e) { /* swallow — decision log is best-effort */ }
  }

  return { question: q, state_entry: entry, queue_progress: {
    answered_count: queue.answered_count,
    pending_count: queue.pending_count,
    total_questions: queue.total_questions
  }};
}

// ----------------------------------------------------------------------------
// Lock the interview — produces a scope-lock candidate that A6 consumes.
// ----------------------------------------------------------------------------

async function lockInterview(projectId) {
  const proj = await resolveProject(projectId);
  const localPath = proj.local_path;
  const queue = await readJsonOr(queuePath(localPath), null);
  const state = await readJsonOr(statePath(localPath), null);
  const derived = await readJsonOr(derivedPath(localPath), null);
  if (!queue || !state) {
    const e = new Error('interview not initialized'); e.status = 412; e.code = 'no_interview'; throw e;
  }
  if (state.locked_at) {
    const e = new Error('interview already locked'); e.status = 409; e.code = 'already_locked'; throw e;
  }
  // Critical-severity questions must be answered or explicitly deferred.
  const criticalUnclosed = queue.questions.filter(
    (q) => q.severity === 'critical' && !state.answers[q.id]
  );
  if (criticalUnclosed.length > 0) {
    const e = new Error(`critical gaps unresolved: ${criticalUnclosed.length}`);
    e.status = 412; e.code = 'critical_unclosed';
    e.detail = criticalUnclosed.map((q) => q.id);
    throw e;
  }

  // Build a scope-lock CANDIDATE — A6 takes this and lets the user adjust
  // include/defer assignments before freezing. Defer policy: anything where
  // the user picked "(deferred to v0.2)" goes to deferred; everything else
  // that maps to a requirement gets included by default.
  const deferred = [];
  const included = [];
  const reqIds = derived ? derived.requirements.map((r) => r.id) : [];

  // Map question-level defer/skip onto requirements by scene_id heuristic.
  const deferredScenes = new Set();
  for (const q of queue.questions) {
    const ans = state.answers[q.id];
    if (!ans) continue;
    if (ans.action === 'defer') {
      for (const sid of (q.related_scenes || [])) deferredScenes.add(sid);
    }
  }
  for (const rid of reqIds) {
    const sceneTouched = Array.from(deferredScenes).some((sid) =>
      rid.includes(sid));
    (sceneTouched ? deferred : included).push(rid);
  }

  const candidate = {
    version: 1,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    based_on_queue_generated_at: queue.generated_at,
    answered_count: queue.answered_count,
    deferred_count: queue.questions.filter((q) => state.answers[q.id]?.action === 'defer').length,
    skipped_count: queue.questions.filter((q) => state.answers[q.id]?.action === 'skip').length,
    autopilot_count: queue.questions.filter((q) => state.answers[q.id]?.action === 'autopilot').length,
    proposed_in_scope: included,
    proposed_deferred: deferred,
    notes: 'A5 lock candidate — A6 freezes scope after user adjusts.'
  };
  await writeJson(scopeCandidatePath(localPath), candidate);

  // Flip the interview state to locked.
  state.locked_at = new Date().toISOString();
  await writeJson(statePath(localPath), state);

  if (decisionLog && typeof decisionLog.logDecision === 'function') {
    try {
      await decisionLog.logDecision(projectId, {
        decided_by: 'user',
        category: 'scope',
        question: 'Lock interview and produce scope candidate?',
        options: ['lock', 'keep open'],
        choice: 'lock',
        rationale: `${candidate.answered_count} answered, ${candidate.deferred_count} deferred, ${candidate.skipped_count} skipped`,
        source_refs: ['phase6-A5'],
        graph_node_id: null,
        escalated_from: null
      });
    } catch (_e) { /* ignore */ }
  }

  return candidate;
}

module.exports = {
  buildQuestionQueue,
  getQueue,
  getState,
  answerQuestion,
  lockInterview,
  CATEGORIES, ACTIONS: Array.from(ACTIONS), SEVERITIES,
  _paths: { queuePath, statePath, scopeCandidatePath },
  _internals: { buildMinigameQuestions, buildAssetQuestions, buildAppFoundQuestions, shortHash }
};
