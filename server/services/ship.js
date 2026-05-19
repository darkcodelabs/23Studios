'use strict';

// Phase 6 B11 — Build + Ship orchestrator.
//
// Runs the project through every pre-flight gate, builds the SDK export,
// and lands the artifact in the team-owned games tree (or fires the
// project's own build.sh, if one is supplied).
//
// Step order (each step short-circuits the chain on hard failure):
//
//   1. lint     — every scene's Lua via services/lua_lint (B10)
//   2. drift    — services/drift_detect post-gen flags must be empty
//   3. approval — services/approvals queue must be empty
//   4. export   — services/sdk_export.startExport → .pdx
//   5. zip      — the export job's zip cache (existing download endpoint)
//   6. sim      — sim walkthrough placeholder (B7's SimPanel is interactive)
//   7. deliver  — if project has its own build.sh, run that;
//                 otherwise copy the .pdx to <STUDIO_GAMES_DIR>/<slug>/
//
// API:
//   startShip({ projectId, onEvent, options }) -> { id, awaitDone }
//   getJob(id), getJobsByProject(projectId)

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const projects = require('./projects');
const lua_lint = require('./lua_lint');
const driftDetect = require('./drift_detect');
const sdkExport = require('./sdk_export');

// approvals (B3) may be merged after ship (B11); load lazily so this service
// boots in either ordering. When unavailable, the approval gate auto-passes.
let _approvals = null;
function approvalsService() {
  if (_approvals !== null) return _approvals;
  try { _approvals = require('./approvals'); }
  catch (_e) { _approvals = false; }
  return _approvals || null;
}

const SHIP_ROOT = process.env.SHIP_ROOT_DIR || path.join(os.tmpdir(), '23studios-ship');
const STUDIO_GAMES_DIR = process.env.STUDIO_GAMES_DIR || path.join(process.cwd(), 'examples');

const _jobs = new Map();

const STEPS = Object.freeze([
  'lint', 'drift', 'approval', 'export', 'zip', 'sim', 'deliver'
]);

function newId() {
  return `ship-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function slug(s) {
  return String(s || 'game').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'game';
}

function emit(onEvent, event, data) {
  if (typeof onEvent !== 'function') return;
  try { onEvent(event, data || {}); } catch (_e) { /* ignore consumer errors */ }
}

// ---------- pre-flight steps ----------

async function checkLint(localPath) {
  const sdkFile = path.join(localPath, 'sdk_data', 'project.json');
  if (!fs.existsSync(sdkFile)) {
    return { pass: true, summary: { errors: 0, warnings: 0, total: 0 }, files: [], note: 'no sdk_data — skipped' };
  }
  const data = JSON.parse(await fsp.readFile(sdkFile, 'utf8'));
  let errors = 0, warnings = 0;
  const files = [];
  for (const s of (data.scenes || [])) {
    const lua = (s && s.lua && String(s.lua)) || '';
    if (!lua) continue;
    const findings = lua_lint.lint(lua, `scenes/${s.id}.lua`);
    const sum = lua_lint.summarize(findings);
    errors += sum.errors;
    warnings += sum.warnings;
    files.push({ scene_id: s.id, summary: sum });
  }
  return {
    pass: errors === 0,
    summary: { errors, warnings, total: errors + warnings },
    files
  };
}

async function checkDrift(projectId) {
  let flags;
  try { flags = await driftDetect.readDriftFlags(projectId, {}); }
  catch (_e) { flags = { items: [] }; }
  const items = flags.items || [];
  return {
    pass: items.length === 0,
    count: items.length,
    sample: items.slice(0, 5).map((f) => ({
      kind: f.kind, scene_id: f.scene_id || null, stage: f.stage || null,
      perceptual_distance: f.perceptual_distance ?? null
    }))
  };
}

async function checkApprovals(projectId) {
  const approvals = approvalsService();
  if (!approvals) return { pass: true, count: 0, sample: [], note: 'approvals service not available' };
  let q;
  try { q = await approvals.readQueue(projectId); }
  catch (_e) { q = { items: [] }; }
  const items = q.items || [];
  return {
    pass: items.length === 0,
    count: items.length,
    sample: items.slice(0, 5).map((x) => ({ asset_id: x.asset_id, kind: x.kind }))
  };
}

// ---------- export step ----------

async function runExport(projectId, onEvent) {
  // sdkExport.startExport is fire-and-forget with onEvent for progress.
  // It returns a job object whose `status` will move from 'running' to
  // 'done' | 'failed' via mutation. We poll until terminal.
  const job = await sdkExport.startExport({
    projectId,
    onEvent: (evt, data) => emit(onEvent, `export.${evt}`, data)
  });
  // Poll the job map (sdk_export mutates the same job object in place).
  return await new Promise((resolve) => {
    const tick = () => {
      const j = sdkExport.getJob(job.id);
      if (!j) return resolve({ pass: false, error: 'job vanished' });
      if (j.status === 'done')   return resolve({ pass: true,  job_id: j.id, out_pdx: j.out_pdx });
      if (j.status === 'failed') return resolve({ pass: false, job_id: j.id, error: j.error || 'export failed' });
      setTimeout(tick, 250);
    };
    tick();
  });
}

// ---------- zip step ----------

async function runZip(projectId, exportJobId, onEvent) {
  // The download endpoint builds + caches the zip at /tmp/<id>.pdx.zip. We
  // build that artifact here directly so the ship step can verify it without
  // an HTTP round-trip.
  const j = sdkExport.getJob(exportJobId);
  if (!j || j.status !== 'done' || !j.out_pdx) {
    return { pass: false, error: 'no completed export to zip' };
  }
  const outPdx = j.out_pdx;
  if (!fs.existsSync(outPdx)) return { pass: false, error: 'pdx vanished' };
  const cachePath = path.join('/tmp', `${projectId}.pdx.zip`);
  let rebuild = true;
  try {
    if (fs.existsSync(cachePath)) {
      const cs = fs.statSync(cachePath);
      const ps = fs.statSync(outPdx);
      rebuild = cs.mtimeMs < ps.mtimeMs;
    }
  } catch (_e) { rebuild = true; }
  if (rebuild) {
    try { fs.unlinkSync(cachePath); } catch (_e) { /* */ }
    emit(onEvent, 'zip.start', { path: cachePath });
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn('zip', ['-r', '-q', '-0', cachePath, path.basename(outPdx)],
        { cwd: path.dirname(outPdx), stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code));
    });
    if (exitCode !== 0) return { pass: false, error: `zip exit ${exitCode}` };
  }
  const size = fs.statSync(cachePath).size;
  return { pass: true, zip_path: cachePath, size_bytes: size };
}

// ---------- sim walkthrough placeholder ----------
//
// SimPanel (B7) is an interactive UI step — the operator drives the sim.
// Ship records that the sim has been spec'd (sdk_data exists) and emits
// a manual-attention hint when the project hasn't yet been sim-walked.
async function runSim(projectId, options) {
  const skip = options && options.skip_sim;
  if (skip) return { pass: true, skipped: true, note: 'sim skipped by request' };
  const proj = await projects.getProject(projectId);
  if (!proj || !proj.local_path) return { pass: true, skipped: true };
  const sdkFile = path.join(proj.local_path, 'sdk_data', 'project.json');
  if (!fs.existsSync(sdkFile)) {
    return { pass: true, skipped: true, note: 'no sdk_data — nothing to walk' };
  }
  // Soft pass: surface a hint so the UI can show "open SimPanel" CTA.
  return {
    pass: true,
    soft: true,
    note: 'sim walkthrough is operator-driven; SimPanel available in /sdk/edit'
  };
}

// ---------- delivery ----------

async function runDeliver(project, zipInfo, exportInfo, onEvent) {
  const localPath = project.local_path;
  const buildSh = path.join(localPath, 'build.sh');
  if (fs.existsSync(buildSh)) {
    emit(onEvent, 'deliver.script.start', { script: buildSh });
    const exitCode = await new Promise((resolve) => {
      const child = spawn('bash', [buildSh], {
        cwd: localPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SHIP_PDX:    exportInfo.out_pdx || '',
          SHIP_ZIP:    zipInfo.zip_path || '',
          SHIP_GAME_SLUG: slug(project.name)
        }
      });
      let stderr = '';
      child.stdout.on('data', (b) => emit(onEvent, 'deliver.script.stdout', { line: String(b).slice(0, 4000) }));
      child.stderr.on('data', (b) => { stderr += String(b); emit(onEvent, 'deliver.script.stderr', { line: String(b).slice(0, 4000) }); });
      child.on('error', () => resolve({ code: -1, stderr: 'spawn failed' }));
      child.on('exit', (code) => resolve({ code, stderr }));
    });
    if (exitCode.code !== 0) {
      return { pass: false, mode: 'build_sh', exit_code: exitCode.code, error: exitCode.stderr.slice(0, 4000) };
    }
    return { pass: true, mode: 'build_sh', exit_code: 0 };
  }

  // Default: copy the .pdx into STUDIO_GAMES_DIR/<slug>/<slug>.pdx.zip
  const dest = path.join(STUDIO_GAMES_DIR, slug(project.name));
  await fsp.mkdir(dest, { recursive: true });
  const zipDest = path.join(dest, `${slug(project.name)}.pdx.zip`);
  if (zipInfo.zip_path && fs.existsSync(zipInfo.zip_path)) {
    await fsp.copyFile(zipInfo.zip_path, zipDest);
  }
  return {
    pass: true,
    mode: 'copy_to_examples',
    dest_dir: dest,
    zip_dest: zipDest
  };
}

// ---------- top-level orchestrator ----------

function startShip({ projectId, onEvent, options }) {
  const id = newId();
  const job = {
    id,
    project_id: projectId,
    status: 'running',
    started_at: Date.now(),
    options: options || {},
    steps: STEPS.map((name) => ({ name, status: 'pending', result: null, started_at: null, ended_at: null })),
    error: null,
    finished_at: null
  };
  _jobs.set(id, job);

  function setStep(name, patch) {
    const s = job.steps.find((x) => x.name === name);
    if (!s) return;
    Object.assign(s, patch);
    emit(onEvent, 'step', { step: name, status: s.status, result: s.result });
  }
  async function run(step, fn) {
    setStep(step, { status: 'running', started_at: Date.now() });
    try {
      const r = await fn();
      setStep(step, { status: r.pass ? 'pass' : 'fail', result: r, ended_at: Date.now() });
      return r;
    } catch (e) {
      const result = { pass: false, error: (e && e.message) || String(e) };
      setStep(step, { status: 'fail', result, ended_at: Date.now() });
      return result;
    }
  }
  function halt(reason) {
    job.status = 'failed';
    job.error = reason;
    job.finished_at = Date.now();
    emit(onEvent, 'done', { status: 'failed', error: reason });
  }
  function succeed() {
    job.status = 'done';
    job.finished_at = Date.now();
    emit(onEvent, 'done', { status: 'done' });
  }

  const awaitDone = (async () => {
    let project;
    try {
      project = await projects.getProject(projectId);
      if (!project) return halt('project not found');
      if (!project.local_path) return halt('project has no local_path');
    } catch (e) {
      return halt('project lookup failed: ' + ((e && e.message) || String(e)));
    }
    emit(onEvent, 'start', { project: { id: projectId, name: project.name } });

    const lint = await run('lint', () => checkLint(project.local_path));
    if (!lint.pass && !job.options.allow_lint_fail) return halt('lint failed');

    const drift = await run('drift', () => checkDrift(projectId));
    if (!drift.pass && !job.options.allow_drift) return halt(`${drift.count} drift flags pending`);

    const approval = await run('approval', () => checkApprovals(projectId));
    if (!approval.pass) return halt(`${approval.count} assets pending approval`);

    const exp = await run('export', () => runExport(projectId, onEvent));
    if (!exp.pass) return halt('export failed: ' + (exp.error || 'unknown'));

    const zipR = await run('zip', () => runZip(projectId, exp.job_id, onEvent));
    if (!zipR.pass) return halt('zip failed: ' + (zipR.error || 'unknown'));

    await run('sim', () => runSim(projectId, job.options));

    const deliver = await run('deliver', () => runDeliver(project, zipR, exp, onEvent));
    if (!deliver.pass) return halt('deliver failed: ' + (deliver.error || 'unknown'));

    succeed();
  })().catch((e) => halt('orchestrator crashed: ' + ((e && e.message) || String(e))));

  return { id, awaitDone };
}

function getJob(id) {
  return _jobs.get(id) || null;
}

function getJobsByProject(projectId) {
  const out = [];
  for (const j of _jobs.values()) if (j.project_id === projectId) out.push(j);
  return out.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
}

// Pre-flight only — runs checks 1..3 without exporting. Used by ShipButton's
// modal so the operator can see green/red before committing to a full ship.
async function preflight(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('project not found'); e.status = 404; throw e; }
  if (!project.local_path) { const e = new Error('project has no local_path'); e.status = 400; throw e; }
  const [lint, drift, approval] = await Promise.all([
    checkLint(project.local_path),
    checkDrift(projectId),
    checkApprovals(projectId)
  ]);
  return {
    project_id: projectId,
    project_name: project.name,
    has_build_sh: fs.existsSync(path.join(project.local_path, 'build.sh')),
    checks: { lint, drift, approval },
    pass: lint.pass && drift.pass && approval.pass
  };
}

module.exports = {
  startShip,
  getJob,
  getJobsByProject,
  preflight,
  STEPS,
  _internals: { checkLint, checkDrift, checkApprovals, slug, SHIP_ROOT, STUDIO_GAMES_DIR }
};

void SHIP_ROOT;
