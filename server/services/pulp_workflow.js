'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const projects = require('./projects');
const claude = require('./claude');
const { validateId } = require('./validation');

const SCHEMA_PATH = path.join(
  __dirname, '..', 'data', 'schema', 'pulp_workflow_state.schema.json'
);
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false, removeAdditional: false });
const validateSchema = ajv.compile(SCHEMA);

const PULP_DIR_NAME = 'pulp_data';
const WORKFLOW_JSON = 'workflow.json';

const INPUT_MAX = 8000;
const AI_LOG_CAP = 1024;          // chars per ai_log content entry
const AI_LOG_MAX_ENTRIES = 200;   // ring-buffer cap per stage

// ---------- Canonical stage set ----------

const STAGE_DEFS = [
  { id: 'brainstorm', requires: [] },
  { id: 'story',      requires: ['brainstorm'] },
  { id: 'characters', requires: ['story'] },
  { id: 'world',      requires: ['story'] },
  { id: 'mechanics',  requires: ['brainstorm'] },
  { id: 'vibe',       requires: ['brainstorm'] },
  { id: 'menus',      requires: ['vibe', 'mechanics'] },
  { id: 'assets',     requires: ['characters', 'world', 'vibe'] },
  { id: 'scripts',    requires: ['mechanics', 'world', 'characters'] },
  { id: 'playtest',   requires: ['scripts', 'assets'] }
];

const STAGE_ID_SET = new Set(STAGE_DEFS.map((s) => s.id));
const DEFAULT_STAGE_ORDER = STAGE_DEFS.map((s) => s.id);

// Per-stage output shapes. The system prompt embeds the JSON keys verbatim
// so Claude is steered to produce them. Validation post-parse is shallow:
// we accept any object whose keys are a subset of the expected key set,
// but require at least one expected key to be present (otherwise the model
// almost certainly hallucinated the wrong stage).
const STAGE_OUTPUT_SHAPE = {
  brainstorm: {
    schema: '{ "pitch": string, "genre": string, "hooks": string[], "target_audience": string }',
    requiredAny: ['pitch', 'genre', 'hooks', 'target_audience']
  },
  story: {
    schema: '{ "premise": string, "acts": [{ "name": string, "beats": string[] }], "themes": string[] }',
    requiredAny: ['premise', 'acts', 'themes']
  },
  characters: {
    schema: '{ "cast": [{ "id": string, "name": string, "role": string, "bio": string, "portrait_prompt": string }] }',
    requiredAny: ['cast']
  },
  world: {
    schema: '{ "locations": [{ "id": string, "name": string, "description": string, "room_id": string | null }] }',
    requiredAny: ['locations']
  },
  mechanics: {
    schema: '{ "game_type": string, "verbs": string[], "primary_loop": string, "win_condition": string }',
    requiredAny: ['game_type', 'verbs', 'primary_loop', 'win_condition']
  },
  vibe: {
    schema: '{ "aesthetic_lock": string, "palette_notes": string, "soundscape_notes": string, "style_refs": string[] }',
    requiredAny: ['aesthetic_lock', 'palette_notes', 'soundscape_notes', 'style_refs']
  },
  menus: {
    schema: '{ "title": { "layout": string, "prompt": string }, "main_menu": { "items": string[] } }',
    requiredAny: ['title', 'main_menu']
  },
  assets: {
    schema: '{ "tile_ids_planned": string[], "scene_room_ids": string[], "sound_ids": string[], "generation_log": string[] }',
    requiredAny: ['tile_ids_planned', 'scene_room_ids', 'sound_ids', 'generation_log']
  },
  scripts: {
    schema: '{ "game_script": string, "per_tile": [{ "tile_id": string, "script": string }], "per_room": [{ "room_id": string, "script": string }] }',
    requiredAny: ['game_script', 'per_tile', 'per_room']
  },
  playtest: {
    schema: '{ "issues": [{ "id": string, "severity": string, "description": string }], "notes": string }',
    requiredAny: ['issues', 'notes']
  }
};

// ---------- Errors ----------

function wfErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

// ---------- Lock (mirrors pulp_project.js) ----------

const chains = new Map();
function withLock(projectId, fn) {
  const prev = chains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(projectId, next.catch(() => {}));
  return next;
}

// ---------- Helpers ----------

function defaultStage(def) {
  return {
    id: def.id,
    status: 'empty',
    input: '',
    output: null,
    requires: def.requires.slice(),
    last_updated_ts: 0,
    ai_log: []
  };
}

function defaultWorkflow() {
  const stages = {};
  for (const def of STAGE_DEFS) stages[def.id] = defaultStage(def);
  return { stage_order: DEFAULT_STAGE_ORDER.slice(), stages };
}

function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return clean.slice(0, INPUT_MAX);
}

function summarizeLogContent(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (clean.length <= AI_LOG_CAP) return clean;
  return clean.slice(0, AI_LOG_CAP) + `…[+${clean.length - AI_LOG_CAP} chars elided]`;
}

async function realPathSafe(p) {
  try { return await fsp.realpath(p); }
  catch (_e) { return null; }
}

async function resolveWorkflowPaths(project) {
  if (!project) throw wfErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw wfErr(400, 'not_pulp_project');
  const baseReal = await realPathSafe(project.local_path);
  if (!baseReal) throw wfErr(400, 'local_path_missing');
  let baseStat;
  try { baseStat = await fsp.lstat(baseReal); }
  catch (_e) { throw wfErr(400, 'local_path_missing'); }
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw wfErr(400, 'local_path_invalid');
  }
  const dir = path.join(baseReal, PULP_DIR_NAME);
  const file = path.join(dir, WORKFLOW_JSON);
  return { baseReal, dir, file };
}

async function ensureDir(dir) {
  try {
    const s = await fsp.lstat(dir);
    if (s.isSymbolicLink()) throw wfErr(400, 'pulp_dir_symlink');
    if (!s.isDirectory()) throw wfErr(500, 'pulp_dir_not_dir');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      return;
    }
    if (e && e.status) throw e;
    throw e;
  }
}

async function atomicWriteJson(file, data) {
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

function runSchema(data) {
  const ok = validateSchema(data);
  if (!ok) {
    const detail = (validateSchema.errors || []).slice(0, 20).map((e) => ({
      path: e.instancePath || '/',
      keyword: e.keyword,
      message: e.message
    }));
    throw wfErr(422, 'schema_invalid', detail);
  }
}

// Merge a possibly-partial workflow read from disk with the canonical
// default — adding missing stages and back-filling missing fields.
function mergeWithDefaults(raw) {
  const base = defaultWorkflow();
  if (!raw || typeof raw !== 'object') return base;

  const stageOrder = Array.isArray(raw.stage_order) && raw.stage_order.length > 0
    ? raw.stage_order.filter((id) => typeof id === 'string')
    : base.stage_order;

  const stages = {};
  const knownDefs = new Map(STAGE_DEFS.map((d) => [d.id, d]));

  // Start from canonical defaults so every canonical stage exists.
  for (const def of STAGE_DEFS) {
    stages[def.id] = defaultStage(def);
  }

  // Overlay anything on-disk.
  if (raw.stages && typeof raw.stages === 'object') {
    for (const [id, stage] of Object.entries(raw.stages)) {
      if (!stage || typeof stage !== 'object') continue;
      const def = knownDefs.get(id);
      const requires = Array.isArray(stage.requires) ? stage.requires.slice()
        : def ? def.requires.slice() : [];
      stages[id] = {
        id,
        status: ['empty', 'in_progress', 'complete'].includes(stage.status) ? stage.status : 'empty',
        input: typeof stage.input === 'string' ? stage.input.slice(0, INPUT_MAX) : '',
        output: (stage.output && typeof stage.output === 'object') ? stage.output : null,
        requires,
        last_updated_ts: Number.isInteger(stage.last_updated_ts) ? stage.last_updated_ts : 0,
        ai_log: Array.isArray(stage.ai_log)
          ? stage.ai_log
              .filter((e) => e && typeof e === 'object' && typeof e.content === 'string')
              .slice(-AI_LOG_MAX_ENTRIES)
              .map((e) => ({
                ts: Number.isInteger(e.ts) ? e.ts : Date.now(),
                role: ['user', 'assistant', 'system'].includes(e.role) ? e.role : 'assistant',
                content: summarizeLogContent(e.content)
              }))
          : []
      };
    }
  }

  return { stage_order: stageOrder, stages };
}

async function readWorkflowFile(file) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_e) { throw wfErr(500, 'workflow_corrupt'); }
    return mergeWithDefaults(parsed);
  } catch (e) {
    if (e && e.code === 'ENOENT') return defaultWorkflow();
    if (e && e.status) throw e;
    throw e;
  }
}

async function loadProjectOrThrow(projectId) {
  const idErr = validateId(projectId);
  if (idErr) throw wfErr(400, 'bad_request', idErr);
  const project = await projects.getProject(projectId);
  if (!project) throw wfErr(404, 'not_found');
  if (project.game_type !== 'pulp') throw wfErr(400, 'not_pulp_project');
  return project;
}

// ---------- Unlock logic ----------

function isStageUnlocked(workflow, stageId) {
  const stage = workflow.stages[stageId];
  if (!stage) return false;
  for (const dep of stage.requires) {
    const depStage = workflow.stages[dep];
    if (!depStage || depStage.status !== 'complete') return false;
  }
  return true;
}

function pendingRequires(workflow, stageId) {
  const stage = workflow.stages[stageId];
  if (!stage) return [];
  const pending = [];
  for (const dep of stage.requires) {
    const depStage = workflow.stages[dep];
    if (!depStage || depStage.status !== 'complete') pending.push(dep);
  }
  return pending;
}

function summarizeWorkflow(workflow) {
  const total = workflow.stage_order.length;
  let complete = 0;
  let nextUnlocked = null;
  for (const id of workflow.stage_order) {
    const s = workflow.stages[id];
    if (!s) continue;
    if (s.status === 'complete') complete += 1;
    else if (nextUnlocked === null && isStageUnlocked(workflow, id)) {
      nextUnlocked = id;
    }
  }
  return { complete, total, next_unlocked: nextUnlocked };
}

// ---------- Public reads ----------

async function getWorkflow(projectId) {
  const project = await loadProjectOrThrow(projectId);
  const { file } = await resolveWorkflowPaths(project);
  return readWorkflowFile(file);
}

async function resetWorkflow(projectId) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolveWorkflowPaths(project);
    const cur = await readWorkflowFile(file);
    const order = cur.stage_order.slice();
    const fresh = defaultWorkflow();
    // Preserve the existing stage_order; rebuild stages from defaults but
    // include any custom (non-canonical) ids the user had added.
    const stages = {};
    for (const id of order) {
      const def = STAGE_DEFS.find((d) => d.id === id);
      if (def) {
        stages[id] = defaultStage(def);
      } else {
        // Custom stage: zero out but keep its requires from disk if present.
        const prev = cur.stages[id];
        stages[id] = {
          id,
          status: 'empty',
          input: '',
          output: null,
          requires: prev && Array.isArray(prev.requires) ? prev.requires.slice() : [],
          last_updated_ts: 0,
          ai_log: []
        };
      }
    }
    // Also make sure canonical stages in defaults but missing from order get added.
    for (const def of STAGE_DEFS) {
      if (!(def.id in stages)) stages[def.id] = defaultStage(def);
    }
    const next = { stage_order: order, stages };
    runSchema(next);
    await ensureDir(dir);
    await atomicWriteJson(file, next);
    return next;
  });
}

async function patchStage(projectId, stageId, patch) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolveWorkflowPaths(project);

    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw wfErr(400, 'bad_request');
    }

    const cur = await readWorkflowFile(file);
    if (!cur.stage_order.includes(stageId) && !STAGE_ID_SET.has(stageId)) {
      throw wfErr(404, 'stage_not_found');
    }
    if (!cur.stages[stageId]) throw wfErr(404, 'stage_not_found');

    if (!isStageUnlocked(cur, stageId)) {
      throw wfErr(409, 'stage_locked', { requires_pending: pendingRequires(cur, stageId) });
    }

    const stage = cur.stages[stageId];
    const next = { ...stage };

    if (patch.input !== undefined) {
      if (typeof patch.input !== 'string') throw wfErr(400, 'bad_input');
      next.input = sanitizeText(patch.input);
    }
    if (patch.status !== undefined) {
      if (!['empty', 'in_progress', 'complete'].includes(patch.status)) {
        throw wfErr(400, 'bad_status');
      }
      next.status = patch.status;
    }
    if (patch.output !== undefined) {
      if (patch.output !== null && (typeof patch.output !== 'object' || Array.isArray(patch.output))) {
        throw wfErr(400, 'bad_output');
      }
      next.output = patch.output;
    }
    next.last_updated_ts = Date.now();
    cur.stages[stageId] = next;

    runSchema(cur);
    await ensureDir(dir);
    await atomicWriteJson(file, cur);
    return { stage: cur.stages[stageId], workflow: cur };
  });
}

async function applyStageOutput(projectId, stageId, output) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolveWorkflowPaths(project);
    const cur = await readWorkflowFile(file);
    if (!cur.stages[stageId]) throw wfErr(404, 'stage_not_found');
    if (!isStageUnlocked(cur, stageId)) {
      throw wfErr(409, 'stage_locked', { requires_pending: pendingRequires(cur, stageId) });
    }
    if (output === null || typeof output !== 'object' || Array.isArray(output)) {
      throw wfErr(400, 'bad_output');
    }
    const stage = cur.stages[stageId];
    stage.output = output;
    stage.status = 'complete';
    stage.last_updated_ts = Date.now();
    runSchema(cur);
    await ensureDir(dir);
    await atomicWriteJson(file, cur);
    return cur.stages[stageId];
  });
}

// ---------- Prompt building ----------

function priorStageOutputs(workflow, currentId) {
  const out = {};
  for (const id of workflow.stage_order) {
    if (id === currentId) break;
    const s = workflow.stages[id];
    if (s && s.status === 'complete' && s.output) out[id] = s.output;
  }
  return out;
}

function projectStateSummary(project) {
  return {
    id: project.id,
    name: project.name,
    author: project.developer || project.publisher || '',
    description: project.description || ''
  };
}

function buildPrompt(stageId, project, workflow, userPrompt) {
  const shape = STAGE_OUTPUT_SHAPE[stageId];
  const stage = workflow.stages[stageId];
  const priors = priorStageOutputs(workflow, stageId);

  const system =
    `You are a game design assistant building a Playdate pulp-style game with the studio. ` +
    `You are working on the "${stageId}" stage. ` +
    `This stage's structured output MUST conform to this JSON shape: ${shape ? shape.schema : '{}'}. ` +
    `Respond ONLY with a single fenced \`\`\`json code block containing the output object, nothing else. ` +
    `No prose before or after the fence.`;

  const ctx = {
    project: projectStateSummary(project),
    prior_stage_outputs: priors,
    current_stage: {
      id: stageId,
      requires: stage.requires,
      prior_input: stage.input || ''
    }
  };

  const truncatedCtx = JSON.stringify(ctx).slice(0, 12000);

  const user =
    `## Project & prior stages\n\`\`\`json\n${truncatedCtx}\n\`\`\`\n\n` +
    `## User prompt for stage "${stageId}"\n${userPrompt}\n\n` +
    `Respond ONLY with the JSON code block for the "${stageId}" output as specified.`;

  return `SYSTEM:\n${system}\n\nUSER:\n${user}`;
}

// ---------- Parsing ----------

function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  candidates.push(text);

  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const slice = c.slice(start, i + 1);
          try { return JSON.parse(slice); } catch (_e) { break; }
        }
      }
    }
  }
  return null;
}

function validateStageOutput(stageId, parsed) {
  const shape = STAGE_OUTPUT_SHAPE[stageId];
  const warnings = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, warnings: ['output is not a plain object'] };
  }
  if (!shape) return { ok: true, warnings: ['no shape registered for stage'] };
  const presentKeys = Object.keys(parsed);
  const hits = shape.requiredAny.filter((k) => presentKeys.includes(k));
  if (hits.length === 0) {
    return {
      ok: false,
      warnings: [`output missing all expected keys: ${shape.requiredAny.join(',')}`]
    };
  }
  const missing = shape.requiredAny.filter((k) => !presentKeys.includes(k));
  if (missing.length > 0) {
    warnings.push(`missing optional keys: ${missing.join(',')}`);
  }
  return { ok: true, warnings };
}

// ---------- Persist AI run result ----------

async function persistAiRun(projectId, stageId, { userPrompt, rawResponse, parsedOutput }) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolveWorkflowPaths(project);
    const cur = await readWorkflowFile(file);
    if (!cur.stages[stageId]) throw wfErr(404, 'stage_not_found');
    const stage = cur.stages[stageId];

    stage.ai_log = (stage.ai_log || []).concat([
      { ts: Date.now(), role: 'user', content: summarizeLogContent(userPrompt) },
      { ts: Date.now(), role: 'assistant', content: summarizeLogContent(rawResponse) }
    ]).slice(-AI_LOG_MAX_ENTRIES);
    stage.output = parsedOutput;
    stage.status = 'complete';
    stage.last_updated_ts = Date.now();

    runSchema(cur);
    await ensureDir(dir);
    await atomicWriteJson(file, cur);
    return cur.stages[stageId];
  });
}

async function markInProgress(projectId, stageId, userPrompt) {
  return withLock(projectId, async () => {
    const project = await loadProjectOrThrow(projectId);
    const { dir, file } = await resolveWorkflowPaths(project);
    const cur = await readWorkflowFile(file);
    if (!cur.stages[stageId]) throw wfErr(404, 'stage_not_found');
    const stage = cur.stages[stageId];
    stage.status = 'in_progress';
    stage.input = sanitizeText(userPrompt || stage.input);
    stage.last_updated_ts = Date.now();
    runSchema(cur);
    await ensureDir(dir);
    await atomicWriteJson(file, cur);
    return { project, stage: cur.stages[stageId], workflow: cur };
  });
}

// ---------- AI run (returns a runner that drives an SSE response) ----------

function runStage({
  projectId,
  stageId,
  userPrompt,
  // model arg is accepted but currently unused — claude.js picks the binary
  // model: _model,
  onChunk,
  onParsed,
  onError
}) {
  let proc = null;
  let aborted = false;

  (async () => {
    let project, workflow;
    try {
      const cleanPrompt = sanitizeText(userPrompt);
      if (!cleanPrompt) {
        onError(wfErr(400, 'bad_request', 'user_prompt required'));
        return;
      }
      if (!STAGE_ID_SET.has(stageId)) {
        const cur = await getWorkflow(projectId);
        if (!cur.stages[stageId]) {
          onError(wfErr(404, 'stage_not_found'));
          return;
        }
      }
      const marked = await markInProgress(projectId, stageId, cleanPrompt);
      project = marked.project;
      workflow = marked.workflow;
      if (!isStageUnlocked(workflow, stageId)) {
        onError(wfErr(409, 'stage_locked', { requires_pending: pendingRequires(workflow, stageId) }));
        return;
      }
    } catch (e) {
      onError(e);
      return;
    }

    const composed = buildPrompt(stageId, project, workflow, sanitizeText(userPrompt));
    let collected = '';

    proc = claude.sendMessage({
      projectId,
      cwd: project.local_path,
      text: composed,
      onChunk: (chunk) => {
        if (aborted) return;
        collected += chunk;
        try { onChunk(chunk); } catch (_e) { /* listener error */ }
      },
      onDone: async () => {
        if (aborted) return;
        const parsed = extractJsonObject(collected);
        const verdict = parsed ? validateStageOutput(stageId, parsed)
                               : { ok: false, warnings: ['no JSON object found in response'] };
        if (!parsed || !verdict.ok) {
          try {
            await persistAiRun(projectId, stageId, {
              userPrompt: sanitizeText(userPrompt),
              rawResponse: collected,
              parsedOutput: null
            }).catch(() => {});
          } finally {
            onError(wfErr(502, 'invalid_response', {
              warnings: verdict.warnings,
              raw_preview: collected.slice(0, 500)
            }));
          }
          return;
        }
        try {
          const updated = await persistAiRun(projectId, stageId, {
            userPrompt: sanitizeText(userPrompt),
            rawResponse: collected,
            parsedOutput: parsed
          });
          onParsed({
            output: updated.output,
            status: updated.status,
            warnings: verdict.warnings
          });
        } catch (e) {
          onError(e);
        }
      },
      onError: (err) => {
        if (aborted) return;
        onError(wfErr(502, 'claude_failed', String(err && err.message || err).slice(0, 200)));
      }
    });
  })().catch((e) => { try { onError(e); } catch (_e) {} });

  return {
    abort() {
      aborted = true;
      if (proc && !proc.killed) {
        try { proc.kill('SIGTERM'); } catch (_e) {}
      }
    }
  };
}

// ---------- exports ----------

module.exports = {
  getWorkflow,
  resetWorkflow,
  patchStage,
  applyStageOutput,
  runStage,
  summarizeWorkflow,
  isStageUnlocked,
  pendingRequires,
  wfErr,
  // for tests
  _internals: {
    defaultWorkflow,
    mergeWithDefaults,
    extractJsonObject,
    validateStageOutput,
    buildPrompt,
    sanitizeText,
    STAGE_DEFS,
    STAGE_OUTPUT_SHAPE
  }
};
