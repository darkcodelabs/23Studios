'use strict';

// sdk_smoketest.js — boot-probe a .pdx in a headless Playdate Simulator,
// watch stdout/stderr for runtime errors, return a structured report.
//
// Used by:
//   - sdk_milestones.runMilestone (after pdc succeeds, run smoketest)
//   - sdk_release_packager.pack   (block release if release_candidate fails)
//
// Strategy:
//   1. Spawn Xvfb on a free DISPLAY slot (mirrors sdk_preview).
//   2. Spawn PlaydateSimulator <pdx> with DISPLAY pointed at Xvfb.
//   3. Watch stderr + stdout for N seconds (default 8).
//   4. Match against ERROR_PATTERNS; if any match, fail.
//   5. Match against FRAME_PATTERNS to count frames printed by the sim.
//   6. Kill sim + Xvfb. Return { ok, booted, duration_ms, errors, warnings, frame_count, est_fps }.
//
// Note: this is a STATIC boot probe. We don't drive inputs — we just
// confirm the title screen renders + the update loop doesn't throw.
// Frame count is best-effort (the sim only emits "fps: N" when the game
// itself prints it via playdate.drawFPS or playdate.system.getStats()).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_DURATION_MS = 8000;
const DEFAULT_XVFB_GEOMETRY = '800x480x24';

const SIM_PATH_CANDIDATES = [
  process.env.PLAYDATE_SDK_PATH && path.join(process.env.PLAYDATE_SDK_PATH, 'bin', 'PlaydateSimulator'),
  path.join(os.homedir(), 'PlaydateSDK', 'bin', 'PlaydateSimulator'),
  path.join(os.homedir(), 'Developer', 'PlaydateSDK', 'bin', 'PlaydateSimulator'),
  '/opt/PlaydateSDK/bin/PlaydateSimulator'
].filter(Boolean);

function findSimulator() {
  for (const c of SIM_PATH_CANDIDATES) {
    if (fs.existsSync(c) && fs.statSync(c).mode & 0o111) return c;
  }
  return null;
}

// Lua / C error patterns the sim prints when something goes wrong.
const ERROR_PATTERNS = [
  /\bLua error\b/i,
  /\battempt to (?:index|call|concatenate|perform arithmetic) /i,
  /\bstack traceback\b/i,
  /\bfailed to load\b/i,
  /\bsegmentation fault\b/i,
  /\bassertion failed\b/i,
  /\bgame crashed\b/i,
  /\bbad argument\b/i,
  /\bcannot open\b.*\.lua/i
];

// Soft-warn but don't fail.
const WARNING_PATTERNS = [
  /\bdeprecated\b/i,
  /\bperformance warning\b/i,
  /\bdropped frame\b/i,
  /\bmissing asset\b/i
];

// Sim prints frame stats when the game enables them. We grep both.
const FRAME_PATTERNS = [
  /\bfps[:=\s]+(\d+(?:\.\d+)?)/i,
  /\bframes?[:=\s]+(\d+)/i
];

let _nextDisplay = 199; // separate range from sdk_preview to avoid contention.

function allocDisplay() {
  for (let i = 0; i < 50; i++) {
    const n = _nextDisplay++;
    if (_nextDisplay > 250) _nextDisplay = 199;
    if (!fs.existsSync(`/tmp/.X${n}-lock`)) return ':' + n;
  }
  throw new Error('no free DISPLAY slot');
}

async function waitForX(display, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = spawnSync('xdpyinfo', ['-display', display], { encoding: 'utf8' });
    if (r.status === 0) return true;
    await new Promise((res) => setTimeout(res, 100));
  }
  return false;
}

/**
 * probe(pdxPath, opts?)
 *   opts.durationMs    — how long to watch (default 8000)
 *   opts.simBin        — override sim binary path
 *   opts.skipIfMissing — if true and sim/Xvfb absent, return { ok: true, skipped: true }
 *                        (default false — strict gate)
 *
 * Returns { ok, booted, duration_ms, errors[], warnings[], frame_count, est_fps,
 *           skipped?, reason? }.
 */
async function probe(pdxPath, opts = {}) {
  const durationMs = Number(opts.durationMs) || DEFAULT_DURATION_MS;
  const skipIfMissing = !!opts.skipIfMissing;

  if (!pdxPath || !fs.existsSync(pdxPath)) {
    return { ok: false, booted: false, duration_ms: 0, errors: ['pdx_not_found:' + pdxPath],
             warnings: [], frame_count: 0, est_fps: null };
  }

  const simBinCandidate = opts.simBin || findSimulator();
  // Validate the binary exists + is executable. An explicitly-passed bad
  // path (test fixtures / misconfig) should fall into the no_simulator
  // branch, not throw an async spawn ENOENT.
  const simBin = (simBinCandidate && fs.existsSync(simBinCandidate)) ? simBinCandidate : null;
  if (!simBin) {
    if (skipIfMissing) return { ok: true, skipped: true, booted: false, duration_ms: 0,
                                errors: [], warnings: [], frame_count: 0, est_fps: null,
                                reason: 'no_simulator' };
    return { ok: false, booted: false, duration_ms: 0,
             errors: ['no_simulator (set PLAYDATE_SDK_PATH)'],
             warnings: [], frame_count: 0, est_fps: null };
  }

  if (!spawnSync('which', ['Xvfb']).stdout.toString().trim() ||
      !spawnSync('which', ['xdpyinfo']).stdout.toString().trim()) {
    if (skipIfMissing) return { ok: true, skipped: true, booted: false, duration_ms: 0,
                                errors: [], warnings: [], frame_count: 0, est_fps: null,
                                reason: 'no_xvfb' };
    return { ok: false, booted: false, duration_ms: 0,
             errors: ['missing Xvfb / xdpyinfo'],
             warnings: [], frame_count: 0, est_fps: null };
  }

  const display = allocDisplay();
  const displayNum = display.slice(1);
  try { fs.unlinkSync(`/tmp/.X${displayNum}-lock`); } catch (_e) { /* */ }

  const xvfb = spawn('Xvfb', [display, '-screen', '0', DEFAULT_XVFB_GEOMETRY, '-nolisten', 'tcp'],
                     { detached: false, stdio: ['ignore', 'ignore', 'pipe'] });
  xvfb.stderr.on('data', () => { /* swallow */ });

  const xvfbReady = await waitForX(display);
  if (!xvfbReady) {
    try { xvfb.kill('SIGTERM'); } catch (_e) { /* */ }
    return { ok: false, booted: false, duration_ms: 0,
             errors: ['xvfb_not_ready'], warnings: [], frame_count: 0, est_fps: null };
  }

  const env = { ...process.env, DISPLAY: display };
  const sim = spawn(simBin, [pdxPath], { env, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });

  const errors = new Set();
  const warnings = new Set();
  let frame_count = 0;
  let est_fps_max = null;
  let booted = false;
  const start = Date.now();

  function ingest(buf) {
    const text = buf.toString();
    for (const p of ERROR_PATTERNS) {
      const m = text.match(p);
      if (m) errors.add(m[0].slice(0, 200));
    }
    for (const p of WARNING_PATTERNS) {
      const m = text.match(p);
      if (m) warnings.add(m[0].slice(0, 200));
    }
    for (const p of FRAME_PATTERNS) {
      const m = text.match(p);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) {
          frame_count += 1;
          if (n > (est_fps_max || 0)) est_fps_max = n;
        }
      }
    }
    // Boot heuristic: sim prints "Starting" or "Lua: " or "Playdate" early on stdout.
    if (!booted && /\b(?:Starting|Playdate|Lua:|PDC|loading)\b/i.test(text)) booted = true;
  }
  sim.stdout.on('data', ingest);
  sim.stderr.on('data', ingest);

  let simExited = null;
  sim.on('exit', (code) => { simExited = code; });

  // Sleep until duration elapsed OR sim died.
  await new Promise((res) => {
    const t = setTimeout(res, durationMs);
    sim.on('exit', () => { clearTimeout(t); res(); });
  });

  const duration_ms = Date.now() - start;

  // Confirm a window appeared in Xvfb as a secondary boot signal.
  try {
    const r = spawnSync('xdotool', ['search', '--name', '^Playdate Simulator$'],
                        { env, encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim()) booted = true;
  } catch (_e) { /* xdotool optional */ }

  try { sim.kill('SIGTERM'); } catch (_e) { /* */ }
  try { xvfb.kill('SIGTERM'); } catch (_e) { /* */ }

  // If the sim exited non-zero before the duration, that's a fail.
  if (simExited != null && simExited !== 0) {
    errors.add('sim_exited_code_' + simExited);
  }

  const ok = errors.size === 0 && booted;
  return {
    ok,
    booted,
    duration_ms,
    errors: [...errors],
    warnings: [...warnings],
    frame_count,
    est_fps: est_fps_max
  };
}

module.exports = { probe, findSimulator };
