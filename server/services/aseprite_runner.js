'use strict';

// Aseprite batch runner — executes LLM-generated Aseprite Lua scripts in a
// bubblewrap jail and collects the artifacts they produce. This is the
// execution half of the prompt→Aseprite pipeline; script *generation* lives
// in aseprite_script_gen.js.
//
// Security model: generated Lua runs with Aseprite's full io/os surface, so
// treat every script as untrusted code. The jail gives it:
//   - read-only /usr, /lib, /lib64, /etc/fonts (fontconfig)
//   - the aseprite install dir read-only
//   - ONE writable dir: the per-job workdir (bind-mounted as /job)
//   - no network (--unshare-net), new pid ns, dies with parent
//   - hard wall-clock timeout, SIGKILL on breach

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const logBus = require('./logBus');

const ASEPRITE_BIN = process.env.ASEPRITE_BIN ||
  '/home/hakcer/build/aseprite/build/bin/aseprite';
const BWRAP_BIN = process.env.BWRAP_BIN || 'bwrap';

const JOBS_ROOT = path.resolve(
  process.env.ASEPRITE_JOBS_ROOT ||
    path.join(__dirname, '..', 'data', 'aseprite_jobs')
);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_BYTES = 256 * 1024;
const ARTIFACT_EXTS = new Set(['.png', '.aseprite', '.ase', '.gif', '.json']);

function arErr(status, code, detail) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

function jobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

// Static screen of the Lua before it ever reaches the jail. The jail is the
// real boundary; this exists to fail fast + log what the model tried.
const FORBIDDEN_LUA = [
  /os\.execute/i,
  /io\.popen/i,
  /os\.remove/i,
  /os\.rename/i,
  /loadstring/i,
  /dofile\s*\(/i,
  /require\s*\(/i,
  /WebSocket/,
];

function screenScript(luaSource) {
  if (typeof luaSource !== 'string' || !luaSource.trim()) {
    throw arErr(400, 'empty_script');
  }
  if (Buffer.byteLength(luaSource, 'utf8') > MAX_SCRIPT_BYTES) {
    throw arErr(400, 'script_too_large');
  }
  const hits = FORBIDDEN_LUA.filter((re) => re.test(luaSource)).map(String);
  if (hits.length) {
    throw arErr(422, 'forbidden_lua_pattern', { patterns: hits });
  }
}

function bwrapArgs(jobDir, scriptNameInJob) {
  const aseDir = path.dirname(ASEPRITE_BIN);
  return [
    '--die-with-parent',
    '--unshare-all',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind-try', '/etc/fonts', '/etc/fonts',
    '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache',
    '--ro-bind', aseDir, aseDir,
    '--bind', jobDir, '/job',
    '--chdir', '/job',
    '--tmpfs', '/tmp',
    '--dev', '/dev',
    '--proc', '/proc',
    '--setenv', 'HOME', '/job',
    '--setenv', 'ASE_OUT_DIR', '/job',
    '--setenv', 'XDG_CONFIG_HOME', '/job/.config',
    ASEPRITE_BIN, '-b', '--script', `/job/${scriptNameInJob}`,
  ];
}

async function collectArtifacts(jobDir) {
  const out = [];
  const entries = await fsp.readdir(jobDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!ARTIFACT_EXTS.has(ext)) continue;
    if (ent.name === 'script.lua') continue;
    const abs = path.join(jobDir, ent.name);
    const stat = await fsp.stat(abs);
    out.push({ name: ent.name, path: abs, bytes: stat.size });
  }
  return out;
}

// Run one generated Lua script. Resolves with
// { jobId, ok, exitCode, stdout, stderr, artifacts, durationMs }.
// Never resolves ok:true unless aseprite exited 0 AND produced >=1 artifact.
async function runScript(luaSource, { projectId, timeoutMs = DEFAULT_TIMEOUT_MS, keepJob = false } = {}) {
  screenScript(luaSource);
  if (!fs.existsSync(ASEPRITE_BIN)) {
    throw arErr(500, 'aseprite_bin_missing', { bin: ASEPRITE_BIN });
  }

  const id = jobId();
  const jobDir = path.join(JOBS_ROOT, id);
  await fsp.mkdir(jobDir, { recursive: true });
  await fsp.writeFile(path.join(jobDir, 'script.lua'), luaSource, 'utf8');

  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(BWRAP_BIN, bwrapArgs(jobDir, 'script.lua'), {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (projectId) {
        logBus.emit(projectId, { kind: 'aseprite', stream: 'stderr', text: String(d).trimEnd() });
      }
    });
    child.on('error', (err) => {
      clearTimeout(killer);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\nspawn: ${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });

  const artifacts = await collectArtifacts(jobDir);
  const ok = result.exitCode === 0 && !result.timedOut && artifacts.length > 0;

  if (!ok && !keepJob) {
    // keep failed jobs for postmortem; only successful jobs are consumed
    // downstream and cleaned by the caller after ingest.
  }

  return {
    jobId: id,
    jobDir,
    ok,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    artifacts,
    durationMs: Date.now() - started,
  };
}

async function cleanupJob(id) {
  if (!/^job_[a-z0-9_]+$/.test(id)) throw arErr(400, 'bad_job_id');
  await fsp.rm(path.join(JOBS_ROOT, id), { recursive: true, force: true });
}

module.exports = {
  runScript,
  cleanupJob,
  screenScript,
  ASEPRITE_BIN,
  JOBS_ROOT,
};
