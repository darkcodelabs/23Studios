'use strict';

// Visual Pack Factory — Node wrapper for the Python pipeline at
// services/visual_pack_factory. Spawns Python tools with
// `shell: false` and parses the last JSON line of stdout as the result.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const projects = require('./projects');
const logBus = require('./logBus');
const validator = require('./playdate_validator');

// ---------- paths ----------

const FACTORY_DIR = path.resolve(__dirname, '..', '..', 'services', 'visual_pack_factory');
const VENV_PY = path.join(FACTORY_DIR, '.venv-visual-pack', 'bin', 'python');
const SYSTEM_PY = 'python3';

const PACKS_ROOT = path.resolve(
  process.env.VISUAL_PACKS_ROOT ||
    path.join(__dirname, '..', 'data', 'visual_packs')
);

// ---------- errors ----------

function vpErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

// ---------- helpers ----------

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function assertSlug(v, field) {
  if (typeof v !== 'string' || !SLUG_RE.test(v)) {
    throw vpErr(400, 'bad_slug', `${field} must match ${SLUG_RE.source}`);
  }
  return v;
}

function pickPython() {
  try {
    if (fs.existsSync(VENV_PY)) return VENV_PY;
  } catch (_e) { /* ignore */ }
  return process.env.VISUAL_PACK_PYTHON || SYSTEM_PY;
}

async function ensureProject(projectId) {
  assertSlug(projectId, 'projectId');
  const p = await projects.getProject(projectId);
  if (!p) throw vpErr(404, 'project_not_found');
  return p;
}

function packDir(projectId, packId) {
  assertSlug(projectId, 'projectId');
  assertSlug(packId, 'packId');
  return path.join(PACKS_ROOT, projectId, packId);
}

async function ensurePacksRoot() {
  await fsp.mkdir(PACKS_ROOT, { recursive: true });
}

// Run a Python tool. Returns parsed JSON from the last stdout line; throws
// if the process exited non-zero or stdout had no JSON line. Stderr is
// piped to the per-project logBus for live observability.
function runTool(toolModule, args, { projectId, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const py = pickPython();
    const finalArgs = ['-m', `tools.${toolModule}`, ...args];
    const child = spawn(py, finalArgs, {
      cwd: FACTORY_DIR,
      shell: false,
      env: {
        ...process.env,
        VISUAL_PACKS_ROOT: PACKS_ROOT,
        PYTHONPATH: FACTORY_DIR,
      },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch (_e) { /* ignore */ }
    }, timeoutMs);

    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => {
      const chunk = b.toString('utf8');
      stderr += chunk;
      if (projectId) {
        logBus.emit(projectId, { kind: 'visual_pack', stream: 'stderr', text: chunk });
      }
    });

    child.on('error', (err) => {
      clearTimeout(t);
      reject(vpErr(500, 'spawn_failed', err.message));
    });

    child.on('close', (code) => {
      clearTimeout(t);
      if (killed) {
        return reject(vpErr(504, 'tool_timeout', { toolModule, args, stderr }));
      }
      // Try to parse the LAST non-empty stdout line as JSON regardless of
      // exit code — validate_pack returns code 3 with a useful payload.
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      let parsed = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          parsed = JSON.parse(lines[i]);
          break;
        } catch (_e) { /* keep looking */ }
      }
      if (parsed && parsed.ok === true) {
        return resolve({ exit: code, ...parsed });
      }
      if (parsed && parsed.ok === false) {
        return reject(vpErr(parsed.status || 400,
          parsed.code || 'tool_failed', parsed.detail || stderr));
      }
      return reject(vpErr(500, 'tool_no_json', {
        exit: code, stderr, stdout_tail: stdout.slice(-1024),
      }));
    });
  });
}

// ---------- public API ----------

async function listPacks(projectId) {
  await ensureProject(projectId);
  await ensurePacksRoot();
  const projRoot = path.join(PACKS_ROOT, projectId);
  let entries = [];
  try {
    entries = await fsp.readdir(projRoot, { withFileTypes: true });
  } catch (_e) { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const cfgPath = path.join(projRoot, e.name, 'pack_config.yaml');
    if (fs.existsSync(cfgPath)) {
      const raw = await fsp.readFile(cfgPath, 'utf8');
      out.push({ pack_id: e.name, raw_yaml: raw, path: path.join(projRoot, e.name) });
    }
  }
  return out;
}

async function initPack(projectId, body) {
  await ensureProject(projectId);
  await ensurePacksRoot();
  const packId = assertSlug(body.pack_id || '', 'pack_id');
  const type = String(body.type || '');
  const targetDim = String(body.target_dim || '');
  if (!type) throw vpErr(400, 'type_required');
  if (!targetDim) throw vpErr(400, 'target_dim_required');
  const args = [
    '--project', projectId,
    '--pack', packId,
    '--type', type,
    '--target-dim', targetDim,
    '--description', String(body.description || ''),
    '--export-target', String(body.export_target || 'source/images'),
  ];
  if (body.asset_type) {
    args.push('--asset-type', String(body.asset_type));
  }
  return runTool('init_pack', args, { projectId });
}

async function addSource(projectId, packId, body, file) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  const type = body.type || (file ? 'image' : null);
  if (!type) throw vpErr(400, 'type_required');
  const args = [
    '--project', projectId,
    '--pack', packId,
    '--type', type,
    '--notes', String(body.notes || ''),
  ];
  if (['image', 'screenshot', 'sketch'].includes(type)) {
    if (!file) throw vpErr(400, 'file_required');
    const tmp = path.join(PACKS_ROOT, '.tmp');
    await fsp.mkdir(tmp, { recursive: true });
    const ext = path.extname(file.originalname || 'src.png').toLowerCase() || '.png';
    const tmpPath = path.join(tmp, `${crypto.randomBytes(8).toString('hex')}${ext}`);
    await fsp.writeFile(tmpPath, file.buffer);
    args.push('--file', tmpPath);
    try {
      return await runTool('add_source', args, { projectId });
    } finally {
      try { await fsp.unlink(tmpPath); } catch (_e) { /* best effort */ }
    }
  }
  if (type === 'url') {
    if (!body.url) throw vpErr(400, 'url_required');
    args.push('--url', String(body.url));
  } else if (type === 'note') {
    if (!body.text) throw vpErr(400, 'text_required');
    args.push('--text', String(body.text));
  } else {
    throw vpErr(400, 'unsupported_type', type);
  }
  return runTool('add_source', args, { projectId });
}

async function listCandidates(projectId, packId) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  const dir = path.join(packDir(projectId, packId), 'candidates');
  if (!fs.existsSync(dir)) return [];
  const files = await fsp.readdir(dir);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const raw = await fsp.readFile(path.join(dir, f), 'utf8');
    try { out.push(JSON.parse(raw)); } catch (_e) { /* skip */ }
  }
  out.sort((a, b) => (a.candidate_id || '').localeCompare(b.candidate_id || ''));
  return out;
}

async function ingestCandidate(projectId, packId, body, file) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  if (!file) throw vpErr(400, 'file_required');

  // Placeholder gate: refuse generated wireframe / flat / debug noise BEFORE
  // it enters the candidate set. Uses existing detector from
  // services/playdate_validator.js — single source of truth (per CLAUDE.md).
  if (!body.bypass_placeholder_gate) {
    try {
      const verdict = await validator.isPlaceholderScenePng(file.buffer);
      if (verdict && verdict.placeholder) {
        throw vpErr(422, 'placeholder_rejected', {
          reason: verdict.reason,
          hint: 'visual_pack_factory refuses placeholder art at ingest. ' +
                'Pass bypass_placeholder_gate=true only for intentional debug fixtures.',
        });
      }
    } catch (e) {
      if (e && e.code === 'placeholder_rejected') throw e;
      // Detector errors should not block real PNGs — log and continue.
      logBus.emit(projectId, {
        kind: 'visual_pack', stream: 'warn',
        text: `placeholder_detector_error: ${e && e.message}`,
      });
    }
  }

  const tmp = path.join(PACKS_ROOT, '.tmp');
  await fsp.mkdir(tmp, { recursive: true });
  const ext = path.extname(file.originalname || 'src.png').toLowerCase() || '.png';
  const tmpPath = path.join(tmp, `${crypto.randomBytes(8).toString('hex')}${ext}`);
  await fsp.writeFile(tmpPath, file.buffer);
  const args = [
    '--project', projectId, '--pack', packId,
    '--file', tmpPath,
    '--variant', String(body.variant || 'a'),
    '--source-ids', String(body.source_ids || ''),
    '--provider', String(body.provider || 'manual'),
  ];
  if (body.prompt_hash) args.push('--prompt-hash', String(body.prompt_hash));
  try {
    return await runTool('generate_pack', args, { projectId });
  } finally {
    try { await fsp.unlink(tmpPath); } catch (_e) { /* best effort */ }
  }
}

async function queueReview(projectId, packId, body = {}) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  const args = ['--project', projectId, '--pack', packId];
  if (body.candidate_id) {
    assertSlug(body.candidate_id, 'candidate_id');
    args.push('--candidate', body.candidate_id);
  }
  return runTool('queue_review', args, { projectId });
}

async function approveCandidate(projectId, packId, candidateId, body) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  assertSlug(candidateId, 'candidateId');
  const level = body.level === 'final' ? 'final' : 'iteration';
  const args = [
    '--project', projectId, '--pack', packId,
    '--candidate', candidateId,
    '--level', level,
    '--notes', String(body.notes || ''),
  ];
  if (level === 'final') {
    if (!body.reviewer) throw vpErr(400, 'reviewer_required');
    args.push('--reviewer', String(body.reviewer));
  }
  return runTool('approve_candidate', args, { projectId });
}

async function rejectCandidate(projectId, packId, candidateId, body) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  assertSlug(candidateId, 'candidateId');
  if (!body.reason) throw vpErr(400, 'reason_required');
  const args = [
    '--project', projectId, '--pack', packId,
    '--candidate', candidateId,
    '--reason', String(body.reason),
    '--reviewer', String(body.reviewer || ''),
  ];
  if (body.correction) args.push('--correction');
  if (body.correction_md_path) {
    args.push('--correction-md', String(body.correction_md_path));
  }
  return runTool('reject_candidate', args, { projectId });
}

async function exportCandidate(projectId, packId, candidateId, body) {
  const proj = await ensureProject(projectId);
  assertSlug(packId, 'packId');
  assertSlug(candidateId, 'candidateId');
  if (!proj.local_path) throw vpErr(400, 'project_local_path_missing');
  const args = [
    '--project', projectId, '--pack', packId,
    '--candidate', candidateId,
    '--project-local-path', proj.local_path,
  ];
  if (body.asset_name) args.push('--asset-name', String(body.asset_name));
  if (body.enforce_hardware) args.push('--enforce-hardware');
  return runTool('export_candidate', args, { projectId });
}

async function buildContactSheet(projectId, packId, body) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  const args = [
    '--project', projectId, '--pack', packId,
    '--mode', body.mode || 'candidates',
    '--tile-size', String(body.tile_size || 128),
    '--cols', String(body.cols || 6),
  ];
  return runTool('build_contact_sheet', args, { projectId });
}

async function buildReferenceBoard(projectId, packId, body) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  const args = [
    '--project', projectId, '--pack', packId,
    '--tile-size', String(body.tile_size || 180),
    '--cols', String(body.cols || 5),
  ];
  return runTool('build_reference_board', args, { projectId });
}

async function extractStyleNotes(projectId, packId) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  return runTool('extract_style_notes', [
    '--project', projectId, '--pack', packId,
  ], { projectId });
}

async function convertToPlaydate(projectId, body) {
  await ensureProject(projectId);
  if (!body.input) throw vpErr(400, 'input_required');
  const args = ['--input', String(body.input)];
  if (body.output) args.push('--output', String(body.output));
  if (body.dither) args.push('--dither', String(body.dither));
  if (body.threshold) args.push('--threshold', String(body.threshold));
  if (body.invert) args.push('--invert');
  return runTool('convert_to_playdate', args, { projectId });
}

async function recordHardwareReview(projectId, packId, candidateId, body, file) {
  await ensureProject(projectId);
  assertSlug(packId, 'packId');
  assertSlug(candidateId, 'candidateId');
  if (!file) throw vpErr(400, 'photo_required');
  if (!body.reviewer) throw vpErr(400, 'reviewer_required');
  const tmp = path.join(PACKS_ROOT, '.tmp');
  await fsp.mkdir(tmp, { recursive: true });
  const ext = path.extname(file.originalname || 'photo.png').toLowerCase() || '.png';
  const tmpPath = path.join(tmp, `${crypto.randomBytes(8).toString('hex')}${ext}`);
  await fsp.writeFile(tmpPath, file.buffer);
  try {
    return await runTool('hardware_review', [
      '--project', projectId, '--pack', packId,
      '--candidate', candidateId,
      '--photo', tmpPath,
      '--reviewer', String(body.reviewer),
      '--verdict', body.verdict === 'fail' ? 'fail' : 'pass',
      '--notes', String(body.notes || ''),
    ], { projectId });
  } finally {
    try { await fsp.unlink(tmpPath); } catch (_e) { /* best effort */ }
  }
}

async function validatePack(projectId, body = {}) {
  await ensureProject(projectId);
  const args = ['--project', projectId];
  if (body.pack_id) {
    assertSlug(body.pack_id, 'pack_id');
    args.push('--pack', body.pack_id);
  }
  if (body.enforce_hardware) args.push('--enforce-hardware');
  // validate_pack exits 3 for errors but returns JSON; runTool already
  // forwards the parsed payload regardless of exit code.
  try {
    return await runTool('validate_pack', args, { projectId });
  } catch (e) {
    if (e && e.code === 'tool_failed' && e.detail) return e.detail;
    throw e;
  }
}

async function updateVisualSpec(projectId, body = {}) {
  const proj = await ensureProject(projectId);
  if (!proj.local_path) throw vpErr(400, 'project_local_path_missing');
  const args = [
    '--project', projectId,
    '--project-local-path', proj.local_path,
  ];
  if (body.spec_relpath) {
    args.push('--spec-relpath', String(body.spec_relpath));
  }
  return runTool('update_visual_spec', args, { projectId });
}

module.exports = {
  PACKS_ROOT,
  FACTORY_DIR,
  listPacks,
  initPack,
  addSource,
  listCandidates,
  ingestCandidate,
  queueReview,
  approveCandidate,
  rejectCandidate,
  exportCandidate,
  buildContactSheet,
  buildReferenceBoard,
  extractStyleNotes,
  convertToPlaydate,
  recordHardwareReview,
  validatePack,
  updateVisualSpec,
};
