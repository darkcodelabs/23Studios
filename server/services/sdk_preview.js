'use strict';

// sdk_preview.js — in-browser Playdate Simulator preview.
//
// Spawns the actual PlaydateSimulator binary inside a per-project Xvfb
// virtual display, captures the 400x240 viewport at ~15 fps, exposes the
// stream over WebSocket as base64 PNG frames, and routes input events
// (d-pad / A / B / crank / dock) via xdotool keystrokes into the Xvfb
// display.
//
// Resource model:
//   - One running simulator per project (kill + restart on rebuild).
//   - DISPLAY numbers allocated starting at :99 + slot offset.
//   - Frame capture via `import -window root -silent -crop WxH+x+y`
//     (ImageMagick) every 67ms. ffmpeg x11grab would be smoother but adds
//     a streaming protocol layer; periodic import is simpler + good enough.
//   - The simulator window's 400x240 viewport sits at known offsets in
//     the Playdate Simulator chrome — HAKCD's record_demo.sh uses
//     `crop=460:245:13:30`. We use 400x240 from a tighter offset since
//     the bezel illusion lives in our React PlaydateChassis, not in the
//     server crop.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const projects = require('./projects');
const sdkExport = require('./sdk_export');

const DEFAULT_FPS = 15;
// PlaydateSimulator on Linux always renders inside its chassis skin —
// there's no --no-skin flag, no separate LCD subwindow we can grab. So
// we capture the whole sim window as-is (chassis + LCD) and let the
// client render it at its natural aspect. If a tighter crop is wanted
// per skin, set the override envs.
const SIM_LCD_DX = process.env.PLAYDATE_SIM_LCD_DX != null
  ? Number(process.env.PLAYDATE_SIM_LCD_DX) : null;
const SIM_LCD_DY = process.env.PLAYDATE_SIM_LCD_DY != null
  ? Number(process.env.PLAYDATE_SIM_LCD_DY) : null;
const SIM_LCD_W = Number(process.env.PLAYDATE_SIM_LCD_W || 400);
const SIM_LCD_H = Number(process.env.PLAYDATE_SIM_LCD_H || 240);

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

// Per-project preview state. Cleaned up on stop.
const _previews = new Map();
// DISPLAY slot allocator: 99, 100, 101...
let _nextDisplay = 99;

function allocDisplay() {
  // Probe for an unused display number.
  while (true) {
    const n = _nextDisplay++;
    const lock = `/tmp/.X${n}-lock`;
    if (!fs.existsSync(lock)) return ':' + n;
    if (_nextDisplay > 150) {
      _nextDisplay = 99;
      throw new Error('no free DISPLAY slot');
    }
  }
}

// Wait for Xvfb to be ready (up to 3s).
async function waitForX(display) {
  for (let i = 0; i < 30; i++) {
    const r = spawnSync('xdpyinfo', ['-display', display], { encoding: 'utf8' });
    if (r.status === 0) return true;
    await new Promise((res) => setTimeout(res, 100));
  }
  return false;
}

// Find the latest pdx path for a project. Mirrors what /sdk/build/latest serves.
function latestPdx(projectId) {
  const jobs = sdkExport.getJobsByProject(projectId);
  const done = jobs.filter((j) => j.status === 'done')
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  if (done.length === 0) return null;
  const p = done[0].out_pdx;
  return p && fs.existsSync(p) ? p : null;
}

async function start({ projectId }) {
  if (_previews.has(projectId)) return _previews.get(projectId);

  const project = await projects.getProject(projectId);
  if (!project) throw Object.assign(new Error('not_found'), { status: 404 });
  if (project.game_type !== 'sdk') {
    throw Object.assign(new Error('not_sdk'), { status: 400 });
  }
  const pdx = latestPdx(projectId);
  if (!pdx) throw Object.assign(new Error('no_build'), { status: 409,
    detail: 'no completed export — build first' });
  const simBin = findSimulator();
  if (!simBin) throw Object.assign(new Error('no_simulator'), { status: 501,
    detail: 'set PLAYDATE_SDK_PATH' });
  if (!spawnSync('which', ['Xvfb']).stdout || !spawnSync('which', ['xdotool']).stdout) {
    throw Object.assign(new Error('missing_tools'), { status: 501,
      detail: 'install xvfb + xdotool on the host' });
  }

  const display = allocDisplay();
  const displayNum = display.slice(1);

  // Clean stale lock.
  try { fs.unlinkSync(`/tmp/.X${displayNum}-lock`); } catch (_e) { /* swallow */ }
  try { fs.unlinkSync(`/tmp/.X11-unix/X${displayNum}`); } catch (_e) { /* swallow */ }

  // Spawn Xvfb at 800x480x24 — generous room for sim window chrome.
  const xvfb = spawn('Xvfb', [display, '-screen', '0', '800x480x24', '-nolisten', 'tcp'],
                     { detached: false, stdio: ['ignore', 'ignore', 'pipe'] });
  xvfb.stderr.on('data', () => { /* swallow */ });

  const ok = await waitForX(display);
  if (!ok) {
    try { xvfb.kill('SIGTERM'); } catch (_e) { /* */ }
    throw new Error('Xvfb did not become ready');
  }

  // Spawn the simulator inside the virtual display, with the pdx as arg.
  const env = { ...process.env, DISPLAY: display };
  const sim = spawn(simBin, [pdx], { env, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
  sim.stdout.on('data', () => { /* swallow */ });
  sim.stderr.on('data', () => { /* swallow */ });

  // Give the sim a couple seconds to render its window.
  await new Promise((res) => setTimeout(res, 1500));

  // Resolve the sim window id once. Capture relative to it so LCD offsets
  // are window-local (chassis position within the Xvfb canvas can drift).
  function findSimWindow() {
    const r = spawnSync('xdotool', ['search', '--name', '^Playdate Simulator$'],
                        { env: { ...process.env, DISPLAY: display }, encoding: 'utf8' });
    if (r.status !== 0) return null;
    const ids = (r.stdout || '').trim().split(/\s+/).filter(Boolean);
    return ids[ids.length - 1] || null;
  }
  const simWinId = findSimWindow();

  const subscribers = new Set();
  let lastFrameMs = 0;
  let lastFrameBuf = null;
  let stopped = false;
  const recorders = new Set(); // each: { frames: [{ts, buf}] }

  // Capture loop. Uses ImageMagick `import` since it's installed; pipe to
  // base64 + push to subscribers.
  async function captureLoop() {
    const frameInterval = Math.round(1000 / DEFAULT_FPS);
    while (!stopped) {
      const since = Date.now() - lastFrameMs;
      if (since < frameInterval) {
        await new Promise((r) => setTimeout(r, frameInterval - since));
        continue;
      }
      lastFrameMs = Date.now();
      try {
        const buf = await new Promise((resolve, reject) => {
          const args = ['-display', display];
          if (simWinId) {
            args.push('-window', simWinId);
            if (SIM_LCD_DX != null && SIM_LCD_DY != null) {
              args.push('-crop', `${SIM_LCD_W}x${SIM_LCD_H}+${SIM_LCD_DX}+${SIM_LCD_DY}`);
            }
          } else {
            args.push('-window', 'root');
          }
          args.push('-silent', 'png:-');
          const imp = spawn('import', args, { stdio: ['ignore', 'pipe', 'pipe'] });
          const chunks = [];
          imp.stdout.on('data', (b) => chunks.push(b));
          imp.on('close', (code) => {
            if (code === 0) resolve(Buffer.concat(chunks));
            else reject(new Error('import exit ' + code));
          });
          imp.on('error', reject);
        });
        lastFrameBuf = buf;
        // Send PNG as a binary frame — no JSON wrap, no base64 expansion,
        // no chance of permessage-deflate flipping RSV1 on a text payload.
        // Browser decodes via URL.createObjectURL(new Blob([data])).
        for (const ws of subscribers) {
          try { ws.send(buf, { compress: false, binary: true }); }
          catch (_e) { /* dropped */ }
        }
        for (const rec of recorders) {
          rec.frames.push({ ts: Date.now(), buf });
          if (rec.frames.length > 1800) rec.frames.shift(); // cap ~2min @ 15fps
        }
      } catch (_e) { /* skip frame */ }
    }
  }

  const state = {
    projectId, display, simBin, pdxPath: pdx,
    xvfb, sim, subscribers, recorders, stopped: false,
    get lastFrame() { return lastFrameBuf; },
    subscribe(ws) {
      subscribers.add(ws);
      ws.on('close', () => subscribers.delete(ws));
    },
    sendKey(key) {
      try {
        spawnSync('xdotool', ['key', '--clearmodifiers', key], { env });
      } catch (_e) { /* swallow */ }
    },
    sendKeyDown(key) {
      try { spawnSync('xdotool', ['keydown', '--clearmodifiers', key], { env }); }
      catch (_e) { /* */ }
    },
    sendKeyUp(key) {
      try { spawnSync('xdotool', ['keyup', '--clearmodifiers', key], { env }); }
      catch (_e) { /* */ }
    },
    stop() {
      this.stopped = stopped = true;
      try { sim.kill('SIGTERM'); } catch (_e) { /* */ }
      try { xvfb.kill('SIGTERM'); } catch (_e) { /* */ }
      _previews.delete(projectId);
    }
  };
  _previews.set(projectId, state);
  captureLoop();

  sim.on('exit', () => state.stop());
  xvfb.on('exit', () => state.stop());

  return state;
}

function get(projectId) { return _previews.get(projectId) || null; }

function stop(projectId) {
  const s = _previews.get(projectId);
  if (s) s.stop();
}

// Map abstract input to the SDK simulator's key bindings:
//   arrows -> d-pad
//   z       -> A
//   x       -> B
//   ,       -> crank counter-clockwise (relative)
//   .       -> crank clockwise
//   d       -> dock/undock crank
const KEY_MAP = Object.freeze({
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  a: 'z', b: 'x',
  crank_ccw: 'comma', crank_cw: 'period',
  dock: 'd'
});

function mapKey(action) { return KEY_MAP[action] || null; }

// Record a session of `durationS` seconds against a running preview.
// Returns { gifPath, mp4Path, frameCount, durationMs }.
// Falls back gracefully when ffmpeg or ImageMagick (convert) are absent —
// emits whichever output succeeded; gifPath/mp4Path may be null.
async function recordSession({ projectId, durationS = 6 }) {
  const st = _previews.get(projectId);
  if (!st) {
    const e = new Error('preview_not_running');
    e.status = 409;
    throw e;
  }
  const dur = Math.max(1, Math.min(60, Math.floor(durationS) || 6));
  const rec = { frames: [] };
  st.recorders.add(rec);
  const startedAt = Date.now();
  await new Promise((r) => setTimeout(r, dur * 1000));
  st.recorders.delete(rec);
  const elapsed = Date.now() - startedAt;
  if (rec.frames.length === 0) {
    return { gifPath: null, mp4Path: null, frameCount: 0, durationMs: elapsed };
  }

  const outDir = path.join(os.tmpdir(), `23studios-record-${projectId}-${startedAt}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < rec.frames.length; i++) {
    const name = String(i).padStart(5, '0') + '.png';
    fs.writeFileSync(path.join(outDir, name), rec.frames[i].buf);
  }
  // Compute effective fps from real timestamps for accurate playback speed.
  const fps = Math.max(1, Math.round((rec.frames.length / elapsed) * 1000));

  const mp4Path = path.join(outDir, 'session.mp4');
  const gifPath = path.join(outDir, 'session.gif');

  // mp4 via ffmpeg
  const hasFfmpeg = spawnSync('which', ['ffmpeg']).status === 0;
  if (hasFfmpeg) {
    const r = spawnSync('ffmpeg', [
      '-y', '-framerate', String(fps),
      '-i', path.join(outDir, '%05d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      mp4Path
    ], { stdio: 'ignore' });
    if (r.status !== 0) try { fs.unlinkSync(mp4Path); } catch (_e) { /* */ }
  }

  // gif via ImageMagick convert
  const hasConvert = spawnSync('which', ['convert']).status === 0;
  if (hasConvert) {
    const r = spawnSync('convert', [
      '-delay', String(Math.max(2, Math.round(100 / fps))),
      '-loop', '0',
      path.join(outDir, '*.png'),
      gifPath
    ], { stdio: 'ignore' });
    if (r.status !== 0) try { fs.unlinkSync(gifPath); } catch (_e) { /* */ }
  }

  return {
    gifPath: fs.existsSync(gifPath) ? gifPath : null,
    mp4Path: fs.existsSync(mp4Path) ? mp4Path : null,
    frameCount: rec.frames.length,
    durationMs: elapsed,
    outDir
  };
}

module.exports = {
  start, stop, get, findSimulator, mapKey, recordSession
};
