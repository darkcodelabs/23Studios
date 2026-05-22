'use strict';

// build_events.js — Server-Sent Events feed for the Building screen.
//
//   GET /api/projects/:id/build/events
//
// Replaces the frontend's 3 s poll loop with a push stream so the
// "Building" screen lights up instantly when a milestone flips, an
// asset PNG lands, or an OpenRouter call gets billed.
//
// Three event sources, multiplexed onto one SSE connection:
//
//   event: spend     — new line tailed from sdk_data/openrouter_spend.jsonl
//   event: milestone — a milestone status.json mtime changed
//   event: asset     — a scene or character PNG was created / modified
//   event: hello     — emitted once on connect with { project_id, ts }
//
// Also emits a `: keepalive` comment line every 15 s so reverse proxies
// (CF Access, code-server) don't time out idle streams.
//
// Strategy: prefer the in-process logBus (server/services/logBus.js) when
// it has events flowing — it already fans chat + export signals to any
// subscriber. We hook into it AND run the filesystem watchers in parallel
// because the SDK autopilot writes files but doesn't emit on logBus today.
// When the two paths overlap, the frontend will dedupe in its handler.
//
// SSE pattern mirrors POST /api/projects/:id/sdk/autopilot in routes/
// sdk_autopilot.js:29-72 — headers (text/event-stream + no-cache +
// X-Accel-Buffering: no), flushHeaders(), heartbeat interval, and
// req.on('close') cleanup. The only deviation is GET (the spec is GET
// because SSE doesn't need a body).

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('../services/projects');
const { validateId } = require('../services/validation');

// Optional in-process bus — may be absent in some dev configs.
let logBus = null;
try { logBus = require('../services/logBus'); }
catch (_e) { logBus = null; }

const SDK_DATA_REL = 'sdk_data';
const SPEND_REL = 'openrouter_spend.jsonl';
const MILESTONES_REL = 'milestones';
const SCENES_REL = 'scenes';
const CHARS_REL = 'characters';

// Poll cadences — kept short enough to feel real-time, long enough that
// 50 open SSE clients per project don't smoke the disk.
const SPEND_POLL_MS = 2000;
const MILESTONE_POLL_MS = 2000;
const ASSET_POLL_MS = 2000;
const HEARTBEAT_MS = 15000;

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null
  });
}

// SSE write helpers. Both fail-soft because a dead client tripping
// these mid-event shouldn't take down the watchers.
function makeSafeWrite(res, closedRef) {
  return function safeWrite(event, data) {
    if (closedRef.closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_e) { /* swallow */ }
  };
}

// Snapshot the byte length of openrouter_spend.jsonl. New rows always
// land at the end; we tail from this offset.
async function fileLength(fp) {
  try {
    const s = await fsp.stat(fp);
    return s.size;
  } catch (_e) {
    return 0;
  }
}

// Read bytes [from, to) from a file, return decoded UTF-8 string.
async function readTail(fp, from, to) {
  if (from >= to) return '';
  let fh;
  try {
    fh = await fsp.open(fp, 'r');
    const len = to - from;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, from);
    return buf.toString('utf8');
  } catch (_e) {
    return '';
  } finally {
    if (fh) try { await fh.close(); } catch (_e) { /* ignore */ }
  }
}

// Snapshot the mtime ms for every milestone status.json that currently
// exists. Compared on the next tick to find changes.
async function snapshotMilestones(milestonesDir) {
  const out = {};
  if (!fs.existsSync(milestonesDir)) return out;
  let entries;
  try { entries = await fsp.readdir(milestonesDir, { withFileTypes: true }); }
  catch (_e) { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const statusFp = path.join(milestonesDir, e.name, 'status.json');
    try {
      const s = await fsp.stat(statusFp);
      out[e.name] = s.mtimeMs;
    } catch (_e) { /* missing is fine */ }
  }
  return out;
}

// Snapshot PNG mtimes inside scenes/ + characters/. Compared next tick.
async function snapshotAssetDir(dir, type) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (_e) { return out; }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith('.png')) continue;
    try {
      const s = await fsp.stat(path.join(dir, e.name));
      out[`${type}:${e.name.slice(0, -4)}`] = s.mtimeMs;
    } catch (_e) { /* skip */ }
  }
  return out;
}

// GET /api/projects/:id/build/events
router.get('/:id/build/events', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });

  let project;
  try {
    project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
  } catch (e) { return sendErr(res, e); }

  // Some projects haven't been provisioned on disk yet; we still want a
  // valid SSE stream (just won't emit asset/milestone events until the
  // local_path materializes). For now, the build screen only opens this
  // once a project has been built, so 422 here is appropriate-ish — but
  // returning a stream that only ever sends hello + heartbeat lets the
  // frontend handle the empty-project case uniformly.
  const localPath = project.local_path || null;
  const sdkDataDir = localPath ? path.join(localPath, SDK_DATA_REL) : null;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const closedRef = { closed: false };
  const safeWrite = makeSafeWrite(res, closedRef);

  // Heartbeat — comment line per the SSE spec; treated as a no-op event
  // by EventSource but keeps proxies from closing the socket.
  const heartbeat = setInterval(() => {
    if (closedRef.closed) return;
    try { res.write(`: keepalive ${Date.now()}\n\n`); } catch (_e) { /* ignore */ }
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  // logBus subscription — emits anything the in-process services already
  // publish (chat_*, export_*, etc.). Re-emit as a single `bus` event so
  // the frontend can fan out by `kind`.
  let unsubscribeBus = null;
  if (logBus && typeof logBus.subscribe === 'function') {
    try {
      unsubscribeBus = logBus.subscribe(project.id, (evt) => {
        safeWrite('bus', evt);
      });
    } catch (_e) { unsubscribeBus = null; }
  }

  // ---- Tail openrouter_spend.jsonl ------------------------------------
  let spendOffset = 0;
  let spendTimer = null;
  if (sdkDataDir) {
    const spendFp = path.join(sdkDataDir, SPEND_REL);
    spendOffset = await fileLength(spendFp);
    spendTimer = setInterval(async () => {
      if (closedRef.closed) return;
      const len = await fileLength(spendFp);
      if (len > spendOffset) {
        const chunk = await readTail(spendFp, spendOffset, len);
        spendOffset = len;
        // jsonl: one JSON object per line. Tolerate empty trailing line.
        const lines = chunk.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const row = JSON.parse(line);
            safeWrite('spend', row);
          } catch (_e) { /* skip unparsable lines */ }
        }
      } else if (len < spendOffset) {
        // File was rotated / truncated — reset.
        spendOffset = len;
      }
    }, SPEND_POLL_MS);
    if (spendTimer.unref) spendTimer.unref();
  }

  // ---- Watch milestone status.json mtimes ------------------------------
  let milestoneState = sdkDataDir
    ? await snapshotMilestones(path.join(sdkDataDir, MILESTONES_REL))
    : {};
  let milestoneTimer = null;
  if (sdkDataDir) {
    milestoneTimer = setInterval(async () => {
      if (closedRef.closed) return;
      const fresh = await snapshotMilestones(path.join(sdkDataDir, MILESTONES_REL));
      // Detect adds + mtime bumps.
      for (const [name, mtime] of Object.entries(fresh)) {
        if (milestoneState[name] !== mtime) {
          // Read the status.json body so the client can render the new state
          // without a follow-up fetch.
          let payload = null;
          try {
            const fp = path.join(sdkDataDir, MILESTONES_REL, name, 'status.json');
            payload = JSON.parse(await fsp.readFile(fp, 'utf8'));
          } catch (_e) { payload = null; }
          safeWrite('milestone', { name, mtime, status: payload });
        }
      }
      milestoneState = fresh;
    }, MILESTONE_POLL_MS);
    if (milestoneTimer.unref) milestoneTimer.unref();
  }

  // ---- Watch scene + character PNG mtimes ------------------------------
  let sceneState = sdkDataDir
    ? await snapshotAssetDir(path.join(sdkDataDir, SCENES_REL), 'scene')
    : {};
  let charState = sdkDataDir
    ? await snapshotAssetDir(path.join(sdkDataDir, CHARS_REL), 'portrait')
    : {};
  let assetTimer = null;
  if (sdkDataDir) {
    assetTimer = setInterval(async () => {
      if (closedRef.closed) return;
      const freshScenes = await snapshotAssetDir(path.join(sdkDataDir, SCENES_REL), 'scene');
      const freshChars = await snapshotAssetDir(path.join(sdkDataDir, CHARS_REL), 'portrait');

      function diffAndEmit(prev, next) {
        for (const [id, mtime] of Object.entries(next)) {
          if (prev[id] !== mtime) {
            const colonIdx = id.indexOf(':');
            const type = id.slice(0, colonIdx);
            const name = id.slice(colonIdx + 1);
            safeWrite('asset', { type, id: name, ts: mtime });
          }
        }
      }
      diffAndEmit(sceneState, freshScenes);
      diffAndEmit(charState, freshChars);
      sceneState = freshScenes;
      charState = freshChars;
    }, ASSET_POLL_MS);
    if (assetTimer.unref) assetTimer.unref();
  }

  // ---- Connect signal --------------------------------------------------
  safeWrite('hello', { project_id: project.id, ts: Date.now() });

  // ---- Cleanup ---------------------------------------------------------
  function finish() {
    if (closedRef.closed) return;
    closedRef.closed = true;
    clearInterval(heartbeat);
    if (spendTimer) clearInterval(spendTimer);
    if (milestoneTimer) clearInterval(milestoneTimer);
    if (assetTimer) clearInterval(assetTimer);
    if (typeof unsubscribeBus === 'function') {
      try { unsubscribeBus(); } catch (_e) { /* ignore */ }
    }
    try { res.end(); } catch (_e) { /* ignore */ }
  }
  req.on('close', finish);
  req.on('aborted', finish);
});

module.exports = router;
