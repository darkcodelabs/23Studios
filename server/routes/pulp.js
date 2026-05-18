'use strict';

const express = require('express');

const pulp = require('../services/pulp_project');
const patrol = require('../services/pulp_patrol');

const router = express.Router({ mergeParams: true });

// Collection name (URL segment) -> internal key
const COLLECTION_ROUTE = {
  tiles: 'tiles',
  rooms: 'rooms',
  sounds: 'sounds',
  songs: 'songs'
};

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  // Log identifier + summary only; never log file contents.
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp]', id, e && (e.code || e.message) || 'unknown');
  return res.status(fallback).json({ error: 'server_error', id });
}

router.get('/:id/pulp', async (req, res) => {
  try {
    const r = await pulp.readPulp(req.params.id);
    res.json({ project: r.project, exists: r.exists });
  } catch (e) { sendErr(res, e); }
});

router.put('/:id/pulp', async (req, res) => {
  try {
    const project = await pulp.writeFullPulp(req.params.id, req.body);
    res.json({ project });
  } catch (e) { sendErr(res, e); }
});

router.patch('/:id/pulp', async (req, res) => {
  try {
    const project = await pulp.patchPulp(req.params.id, req.body);
    res.json({ project });
  } catch (e) { sendErr(res, e); }
});

for (const [seg, key] of Object.entries(COLLECTION_ROUTE)) {
  // singular label for response key
  const single = seg.replace(/s$/, '');

  router.get(`/:id/pulp/${seg}`, async (req, res) => {
    try {
      const list = await pulp.listCollection(req.params.id, key);
      res.json({ [seg]: list });
    } catch (e) { sendErr(res, e); }
  });

  router.post(`/:id/pulp/${seg}`, async (req, res) => {
    try {
      const item = await pulp.addCollectionItem(req.params.id, key, req.body);
      res.status(201).json({ [single]: item });
    } catch (e) { sendErr(res, e); }
  });

  router.patch(`/:id/pulp/${seg}/:tid`, async (req, res) => {
    try {
      const item = await pulp.patchCollectionItem(
        req.params.id, key, req.params.tid, req.body
      );
      res.json({ [single]: item });
    } catch (e) { sendErr(res, e); }
  });

  router.delete(`/:id/pulp/${seg}/:tid`, async (req, res) => {
    try {
      await pulp.deleteCollectionItem(req.params.id, key, req.params.tid);
      res.json({ ok: true });
    } catch (e) { sendErr(res, e); }
  });
}

// ----- Patrol: read-only scan -----
// POST so it stays inside the CSRF wall (csrfProtection rejects GET-style
// mutations only on POST/PUT/PATCH/DELETE; using POST keeps the pattern
// consistent with other AI-side endpoints and lets us add a payload later).
router.post('/:id/pulp/patrol', async (req, res) => {
  try {
    const r = await patrol.patrolProject(req.params.id);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

// ----- Patrol: regen all issues, SSE progress -----
router.post('/:id/pulp/patrol/regen', async (req, res) => {
  const projectId = req.params.id;
  const body = req.body || {};
  const kinds = Array.isArray(body.kinds) ? body.kinds.filter(
    (k) => k === 'tile' || k === 'scene' || k === 'character'
  ) : null;
  const concurrency = Number.isInteger(body.concurrency)
    ? Math.max(1, Math.min(8, body.concurrency)) : 4;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (closed) return;
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (_e) { /* ignore */ }
  }, 15000);
  if (heartbeat.unref) heartbeat.unref();

  function safeWrite(event, data) {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_e) { /* ignore write-after-close */ }
  }
  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { res.end(); } catch (_e) { /* ignore */ }
  }

  req.on('close', () => { closed = true; clearInterval(heartbeat); });

  try {
    const result = await patrol.regenAll(projectId, {
      kinds: kinds && kinds.length ? kinds : undefined,
      concurrency,
      onProgress: (ev) => safeWrite(ev.stage || 'progress', ev)
    });
    safeWrite('done', result);
  } catch (e) {
    safeWrite('error', {
      code: e && e.code || 'server_error',
      message: e && e.message || 'unknown',
      detail: e && e.detail || undefined
    });
  } finally {
    finish();
  }
});

// ----- Music: stream a rendered WAV for in-browser preview -----
// Path is intentionally narrow: only files inside the project's
// pulp_data/scene_music/ dir, only .wav, no traversal.
router.get('/:id/pulp/music/track/:name', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const projectsSvc = require('../services/projects');
    const project = await projectsSvc.getProject(req.params.id);
    if (!project || !project.local_path) return res.status(404).end();
    const name = String(req.params.name || '');
    if (!/^[A-Za-z0-9._-]{1,256}\.wav$/.test(name)) {
      return res.status(400).json({ error: 'bad_name' });
    }
    const full = path.join(project.local_path, 'pulp_data', 'scene_music', name);
    if (!full.startsWith(path.join(project.local_path, 'pulp_data', 'scene_music'))) {
      return res.status(400).json({ error: 'traversal' });
    }
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(full).pipe(res);
  } catch (e) { sendErr(res, e); }
});

// ----- Music: list per-room assignments -----
router.get('/:id/pulp/music', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const projectsSvc = require('../services/projects');
    const project = await projectsSvc.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    const { project: pulpFile } = await pulp.readPulp(req.params.id);
    const rooms = Array.isArray(pulpFile.rooms) ? pulpFile.rooms : [];
    const manifestPath = project.local_path
      ? path.join(project.local_path, 'pulp_data', 'scene_music', 'manifest.json')
      : null;
    let manifest = null;
    if (manifestPath && fs.existsSync(manifestPath)) {
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
      catch (_e) { manifest = null; }
    }
    const library = (manifest && Array.isArray(manifest.tracks)) ? manifest.tracks : [];
    const assignments = rooms.map((r) => ({
      room_id: r.id,
      room_name: r.name || r.id,
      bgm_file: r.bgm_file || null,
      bgm_track_id: r.bgm_track_id || null,
      track: r.bgm_track_id ? (library.find((t) => t.id === r.bgm_track_id) || null) : null
    }));
    const counts = {
      total_rooms: rooms.length,
      assigned: assignments.filter((a) => a.bgm_track_id).length,
      library_size: library.length
    };
    res.json({ counts, assignments, library_manifest_path: manifestPath || null });
  } catch (e) { sendErr(res, e); }
});

// ----- Music: re-assign (round-robin avoidance) -----
router.post('/:id/pulp/music/assign', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const projectsSvc = require('../services/projects');
    const musicLib = require('../services/music_library');
    const project = await projectsSvc.getProject(req.params.id);
    if (!project || !project.local_path) {
      return res.status(404).json({ error: 'not_found' });
    }
    const { project: pulpFile } = await pulp.readPulp(req.params.id);
    const rooms = Array.isArray(pulpFile.rooms) ? pulpFile.rooms : [];
    const destDir = path.join(project.local_path, 'pulp_data', 'scene_music');
    if (!fs.existsSync(path.join(destDir, 'manifest.json'))) {
      return res.status(409).json({ error: 'music_not_seeded',
        detail: 'run autopilot music_assign or POST /pulp/music/seed first' });
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(destDir, 'manifest.json'), 'utf8'));
    const library = manifest.tracks || [];
    const used = new Set();
    const out = [];
    for (const room of rooms) {
      const pick = musicLib.pickForScene({ library, scene: room, used });
      if (!pick.trackId) continue;
      used.add(pick.trackId);
      const track = library.find((t) => t.id === pick.trackId);
      const bgmFile = 'sounds/' + path.basename(track.wav);
      await pulp.patchRoom(req.params.id, room.id, {
        bgm_file: bgmFile, bgm_track_id: track.id
      });
      out.push({ room_id: room.id, track_id: track.id, bgm_file: bgmFile });
    }
    res.json({ assigned: out.length, total: rooms.length, assignments: out });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
