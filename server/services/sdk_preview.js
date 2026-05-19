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
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const projects = require('./projects');
const sdkExport = require('./sdk_export');

const DEFAULT_FPS = 15;
const CAPTURE_W = 400;
const CAPTURE_H = 240;
// Sim chrome offsets — measured empirically from a default-skin sim window.
// May drift across SDK versions; if so, expose as env override.
const CAPTURE_X = 1;
const CAPTURE_Y = 1;

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

  const subscribers = new Set();
  let lastFrameMs = 0;
  let stopped = false;

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
          const imp = spawn('import', [
            '-display', display,
            '-window', 'root',
            '-crop', `${CAPTURE_W}x${CAPTURE_H}+${CAPTURE_X}+${CAPTURE_Y}`,
            '-silent',
            'png:-'
          ], { stdio: ['ignore', 'pipe', 'pipe'] });
          const chunks = [];
          imp.stdout.on('data', (b) => chunks.push(b));
          imp.on('close', (code) => {
            if (code === 0) resolve(Buffer.concat(chunks));
            else reject(new Error('import exit ' + code));
          });
          imp.on('error', reject);
        });
        // Send PNG as a binary frame — no JSON wrap, no base64 expansion,
        // no chance of permessage-deflate flipping RSV1 on a text payload.
        // Browser decodes via URL.createObjectURL(new Blob([data])).
        for (const ws of subscribers) {
          try { ws.send(buf, { compress: false, binary: true }); }
          catch (_e) { /* dropped */ }
        }
        // Stash latest frame for screenshot endpoint + recording.
        state.lastFrame = buf;
        if (state.recording && !state.recording.finished) {
          state.recording.frames.push(buf);
          if (state.recording.frames.length >= 900) {
            try { state.finishRecording(); } catch (_e) { /* */ }
          }
        }
      } catch (_e) { /* skip frame */ }
    }
  }

  const recDir = path.join(os.tmpdir(), '23studios_sim_rec', projectId);

  const state = {
    projectId, display, simBin, pdxPath: pdx,
    xvfb, sim, subscribers, stopped: false,
    lastFrame: null,
    recording: null,
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
    startRecording(durationS) {
      if (this.recording && !this.recording.finished) {
        const e = new Error('already_recording'); e.status = 409; throw e;
      }
      try { fs.mkdirSync(recDir, { recursive: true }); } catch (_e) { /* */ }
      try {
        for (const f of fs.readdirSync(recDir)) {
          if (/^frame\d+\.png$/.test(f) || /^out\.(gif|mp4)$/.test(f)) {
            try { fs.unlinkSync(path.join(recDir, f)); } catch (_e) { /* */ }
          }
        }
      } catch (_e) { /* */ }
      const dur = Math.max(1, Math.min(60, Number(durationS) || 10));
      this.recording = {
        id: crypto.randomBytes(4).toString('hex'),
        started_at: Date.now(),
        duration_s: dur,
        frames: [],
        dir: recDir,
        finished: false,
        gifPath: null,
        mp4Path: null,
        encodeError: null
      };
      const self = this;
      const t = setTimeout(() => {
        if (self.recording && !self.recording.finished) {
          try { self.finishRecording(); } catch (_e) { /* */ }
        }
      }, dur * 1000);
      if (t.unref) t.unref();
      return { id: this.recording.id, duration_s: dur };
    },
    finishRecording() {
      if (!this.recording || this.recording.finished) {
        return this.recording || null;
      }
      const rec = this.recording;
      rec.finished = true;
      for (let i = 0; i < rec.frames.length; i++) {
        const p = path.join(rec.dir, `frame${String(i + 1).padStart(4, '0')}.png`);
        try { fs.writeFileSync(p, rec.frames[i]); } catch (_e) { /* */ }
      }
      const count = rec.frames.length;
      rec.frame_count = count;
      rec.frames = [];
      if (count === 0) {
        rec.encodeError = 'no_frames_captured';
        return rec;
      }
      const fps = DEFAULT_FPS;
      const delayCs = Math.max(1, Math.round(100 / fps));
      const gifPath = path.join(rec.dir, 'out.gif');
      const mp4Path = path.join(rec.dir, 'out.mp4');
      try {
        const r1 = spawnSync('convert', [
          '-delay', String(delayCs), '-loop', '0',
          path.join(rec.dir, 'frame*.png'), gifPath
        ], { encoding: 'utf8', shell: false });
        if (r1.status === 0 && fs.existsSync(gifPath)) {
          rec.gifPath = gifPath;
          rec.gifBytes = fs.statSync(gifPath).size;
        } else {
          rec.encodeError = 'gif: ' + ((r1.stderr || '').slice(0, 200) || ('exit ' + r1.status));
        }
      } catch (e) { rec.encodeError = 'gif: ' + e.message; }
      try {
        const r2 = spawnSync('ffmpeg', [
          '-y', '-framerate', String(fps),
          '-i', path.join(rec.dir, 'frame%04d.png'),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          mp4Path
        ], { encoding: 'utf8', shell: false });
        if (r2.status === 0 && fs.existsSync(mp4Path)) {
          rec.mp4Path = mp4Path;
          rec.mp4Bytes = fs.statSync(mp4Path).size;
        } else {
          rec.encodeError = (rec.encodeError ? rec.encodeError + ' | ' : '')
            + 'mp4: ' + ((r2.stderr || '').slice(0, 200) || ('exit ' + r2.status));
        }
      } catch (e) {
        rec.encodeError = (rec.encodeError ? rec.encodeError + ' | ' : '') + 'mp4: ' + e.message;
      }
      return rec;
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

// Switch the sim entry point to a specific scene.
//
// Reads <project>/sdk_data/project.json, stashes original startup_scene
// to startup_scene_original (preserved across run_scene calls), sets
// startup_scene = sceneId, re-runs sdk_export, restarts preview.
//
// Caller is expected to provide a sceneId that exists in scenes[]; we
// only sanity-check existence and bail with 404 otherwise.
async function runScene({ projectId, sceneId }) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (project.game_type !== 'sdk') { const e = new Error('not_sdk'); e.status = 400; throw e; }
  if (!project.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  const sdkFile = path.join(project.local_path, 'sdk_data', 'project.json');
  if (!fs.existsSync(sdkFile)) { const e = new Error('no_sdk_data'); e.status = 409; throw e; }
  const data = JSON.parse(fs.readFileSync(sdkFile, 'utf8'));
  const exists = (data.scenes || []).some((s) => s && s.id === sceneId);
  if (!exists) { const e = new Error('scene_not_found'); e.status = 404; throw e; }
  // Preserve original startup_scene so /restore can put it back.
  if (!data.startup_scene_original) {
    data.startup_scene_original = data.startup_scene || (data.scenes[0] && data.scenes[0].id) || sceneId;
  }
  data.startup_scene = sceneId;
  fs.writeFileSync(sdkFile, JSON.stringify(data, null, 2));
  // Stop any current preview so the rebuild's pdx is loaded fresh.
  stop(projectId);
  // Kick off a fresh export. Wait for it to finish before returning so
  // the caller knows the sim can be restarted with the new entry point.
  const job = await sdkExport.startExport({ projectId });
  // sdkExport.startExport returns the job spec; the actual build runs async.
  // Poll the job until done OR fail OR 30s timeout.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const j = sdkExport.getJob(job.id);
    if (!j) break;
    if (j.status === 'done') return { ok: true, job_id: job.id, scene_id: sceneId };
    if (j.status === 'failed') {
      const e = new Error('export_failed'); e.status = 500;
      e.detail = j.error || 'unknown'; throw e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const e = new Error('export_timeout'); e.status = 504; throw e;
}

// Restore startup_scene to the originally-locked value (no rebuild kicked off;
// caller restarts the sim if they want the change to take effect).
async function restoreScene({ projectId }) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  const sdkFile = path.join(project.local_path, 'sdk_data', 'project.json');
  if (!fs.existsSync(sdkFile)) return { ok: true, noop: true };
  const data = JSON.parse(fs.readFileSync(sdkFile, 'utf8'));
  if (data.startup_scene_original) {
    data.startup_scene = data.startup_scene_original;
    delete data.startup_scene_original;
    fs.writeFileSync(sdkFile, JSON.stringify(data, null, 2));
    return { ok: true, restored_to: data.startup_scene };
  }
  return { ok: true, noop: true };
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

module.exports = {
  start, stop, get, findSimulator, mapKey, runScene, restoreScene
};
