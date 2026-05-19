'use strict';

// extract_requirements.js — Phase 6 A2 (Parse + Extract).
//
// Reads the persisted intake sources (see intake_upload.js / A1) and runs 3
// parallel Claude subprocess extractions to produce machine-readable JSON:
//
//   1. Bible       -> scenes (acts/beats/characters/locations), characters,
//                     locations, minigames, cameos.
//   2. Canon       -> style sections, filter-safe alternates, prompt vocab.
//   3. Reference   -> per-image catalog: dims, dither type, contents, anchor.
//      images
//
// The Claude CLI (via server/services/claude.js) is invoked once per worker.
// The bible + canon workers receive the text inline. The reference-image
// worker receives a list of safe file paths and instructs Claude to Read
// each PNG (Claude CLI supports multimodal Read of PNG files when run as
// a subprocess in the project cwd).
//
// Outputs:
//   <project>/sdk_data/requirements/extracted.json
//   <project>/sdk_data/requirements/reference_catalog.json
//   <project>/sdk_data/requirements/extraction_log.json
//
// Job tracking: extract() runs synchronously and resolves to the full result.
// The route layer wraps this in an SSE stream that pushes progress events
// per worker (started / finished / failed). The job registry is exported as
// {startJob, getJob, subscribeJob} so the SSE handler can multiplex events.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const claude = require('./claude');
const intakeUpload = require('./intake_upload');

const REQUIREMENTS_REL = path.join('sdk_data', 'requirements');
const EXTRACTED_REL = path.join(REQUIREMENTS_REL, 'extracted.json');
const CATALOG_REL = path.join(REQUIREMENTS_REL, 'reference_catalog.json');
const LOG_REL = path.join(REQUIREMENTS_REL, 'extraction_log.json');

const PROMPT_BIBLE = [
  'You are extracting structured requirements from a game story bible (text below).',
  'Return STRICT JSON ONLY — no prose, no markdown fences, no comments.',
  '',
  'Schema:',
  '{',
  '  "scenes": [',
  '    { "id": "SC01", "act": 1, "title": "...", "summary": "...",',
  '      "characters_present": ["..."], "location": "...",',
  '      "gameplay_type": "exploration|puzzle|dialog|minigame|cutscene|hub",',
  '      "transitions_to": ["SC02"], "notes": "..." }',
  '  ],',
  '  "characters": [',
  '    { "name": "...", "role": "protagonist|antagonist|mentor|ally|npc|cameo",',
  '      "traits": ["..."], "dialog_samples": [{"line":"...","scene":"SC01"}],',
  '      "portrait_refs": ["..."] }',
  '  ],',
  '  "locations": [',
  '    { "name": "...", "description": "...", "anchor_ref": "<filename or null>",',
  '      "scenes": ["SC01"] }',
  '  ],',
  '  "minigames": [',
  '    { "name": "...", "scene": "SC03", "input": "crank|dpad|timing|hybrid",',
  '      "win_state": "...", "loss_state": "...", "spec_notes": "..." }',
  '  ],',
  '  "cameos": [',
  '    { "name": "...", "scene": "SC26", "verbatim_lines": ["..."], "source_note": "..." }',
  '  ],',
  '  "style_anchors_implied": [',
  '    { "subject": "...", "ref_hint": "<filename or descriptive phrase>" }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- IDs MUST be stable (SC01, SC02, ...). If the bible uses different IDs, preserve them verbatim.',
  '- If a field is unknown, use an empty string or empty array — NEVER null inside arrays.',
  '- Do not invent scenes/characters that are not in the bible text.',
  '- Output JSON only. No prefix, no suffix, no fences.',
  '',
  '=== STORY BIBLE START ==='
].join('\n');

const PROMPT_CANON = [
  'You are extracting structured style canon data from a prompt-canon markdown doc (text below).',
  'Return STRICT JSON ONLY — no prose, no markdown fences.',
  '',
  'Schema:',
  '{',
  '  "sections": [',
  '    { "number": 3, "title": "Global Style Preamble",',
  '      "kind": "preamble|scene|character|ui|fallback|misc",',
  '      "prompt_excerpt": "...", "required_tokens": ["1-bit","400x240","atkinson"],',
  '      "forbidden_tokens": [], "subject_anchors": [], "is_filter_safe_rewrite": false,',
  '      "rewrite_of_section": null }',
  '  ],',
  '  "prompt_vocabulary": {',
  '    "dither_types": ["atkinson","bayer8x8","floyd_steinberg"],',
  '    "lighting_terms": ["low key","crt glow"],',
  '    "subject_terms": [...]',
  '  },',
  '  "filter_safe_alternates": [',
  '    { "original_section": 10, "alternate_section": 17, "trigger_terms": ["2600 Hz","trunk seized"] }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- Preserve section numbering exactly as written in the canon.',
  '- forbidden_tokens captures things the section explicitly tells the model NOT to include.',
  '- filter_safe_alternates only fires if the canon explicitly says "fallback" / "filter-safe rewrite" / similar.',
  '- Output JSON only.',
  '',
  '=== STYLE CANON START ==='
].join('\n');

const PROMPT_REFERENCES = [
  'You are cataloging a set of reference images for a 1-bit Playdate game.',
  'For EACH file path listed below, use the Read tool to open the PNG and describe it.',
  'Return STRICT JSON ONLY — no prose, no markdown fences.',
  '',
  'Schema:',
  '{',
  '  "images": [',
  '    { "filename": "<basename>",',
  '      "rel_path": "<path as given>",',
  '      "dimensions": {"w": 0, "h": 0},',
  '      "dither_type": "atkinson|bayer|floyd|threshold|unknown",',
  '      "is_1bit": true,',
  '      "contents_description": "what is visually in the image (1 sentence)",',
  '      "anchored_subject": "scene|character|ui_surface|prop|background|launcher|unknown",',
  '      "anchored_to": ["SC01"] ,',
  '      "ambiguity_flags": [] }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- If two images appear to be byte-duplicates or near-duplicates, note this in ambiguity_flags.',
  '- If the subject is unclear, set anchored_subject to "unknown" + add an ambiguity_flag.',
  '- Output JSON only.',
  '',
  '=== REFERENCE IMAGE PATHS START ==='
].join('\n');

// ---- helpers ----

function safeParseJson(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  // strip optional code fence
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch (_e) { /* try slice */ }
  // find first balanced object
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++;
    else if (candidate[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(candidate.slice(start, i + 1)); }
        catch (_e) { return null; }
      }
    }
  }
  return null;
}

function askClaude({ projectId, cwd }, prompt) {
  return new Promise((resolve, reject) => {
    let acc = '';
    claude.sendMessage({
      projectId, cwd, text: prompt,
      onChunk: (c) => { acc += c; },
      onDone: () => resolve(acc),
      onError: reject
    });
  });
}

async function readTextDoc(localPath, relPath) {
  if (!relPath) return null;
  const abs = path.join(localPath, relPath);
  try { return await fsp.readFile(abs, 'utf8'); }
  catch (_e) { return null; }
}

async function writeRequirementsFiles(localPath, extracted, catalog, logEntries) {
  const dir = path.join(localPath, REQUIREMENTS_REL);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(localPath, EXTRACTED_REL), JSON.stringify(extracted, null, 2), { mode: 0o600 });
  await fsp.writeFile(path.join(localPath, CATALOG_REL), JSON.stringify(catalog, null, 2), { mode: 0o600 });
  await fsp.writeFile(path.join(localPath, LOG_REL), JSON.stringify(logEntries, null, 2), { mode: 0o600 });
}

// ---- workers (parallelizable) ----

async function extractFromBible({ projectId, cwd, bibleText, claudeFn }) {
  if (!bibleText || bibleText.trim().length === 0) {
    return { ok: false, skipped: true, reason: 'no_bible' };
  }
  const prompt = PROMPT_BIBLE + '\n\n' + bibleText + '\n\n=== STORY BIBLE END ===\n\nJSON OUTPUT:';
  let raw;
  try {
    raw = await (claudeFn ? claudeFn(prompt) : askClaude({ projectId, cwd }, prompt));
  } catch (e) {
    return { ok: false, error: e.message, skipped: false };
  }
  const parsed = safeParseJson(raw);
  if (!parsed) return { ok: false, error: 'unparseable_json', raw_excerpt: raw.slice(0, 400) };
  // shape guard: ensure arrays exist even if Claude omitted them
  for (const k of ['scenes', 'characters', 'locations', 'minigames', 'cameos', 'style_anchors_implied']) {
    if (!Array.isArray(parsed[k])) parsed[k] = [];
  }
  return { ok: true, data: parsed };
}

async function extractFromCanon({ projectId, cwd, canonText, claudeFn }) {
  if (!canonText || canonText.trim().length === 0) {
    return { ok: false, skipped: true, reason: 'no_canon' };
  }
  const prompt = PROMPT_CANON + '\n\n' + canonText + '\n\n=== STYLE CANON END ===\n\nJSON OUTPUT:';
  let raw;
  try {
    raw = await (claudeFn ? claudeFn(prompt) : askClaude({ projectId, cwd }, prompt));
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const parsed = safeParseJson(raw);
  if (!parsed) return { ok: false, error: 'unparseable_json', raw_excerpt: raw.slice(0, 400) };
  if (!Array.isArray(parsed.sections)) parsed.sections = [];
  if (!parsed.prompt_vocabulary || typeof parsed.prompt_vocabulary !== 'object') parsed.prompt_vocabulary = {};
  if (!Array.isArray(parsed.filter_safe_alternates)) parsed.filter_safe_alternates = [];
  return { ok: true, data: parsed };
}

async function catalogReferenceImages({ projectId, cwd, imagePaths, claudeFn }) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return { ok: false, skipped: true, reason: 'no_references' };
  }
  // We supply paths relative to cwd so Claude's Read tool can find them.
  const lines = imagePaths.map((p) => `  - ${p}`).join('\n');
  const prompt = PROMPT_REFERENCES + '\n\n' + lines + '\n\n=== REFERENCE IMAGE PATHS END ===\n\nJSON OUTPUT:';
  let raw;
  try {
    raw = await (claudeFn ? claudeFn(prompt) : askClaude({ projectId, cwd }, prompt));
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const parsed = safeParseJson(raw);
  if (!parsed) return { ok: false, error: 'unparseable_json', raw_excerpt: raw.slice(0, 400) };
  if (!Array.isArray(parsed.images)) parsed.images = [];
  return { ok: true, data: parsed };
}

// ---- top-level orchestrator ----

// extractRequirements(localPath, opts) — runs the 3 workers in parallel and
// writes the combined output to disk.
//
// opts:
//   projectId   string  required (used for claude subprocess session)
//   claudeFn    fn(text) -> Promise<string>   optional test injection
//   emitter     EventEmitter                  optional, receives progress events
//
// Returns { extracted, reference_catalog, log }.
async function extractRequirements(localPath, opts = {}) {
  if (!localPath || !fs.existsSync(localPath)) {
    const err = new Error('localPath required');
    err.status = 400; err.code = 'bad_request';
    throw err;
  }
  const projectId = opts.projectId;
  if (!projectId) {
    const err = new Error('projectId required');
    err.status = 400; err.code = 'bad_request';
    throw err;
  }
  const claudeFn = typeof opts.claudeFn === 'function' ? opts.claudeFn : null;
  const emitter = opts.emitter || new EventEmitter();

  // Reset the claude session for this project so each extract is independent.
  claude.resetSession(projectId);

  const sources = await intakeUpload.listSources(localPath);
  const bibleRel = sources.text_docs.bible && sources.text_docs.bible.rel_path;
  const canonRel = sources.text_docs.canon && sources.text_docs.canon.rel_path;
  const refPaths = (sources.reference_images || []).map((r) => r.rel_path);

  const bibleText = await readTextDoc(localPath, bibleRel);
  const canonText = await readTextDoc(localPath, canonRel);

  const startedAt = new Date().toISOString();
  const log = {
    started_at: startedAt,
    finished_at: null,
    workers: {
      bible: { status: 'pending' },
      canon: { status: 'pending' },
      references: { status: 'pending' }
    },
    inputs: {
      bible_bytes: bibleText ? bibleText.length : 0,
      canon_bytes: canonText ? canonText.length : 0,
      reference_count: refPaths.length
    }
  };

  emitter.emit('progress', { phase: 'started', at: startedAt, inputs: log.inputs });

  // Per-worker wrapper that emits start/finish events.
  function runWorker(name, fn) {
    log.workers[name].status = 'running';
    log.workers[name].started_at = new Date().toISOString();
    emitter.emit('progress', { phase: 'worker_started', worker: name });
    return Promise.resolve()
      .then(fn)
      .then((res) => {
        log.workers[name].status = res && res.ok ? 'done' : (res && res.skipped ? 'skipped' : 'failed');
        log.workers[name].finished_at = new Date().toISOString();
        if (res && !res.ok && !res.skipped) log.workers[name].error = res.error || 'unknown';
        if (res && res.skipped) log.workers[name].reason = res.reason || '';
        emitter.emit('progress', { phase: 'worker_finished', worker: name, status: log.workers[name].status });
        return res;
      })
      .catch((e) => {
        log.workers[name].status = 'failed';
        log.workers[name].finished_at = new Date().toISOString();
        log.workers[name].error = e.message;
        emitter.emit('progress', { phase: 'worker_finished', worker: name, status: 'failed', error: e.message });
        return { ok: false, error: e.message };
      });
  }

  const [bibleResult, canonResult, refResult] = await Promise.all([
    runWorker('bible', () => extractFromBible({ projectId, cwd: localPath, bibleText, claudeFn })),
    runWorker('canon', () => extractFromCanon({ projectId, cwd: localPath, canonText, claudeFn })),
    runWorker('references', () => catalogReferenceImages({ projectId, cwd: localPath, imagePaths: refPaths, claudeFn }))
  ]);

  const extracted = {
    generated_at: startedAt,
    scenes: (bibleResult.ok && bibleResult.data.scenes) || [],
    characters: (bibleResult.ok && bibleResult.data.characters) || [],
    locations: (bibleResult.ok && bibleResult.data.locations) || [],
    minigames: (bibleResult.ok && bibleResult.data.minigames) || [],
    cameos: (bibleResult.ok && bibleResult.data.cameos) || [],
    style_anchors_implied: (bibleResult.ok && bibleResult.data.style_anchors_implied) || [],
    canon: canonResult.ok ? canonResult.data : { sections: [], prompt_vocabulary: {}, filter_safe_alternates: [] }
  };
  const catalog = refResult.ok ? refResult.data : { images: [] };

  log.finished_at = new Date().toISOString();
  log.summary = {
    scene_count: extracted.scenes.length,
    character_count: extracted.characters.length,
    location_count: extracted.locations.length,
    minigame_count: extracted.minigames.length,
    cameo_count: extracted.cameos.length,
    canon_section_count: extracted.canon.sections.length,
    reference_image_count: catalog.images.length
  };

  await writeRequirementsFiles(localPath, extracted, catalog, log);
  emitter.emit('progress', { phase: 'finished', summary: log.summary });

  return { extracted, reference_catalog: catalog, log };
}

// ---- job registry (for SSE) ----

const jobs = new Map();

function newJobId() {
  return 'extract-' + crypto.randomBytes(6).toString('hex');
}

function startJob(localPath, projectId) {
  const id = newJobId();
  const emitter = new EventEmitter();
  const job = {
    id,
    projectId,
    localPath,
    state: 'running',
    events: [],
    emitter,
    started_at: new Date().toISOString(),
    finished_at: null,
    result: null,
    error: null
  };
  jobs.set(id, job);

  emitter.on('progress', (evt) => {
    const entry = { ts: Date.now(), ...evt };
    job.events.push(entry);
    if (job.events.length > 500) job.events.shift();
  });

  extractRequirements(localPath, { projectId, emitter })
    .then((result) => {
      job.state = 'done';
      job.finished_at = new Date().toISOString();
      job.result = {
        scene_count: result.log.summary.scene_count,
        character_count: result.log.summary.character_count,
        canon_section_count: result.log.summary.canon_section_count,
        reference_image_count: result.log.summary.reference_image_count
      };
      emitter.emit('progress', { phase: 'job_done', result: job.result });
    })
    .catch((e) => {
      job.state = 'failed';
      job.finished_at = new Date().toISOString();
      job.error = e.message;
      emitter.emit('progress', { phase: 'job_failed', error: e.message });
    });

  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function subscribeJob(id, onEvent) {
  const job = jobs.get(id);
  if (!job) return null;
  // replay existing events
  for (const evt of job.events) onEvent(evt);
  // and live-stream new ones
  const handler = (evt) => onEvent({ ts: Date.now(), ...evt });
  job.emitter.on('progress', handler);
  return () => job.emitter.off('progress', handler);
}

module.exports = {
  extractRequirements,
  startJob,
  getJob,
  subscribeJob,
  // exposed for tests
  _internal: {
    safeParseJson,
    extractFromBible,
    extractFromCanon,
    catalogReferenceImages,
    REQUIREMENTS_REL
  }
};
