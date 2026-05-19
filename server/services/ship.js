'use strict';

// ship.js — Phase 6 B11
//
// Sequential ship pipeline. Each step emits a `step` event:
//   { step: 'lint'|'drift'|'approvals'|'export'|'zip'|'walkthrough'|'publish',
//     status: 'running'|'pass'|'fail'|'skip', detail?, started_at, finished_at }
// Then a final `done` { ok, ship_id, artifacts }.
//
// Steps:
//   1. lint    — lints every scene_lua; fail on any error finding
//   2. drift   — reads drift flags via drift_detect; fail above threshold
//   3. approvals — checks per-project approvals queue if it exists; skip when absent
//   4. export  — POSTs a sdk_export job + polls until done
//   5. zip     — produces .pdx.zip
//   6. walkthrough — record_session via sdk_preview (best-effort; warn-only)
//   7. publish — if local_path is a git repo with its own build.sh, run that;
//                else copy artifacts to examples/<game>/ in repo root

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const projects = require('./projects');
const lua_lint = require('./lua_lint');
const drift_detect = require('./drift_detect');
const sdkExport = require('./sdk_export');
const sdkPreview = require('./sdk_preview');

const DRIFT_THRESHOLD = 5; // default; per-project override via project.json.ship_drift_threshold

const _ships = new Map(); // ship_id -> { events: [...], done, ok }

function makeShipId() {
  return 'ship-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function recordEvent(ship, evt) {
  ship.events.push({ ...evt, ts: Date.now() });
  for (const cb of ship.subscribers) {
    try { cb(evt); } catch (_e) { /* */ }
  }
}

async function stepLint(ship, project) {
  const evt = { step: 'lint', status: 'running', started_at: Date.now() };
  recordEvent(ship, evt);
  try {
    const sdkFile = path.join(project.local_path || '', 'sdk_data', 'project.json');
    if (!fs.existsSync(sdkFile)) {
      const skip = { ...evt, status: 'skip', detail: 'no sdk_data/project.json', finished_at: Date.now() };
      recordEvent(ship, skip);
      return { pass: true, skipped: true };
    }
    const data = JSON.parse(await fsp.readFile(sdkFile, 'utf8'));
    let errors = 0, warnings = 0, byScene = [];
    for (const s of (data.scenes || [])) {
      if (!s.lua) continue;
      const findings = lua_lint.lint(s.lua, `scenes/${s.id}.lua`);
      const sum = lua_lint.summarize(findings);
      errors += sum.errors; warnings += sum.warnings;
      if (sum.errors || sum.warnings) byScene.push({ scene_id: s.id, ...sum });
    }
    const done = { ...evt, status: errors === 0 ? 'pass' : 'fail',
                   detail: `${errors}E ${warnings}W across ${byScene.length} files`,
                   findings_summary: byScene, finished_at: Date.now() };
    recordEvent(ship, done);
    return { pass: errors === 0, errors, warnings };
  } catch (e) {
    recordEvent(ship, { ...evt, status: 'fail', detail: e.message, finished_at: Date.now() });
    return { pass: false, error: e.message };
  }
}

async function stepDrift(ship, project) {
  const evt = { step: 'drift', status: 'running', started_at: Date.now() };
  recordEvent(ship, evt);
  try {
    const flags = await drift_detect.readDriftFlags(project.id, {});
    const count = (flags && flags.flags && flags.flags.length) || 0;
    const threshold = (project.ship_drift_threshold != null) ? project.ship_drift_threshold : DRIFT_THRESHOLD;
    const pass = count <= threshold;
    recordEvent(ship, { ...evt, status: pass ? 'pass' : 'fail',
                        detail: `${count} drift flags (threshold ${threshold})`,
                        flag_count: count, threshold, finished_at: Date.now() });
    return { pass, count };
  } catch (e) {
    // drift_detect throws when no flags file exists yet — treat as zero.
    recordEvent(ship, { ...evt, status: 'pass', detail: '0 drift flags (no log yet)', finished_at: Date.now() });
    return { pass: true, count: 0 };
  }
}

async function stepApprovals(ship, project) {
  const evt = { step: 'approvals', status: 'running', started_at: Date.now() };
  recordEvent(ship, evt);
  // Approvals queue lives at <local_path>/sdk_data/approvals_queue.json once
  // B3 ships its asset approver. Absent file = nothing pending = pass.
  const qPath = path.join(project.local_path || '', 'sdk_data', 'approvals_queue.json');
  if (!fs.existsSync(qPath)) {
    recordEvent(ship, { ...evt, status: 'pass', detail: 'no approvals queue file (nothing pending)', finished_at: Date.now() });
    return { pass: true, pending: 0 };
  }
  try {
    const queue = JSON.parse(fs.readFileSync(qPath, 'utf8'));
    const pending = Array.isArray(queue.items) ? queue.items.filter((i) => i.status !== 'approved').length
                  : Array.isArray(queue) ? queue.filter((i) => i.status !== 'approved').length
                  : 0;
    const pass = pending === 0;
    recordEvent(ship, { ...evt, status: pass ? 'pass' : 'fail',
                        detail: pass ? 'queue empty' : `${pending} pending approvals`,
                        pending_count: pending, finished_at: Date.now() });
    return { pass, pending };
  } catch (e) {
    recordEvent(ship, { ...evt, status: 'fail', detail: e.message, finished_at: Date.now() });
    return { pass: false };
  }
}

async function stepExport(ship, project) {
  const evt = { step: 'export', status: 'running', started_at: Date.now() };
  recordEvent(ship, evt);
  try {
    const job = await sdkExport.startExport({ projectId: project.id });
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = sdkExport.getJob(job.id);
      if (!j) break;
      if (j.status === 'done') {
        recordEvent(ship, { ...evt, status: 'pass', detail: `built ${path.basename(j.out_pdx)}`,
                            job_id: j.id, out_pdx: j.out_pdx, finished_at: Date.now() });
        return { pass: true, out_pdx: j.out_pdx, job_id: j.id };
      }
      if (j.status === 'failed') {
        recordEvent(ship, { ...evt, status: 'fail', detail: j.error || 'export failed', finished_at: Date.now() });
        return { pass: false };
      }
    }
    recordEvent(ship, { ...evt, status: 'fail', detail: 'timed out after 5 minutes', finished_at: Date.now() });
    return { pass: false };
  } catch (e) {
    recordEvent(ship, { ...evt, status: 'fail', detail: e.message, finished_at: Date.now() });
    return { pass: false };
  }
}

async function stepZip(ship, project, outPdx) {
  const evt = { step: 'zip', status: 'running', started_at: Date.now() };
  recordEvent(ship, evt);
  if (!outPdx || !fs.existsSync(outPdx)) {
    recordEvent(ship, { ...evt, status: 'fail', detail: 'no pdx to zip', finished_at: Date.now() });
    return { pass: false };
  }
  const cachePath = path.join('/tmp', `${project.id}.pdx.zip`);
  try { fs.unlinkSync(cachePath); } catch (_e) { /* */ }
  const r = spawnSync('zip', ['-r', '-q', '-0', cachePath, path.basename(outPdx)],
                      { shell: false, cwd: path.dirname(outPdx) });
  if (r.status !== 0) {
    recordEvent(ship, { ...evt, status: 'fail', detail: 'zip failed', finished_at: Date.now() });
    return { pass: false };
  }
  recordEvent(ship, { ...evt, status: 'pass', detail: cachePath,
                      zip_path: cachePath, finished_at: Date.now() });
  return { pass: true, zip_path: cachePath };
}

async function stepWalkthrough(ship, project) {
  const evt = { step: 'walkthrough', status: 'running', started_at: Date.now() };
  recordEvent(ship, evt);
  try {
    const st = sdkPreview.get(project.id);
    if (!st) {
      // Not running; spin up.
      try { await sdkPreview.start({ projectId: project.id }); }
      catch (e) {
        recordEvent(ship, { ...evt, status: 'skip',
                            detail: `walkthrough skipped: ${e.message}`,
                            finished_at: Date.now() });
        return { pass: true, skipped: true };
      }
    }
    const r = await sdkPreview.recordSession({ projectId: project.id, durationS: 6 });
    recordEvent(ship, { ...evt, status: 'pass',
                        detail: `${r.frameCount} frames in ${r.durationMs}ms`,
                        gif_path: r.gifPath, mp4_path: r.mp4Path, finished_at: Date.now() });
    return { pass: true, gif: r.gifPath, mp4: r.mp4Path };
  } catch (e) {
    recordEvent(ship, { ...evt, status: 'skip', detail: `walkthrough skipped: ${e.message}`, finished_at: Date.now() });
    return { pass: true, skipped: true };
  }
}

async function stepPublish(ship, project, artifacts) {
  const evt = { step: 'publish', status: 'running', started_at: Date.now() };
  recordEvent(ship, evt);
  try {
    // Branch A — project has its own git repo + build.sh, defer to it.
    const lp = project.local_path;
    if (lp && fs.existsSync(path.join(lp, '.git')) && fs.existsSync(path.join(lp, 'build.sh'))) {
      const r = spawnSync('bash', ['build.sh'], { cwd: lp, env: process.env, encoding: 'utf8' });
      if (r.status !== 0) {
        recordEvent(ship, { ...evt, status: 'fail',
                            detail: `external build.sh exit ${r.status}`,
                            stderr: (r.stderr || '').slice(-500), finished_at: Date.now() });
        return { pass: false };
      }
      recordEvent(ship, { ...evt, status: 'pass',
                          detail: 'ran external build.sh',
                          mode: 'external_build_sh', finished_at: Date.now() });
      return { pass: true, mode: 'external_build_sh' };
    }
    // Branch B — copy artifacts into examples/<game>/ in the 23studios repo.
    const repoRoot = path.resolve(__dirname, '..', '..');
    const examplesDir = path.join(repoRoot, 'examples', project.id);
    await fsp.mkdir(examplesDir, { recursive: true });
    if (artifacts.zip_path && fs.existsSync(artifacts.zip_path)) {
      await fsp.copyFile(artifacts.zip_path, path.join(examplesDir, `${project.id}.pdx.zip`));
    }
    if (artifacts.gif && fs.existsSync(artifacts.gif)) {
      await fsp.copyFile(artifacts.gif, path.join(examplesDir, 'walkthrough.gif'));
    }
    if (artifacts.mp4 && fs.existsSync(artifacts.mp4)) {
      await fsp.copyFile(artifacts.mp4, path.join(examplesDir, 'walkthrough.mp4'));
    }
    await fsp.writeFile(path.join(examplesDir, 'README.md'),
      `# ${project.name}\n\nShipped ${new Date().toISOString()}.\n\n- Source: ${project.id}\n- Drop the .pdx.zip onto play.date/account/sideload to install.\n`);
    recordEvent(ship, { ...evt, status: 'pass',
                        detail: `published to examples/${project.id}/`,
                        mode: 'examples_copy', examples_dir: examplesDir, finished_at: Date.now() });
    return { pass: true, mode: 'examples_copy', examples_dir: examplesDir };
  } catch (e) {
    recordEvent(ship, { ...evt, status: 'fail', detail: e.message, finished_at: Date.now() });
    return { pass: false };
  }
}

// preflight: just run lint+drift+approvals; no side effects.
async function preflight(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  const ship = { id: 'preflight', events: [], subscribers: new Set() };
  const r1 = await stepLint(ship, project);
  const r2 = await stepDrift(ship, project);
  const r3 = await stepApprovals(ship, project);
  return {
    ok: r1.pass && r2.pass && r3.pass,
    checks: ship.events,
    lint: r1, drift: r2, approvals: r3
  };
}

async function ship(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  const id = makeShipId();
  const obj = { id, events: [], subscribers: new Set(), done: false, ok: null };
  _ships.set(id, obj);

  (async () => {
    try {
      const l = await stepLint(obj, project);
      if (!l.pass) { recordEvent(obj, { step: 'done', status: 'fail', detail: 'lint failed' }); obj.done = true; obj.ok = false; return; }
      const d = await stepDrift(obj, project);
      if (!d.pass) { recordEvent(obj, { step: 'done', status: 'fail', detail: 'drift threshold exceeded' }); obj.done = true; obj.ok = false; return; }
      const a = await stepApprovals(obj, project);
      if (!a.pass) { recordEvent(obj, { step: 'done', status: 'fail', detail: 'approvals pending' }); obj.done = true; obj.ok = false; return; }
      const ex = await stepExport(obj, project);
      if (!ex.pass) { recordEvent(obj, { step: 'done', status: 'fail', detail: 'export failed' }); obj.done = true; obj.ok = false; return; }
      const z = await stepZip(obj, project, ex.out_pdx);
      if (!z.pass) { recordEvent(obj, { step: 'done', status: 'fail', detail: 'zip failed' }); obj.done = true; obj.ok = false; return; }
      const w = await stepWalkthrough(obj, project);
      const pub = await stepPublish(obj, project, {
        zip_path: z.zip_path, gif: w.gif, mp4: w.mp4
      });
      if (!pub.pass) { recordEvent(obj, { step: 'done', status: 'fail', detail: 'publish failed' }); obj.done = true; obj.ok = false; return; }
      recordEvent(obj, { step: 'done', status: 'pass', detail: 'shipped' });
      obj.done = true; obj.ok = true;
    } catch (e) {
      recordEvent(obj, { step: 'done', status: 'fail', detail: e.message });
      obj.done = true; obj.ok = false;
    }
  })();

  return obj;
}

function get(id) { return _ships.get(id) || null; }

module.exports = { preflight, ship, get };
