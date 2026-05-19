'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { WebSocketServer } = require('ws');
const sdkAutopilot = require('../services/sdk_autopilot');
const sdkExport = require('../services/sdk_export');
const sdkPreview = require('../services/sdk_preview');
const projects = require('../services/projects');
const pulpAi = require('../services/pulp_ai');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: e && e.code || 'server_error', detail: e && e.message });
}

// POST /api/projects/:id/sdk/autopilot  body: { pitch }  -> SSE stream
router.post('/:id/sdk/autopilot', (req, res) => {
  const projectId = req.params.id;
  const pitch = String((req.body && req.body.pitch) || '').trim();
  if (!pitch) return res.status(400).json({ error: 'bad_request', detail: 'pitch required' });

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
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch (_e) { /* ignore */ }
  }
  function finish() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { res.end(); } catch (_e) { /* ignore */ }
  }
  req.on('close', () => { closed = true; clearInterval(heartbeat); });

  try {
    const { awaitDone } = sdkAutopilot.startSdkAutopilot({
      projectId, pitch,
      onEvent: (evt, data) => safeWrite(evt, data || {})
    });
    awaitDone.then(() => finish(), () => finish());
  } catch (e) {
    if (!res.headersSent) return sendErr(res, e);
    safeWrite('error', { message: e.code || e.message });
    finish();
  }
});

// POST /api/projects/:id/sdk/export  -> { job_id, status_url, download_url }
router.post('/:id/sdk/export', async (req, res) => {
  try {
    const job = await sdkExport.startExport({ projectId: req.params.id });
    res.status(202).json({
      job_id: job.id,
      status_url: `/api/projects/${req.params.id}/sdk/export/jobs/${job.id}`,
      download_url: `/api/projects/${req.params.id}/sdk/export/jobs/${job.id}/download`
    });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/sdk/export/jobs/:jobId  -> status snapshot
router.get('/:id/sdk/export/jobs/:jobId', (req, res) => {
  const j = sdkExport.getJob(req.params.jobId);
  if (!j) return res.status(404).json({ error: 'not_found' });
  res.json(j);
});

// GET /api/projects/:id/sdk/export/jobs/:jobId/download
// Serves the .pdx as a ZIP (the format the Playdate sideloader expects).
// Cached at /tmp/<id>.pdx.zip; rebuilt only when the pdx directory mtime
// is newer than the cache. Served as a static file so HTTP Range works
// (resumable through reverse proxies + browser shows real progress bar).
router.get('/:id/sdk/export/jobs/:jobId/download', (req, res) => {
  const j = sdkExport.getJob(req.params.jobId);
  if (!j) return res.status(404).end();
  if (j.status !== 'done') {
    if (j.status === 'failed') return res.status(500).json({ error: 'export_failed', detail: j.error });
    return res.status(202).json({ status: j.status });
  }
  const path = require('path');
  const fs = require('fs');
  const outPdx = j.out_pdx;
  if (!outPdx || !fs.existsSync(outPdx)) return res.status(404).end();

  const baseName = `${req.params.id}.pdx.zip`;
  const cachePath = path.join('/tmp', baseName);

  let cacheValid = false;
  try {
    if (fs.existsSync(cachePath)) {
      const cs = fs.statSync(cachePath);
      const ps = fs.statSync(outPdx);
      cacheValid = cs.mtimeMs >= ps.mtimeMs;
    }
  } catch (_e) { cacheValid = false; }

  if (!cacheValid) {
    // Delete stale cache so the zip is clean.
    try { fs.unlinkSync(cachePath); } catch (_e) { /* */ }
    const { spawnSync } = require('child_process');
    // -r recursive, -q quiet, -0 store-no-compression (audio + images are
    // already compressed; the .pdz Lua bundles are tiny — zip's deflate
    // wins ~5% on those but spends 5x the time. Store = fast cache builds.)
    const r = spawnSync('zip', ['-r', '-q', '-0', cachePath, path.basename(outPdx)],
                        { shell: false, cwd: path.dirname(outPdx) });
    if (r.status !== 0) {
      const detail = (r.stderr && r.stderr.toString()) || ('zip exit ' + r.status);
      return res.status(500).json({ error: 'zip_build_failed', detail });
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(cachePath);
});

// GET /api/projects/:id/sdk/build/status -> a compact health snapshot the
// UI polls + uses to gate the download / simulator buttons.
router.get('/:id/sdk/build/status', (req, res) => {
  const fs = require('fs');
  const jobs = sdkExport.getJobsByProject(req.params.id);
  if (jobs.length === 0) {
    return res.json({ has_build: false, status: 'never_built',
                      hint: 'click "build .pdx" to compile' });
  }
  const done = jobs.filter((j) => j.status === 'done')
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  const j = done[0] || jobs[0];
  const out = {
    has_build: !!done[0],
    status: j.status,
    job_id: j.id,
    started_at: j.started_at,
    error: j.error || null,
    out_pdx: j.out_pdx || null,
    pdx_exists: !!(j.out_pdx && fs.existsSync(j.out_pdx))
  };
  if (out.has_build) {
    out.download_url = `/api/projects/${req.params.id}/sdk/export/jobs/${j.id}/download`;
    // Cached zip size hint so the UI can show "Download (30 MB)".
    const cachePath = require('path').join('/tmp', `${req.params.id}.pdx.zip`);
    try {
      if (fs.existsSync(cachePath)) {
        out.cached_zip_bytes = fs.statSync(cachePath).size;
        // Back-compat key the UI used before — keep both for now.
        out.cached_tar_bytes = out.cached_zip_bytes;
      }
    } catch (_e) { /* */ }
  }
  res.json(out);
});

// GET /api/projects/:id/sdk/build/latest -> the most recent done export job
router.get('/:id/sdk/build/latest', (req, res) => {
  const jobs = sdkExport.getJobsByProject(req.params.id);
  const done = jobs.filter((j) => j.status === 'done')
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  if (done.length === 0) return res.status(404).json({ error: 'no_build' });
  const j = done[0];
  res.json({
    job_id: j.id,
    status: j.status,
    out_pdx: j.out_pdx,
    started_at: j.started_at,
    download_url: `/api/projects/${req.params.id}/sdk/export/jobs/${j.id}/download`
  });
});

// POST /api/projects/:id/sdk/simulator -> spawn local Playdate Simulator
// against the latest built .pdx. Detects the SDK install + display.
router.post('/:id/sdk/simulator', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { spawn } = require('child_process');

    const jobs = sdkExport.getJobsByProject(req.params.id);
    const done = jobs.filter((j) => j.status === 'done')
      .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
    if (done.length === 0) {
      return res.status(409).json({ error: 'no_build',
        detail: 'no completed export to launch — run /sdk/export first' });
    }
    const outPdx = done[0].out_pdx;
    if (!outPdx || !fs.existsSync(outPdx)) {
      return res.status(404).json({ error: 'pdx_missing', detail: outPdx });
    }

    // Resolve simulator binary. Try SDK install paths, then macOS open.
    const sdkRoot = process.env.PLAYDATE_SDK_PATH
      || path.join(os.homedir(), 'Developer', 'PlaydateSDK')
      || '/opt/PlaydateSDK';
    const candidates = [
      path.join(sdkRoot, 'bin', 'PlaydateSimulator'),
      '/Applications/Playdate Simulator.app/Contents/MacOS/Playdate Simulator',
      '/opt/PlaydateSDK/bin/PlaydateSimulator'
    ];
    const simBin = candidates.find((c) => fs.existsSync(c));
    if (!simBin) {
      return res.status(501).json({ error: 'simulator_not_installed',
        detail: 'set PLAYDATE_SDK_PATH or install the Playdate SDK' });
    }

    // On headless Linux (no DISPLAY), spawning the simulator will fail. Detect
    // + report rather than fork into the void.
    if (process.platform === 'linux' && !process.env.DISPLAY) {
      return res.status(503).json({ error: 'no_display',
        detail: 'simulator needs an X display (DISPLAY env var)',
        bin: simBin, pdx: outPdx });
    }

    const child = spawn(simBin, [outPdx], { detached: true, stdio: 'ignore' });
    child.unref();
    res.json({ launched: true, pid: child.pid, bin: simBin, pdx: outPdx });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/sdk/preview/start -> spawn Xvfb + simulator
router.post('/:id/sdk/preview/start', async (req, res) => {
  try {
    const st = await sdkPreview.start({ projectId: req.params.id });
    res.json({ ok: true, display: st.display, pdx: st.pdxPath });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/sdk/preview/stop
router.post('/:id/sdk/preview/stop', (req, res) => {
  sdkPreview.stop(req.params.id);
  res.json({ ok: true });
});

// POST /api/projects/:id/sdk/preview/run_scene  body: { scene_id }
//   Updates sdk_data/project.json startup_scene to scene_id, kicks a fresh
//   build, then (re)starts the preview against the rebuilt .pdx. Used by
//   the B2 SceneManager "Run" button to jump straight into the scene under
//   edit. Returns { ok, scene_id, job_id, status_url }.
router.post('/:id/sdk/preview/run_scene', async (req, res) => {
  try {
    const sceneId = String((req.body && req.body.scene_id) || '').trim();
    if (!sceneId) return res.status(400).json({ error: 'bad_request', detail: 'scene_id required' });
    const { project, sdkFile, data } = await readSdkProject(req.params.id);
    const sceneExists = (data.scenes || []).some((s) => s.id === sceneId);
    if (!sceneExists) return res.status(404).json({ error: 'scene_not_found', detail: sceneId });
    data.startup_scene = sceneId;
    await writeSdkProject(sdkFile, data);
    // Stop any active preview so the next start picks up the rebuilt pdx.
    sdkPreview.stop(project.id);
    const job = await sdkExport.startExport({ projectId: project.id });
    res.json({
      ok: true,
      scene_id: sceneId,
      job_id: job.id,
      status_url: `/api/projects/${project.id}/sdk/export/jobs/${job.id}`
    });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/sdk/preview/record_session  body: { duration_s }
//   Records the running preview for duration_s (1-60), encodes a gif via
//   ImageMagick and an mp4 via ffmpeg. Returns absolute paths + a server-
//   relative download URL the UI can hit.
router.post('/:id/sdk/preview/record_session', async (req, res) => {
  try {
    const durationS = Number((req.body && req.body.duration_s) || 6);
    const r = await sdkPreview.recordSession({ projectId: req.params.id, durationS });
    res.json({
      ok: true,
      frame_count: r.frameCount,
      duration_ms: r.durationMs,
      gif_url: r.gifPath ? `/api/projects/${req.params.id}/sdk/preview/recording/gif?ts=${Date.now()}` : null,
      mp4_url: r.mp4Path ? `/api/projects/${req.params.id}/sdk/preview/recording/mp4?ts=${Date.now()}` : null,
      gif_path: r.gifPath, mp4_path: r.mp4Path
    });
    // Stash the latest recording paths on the preview state so the GET
    // routes below can find them again.
    const st = sdkPreview.get(req.params.id);
    if (st) st.lastRecording = { gif: r.gifPath, mp4: r.mp4Path };
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/sdk/preview/recording/:fmt', (req, res) => {
  const st = sdkPreview.get(req.params.id);
  if (!st || !st.lastRecording) return res.status(404).end();
  const p = req.params.fmt === 'gif' ? st.lastRecording.gif : st.lastRecording.mp4;
  if (!p || !fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Content-Type', req.params.fmt === 'gif' ? 'image/gif' : 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=60');
  fs.createReadStream(p).pipe(res);
});

// GET /api/projects/:id/sdk/preview/last_frame -> PNG of most recent frame.
router.get('/:id/sdk/preview/last_frame', (req, res) => {
  const st = sdkPreview.get(req.params.id);
  if (!st || !st.lastFrame) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.end(st.lastFrame);
});

// POST /api/projects/:id/sdk/preview/input  body: { action: 'a'|'b'|'up'|... }
router.post('/:id/sdk/preview/input', (req, res) => {
  try {
    const st = sdkPreview.get(req.params.id);
    if (!st) return res.status(409).json({ error: 'preview_not_running' });
    const action = String((req.body && req.body.action) || '');
    const key = sdkPreview.mapKey(action);
    if (!key) return res.status(400).json({ error: 'unknown_action' });
    st.sendKey(key);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// WS install — separate from the express router; the index.js bootstrap
// reaches in via installPreviewWs(server) below.
function installPreviewWs(server) {
  const wss = new WebSocketServer({
    noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false
  });
  wss.on('connection', async (ws, req) => {
    const projectId = req._projectId;
    console.log('[sdk_preview ws] connect project=' + projectId
      + ' ext=' + JSON.stringify(ws.extensions || {})
      + ' deflate=' + (!!ws._receiver && !!ws._receiver._extensions && !!ws._receiver._extensions['permessage-deflate']));
    try {
      const st = await sdkPreview.start({ projectId });
      st.subscribe(ws);
      ws.send(JSON.stringify({ t: 'ready', display: st.display, pdx: st.pdxPath }),
              { compress: false, binary: false });
    } catch (e) {
      console.log('[sdk_preview ws] start failed: ' + e.message);
      try { ws.send(JSON.stringify({ t: 'error', message: e.message, code: e.code }),
                    { compress: false }); } catch (_e) { /* */ }
      try { ws.close(); } catch (_e) { /* */ }
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const m = url.match(/^\/ws\/sdk\/preview\/([A-Za-z0-9_-]{1,80})(?:\?.*)?$/);
    if (!m) return;
    req._projectId = m[1];
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

// ----- SDK project editor -------------------------------------------------
//
// Inline editing of sdk_data/project.json (title, description, per-scene
// name/description/style_reference, character bio/portrait_prompt) +
// per-asset regen endpoints. The autopilot drops the canonical project
// state at <local_path>/sdk_data/project.json; we read + mutate it here.

async function readSdkProject(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) { const e = new Error('not_found'); e.status = 404; throw e; }
  if (project.game_type !== 'sdk') { const e = new Error('not_sdk'); e.status = 400; throw e; }
  if (!project.local_path) { const e = new Error('no_local_path'); e.status = 500; throw e; }
  const sdkFile = path.join(project.local_path, 'sdk_data', 'project.json');
  if (!fs.existsSync(sdkFile)) return { project, sdkFile, data: { scenes: [], characters: [] } };
  const data = JSON.parse(await fsp.readFile(sdkFile, 'utf8'));
  return { project, sdkFile, data };
}

async function writeSdkProject(sdkFile, data) {
  await fsp.writeFile(sdkFile, JSON.stringify(data, null, 2));
}

// GET /api/projects/:id/sdk/project — full editable snapshot
router.get('/:id/sdk/project', async (req, res) => {
  try {
    const { project, data } = await readSdkProject(req.params.id);
    res.json({
      id: project.id,
      name: project.name,
      description: project.description,
      local_path: project.local_path,
      startup_scene: data.startup_scene || null,
      scenes: (data.scenes || []).map((s) => ({
        id: s.id, name: s.name, description: s.description,
        style_reference: s.style_reference || null,
        bgm_track_id: s.bgm_track_id || null,
        bgm_file: s.bgm_file || null,
        has_lua: !!(s.lua && s.lua.length > 0)
      })),
      characters: (data.characters || []).map((c) => ({
        id: c.id, name: c.name, role: c.role, bio: c.bio,
        portrait_prompt: c.portrait_prompt || ''
      })),
      outline: data.outline || '',
      brainstorm: data.brainstorm || ''
    });
  } catch (e) { sendErr(res, e); }
});

// PATCH /api/projects/:id/sdk/project — partial update
// Body shape (all optional):
//   { name?, description?, startup_scene?, scenes?: [{id, name?, description?, style_reference?}], characters?: [{id, name?, role?, bio?, portrait_prompt?}] }
router.patch('/:id/sdk/project', async (req, res) => {
  try {
    const body = req.body || {};
    const { project, sdkFile, data } = await readSdkProject(req.params.id);

    // Project-level fields persisted to the projects.json registry, not sdk_data.
    const projPatch = {};
    if (typeof body.name === 'string') projPatch.name = body.name.slice(0, 256);
    if (typeof body.description === 'string') projPatch.description = body.description.slice(0, 4000);
    if (Object.keys(projPatch).length > 0) {
      await projects.patchProject(project.id, projPatch);
    }

    if (typeof body.startup_scene === 'string') data.startup_scene = body.startup_scene;

    // Scene patches indexed by id.
    if (Array.isArray(body.scenes)) {
      const byId = new Map((data.scenes || []).map((s, i) => [s.id, i]));
      for (const patch of body.scenes) {
        if (!patch || !patch.id || !byId.has(patch.id)) continue;
        const idx = byId.get(patch.id);
        const s = data.scenes[idx];
        if (typeof patch.name === 'string') s.name = patch.name.slice(0, 256);
        if (typeof patch.description === 'string') s.description = patch.description.slice(0, 4000);
        if (typeof patch.style_reference === 'string' || patch.style_reference === null) {
          s.style_reference = patch.style_reference || null;
        }
      }
    }

    if (Array.isArray(body.characters)) {
      const byId = new Map((data.characters || []).map((c, i) => [c.id, i]));
      for (const patch of body.characters) {
        if (!patch || !patch.id || !byId.has(patch.id)) continue;
        const idx = byId.get(patch.id);
        const c = data.characters[idx];
        if (typeof patch.name === 'string') c.name = patch.name.slice(0, 256);
        if (typeof patch.role === 'string') c.role = patch.role.slice(0, 256);
        if (typeof patch.bio === 'string') c.bio = patch.bio.slice(0, 4000);
        if (typeof patch.portrait_prompt === 'string') c.portrait_prompt = patch.portrait_prompt.slice(0, 4000);
      }
    }

    await writeSdkProject(sdkFile, data);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/sdk/scenes/:sceneId/regen-bg
// Re-runs pulpAi.generateScene with the current (possibly edited) scene
// description and overwrites sdk_data/scenes/<sceneId>.png.
router.post('/:id/sdk/scenes/:sceneId/regen-bg', async (req, res) => {
  try {
    const { project, data } = await readSdkProject(req.params.id);
    const scene = (data.scenes || []).find((s) => s.id === req.params.sceneId);
    if (!scene) return res.status(404).json({ error: 'scene_not_found' });
    const prompt = `${scene.name}. ${scene.description || ''} ` +
      `IMPORTANT: this is an EMPTY scene background — NO human figure, NO player, ` +
      `NO NPC, NO character visible anywhere. Only architecture, props, lighting, dither textures.` +
      (scene.style_reference ? ` Match the silhouette + dither density of HAKCD's ${scene.style_reference} reference scene.` : '');
    const r = await pulpAi.generateScene({ prompt, dim: [400, 240] });
    if (!r.pngBuffer) return res.status(502).json({ error: 'no_image_returned' });
    const destPng = path.join(project.local_path, 'sdk_data', 'scenes', scene.id + '.png');
    await fsp.mkdir(path.dirname(destPng), { recursive: true });
    await fsp.writeFile(destPng, r.pngBuffer);
    res.json({ ok: true, bytes: r.pngBuffer.length, path: destPng });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/sdk/characters/:charId/regen-portrait
router.post('/:id/sdk/characters/:charId/regen-portrait', async (req, res) => {
  try {
    const { project, data } = await readSdkProject(req.params.id);
    const c = (data.characters || []).find((x) => x.id === req.params.charId);
    if (!c) return res.status(404).json({ error: 'character_not_found' });
    const prompt = c.portrait_prompt || `${c.name} — ${c.role}`;
    const r = await pulpAi.generatePortrait({ prompt, dim: 64 });
    if (!r.pngBuffer) return res.status(502).json({ error: 'no_image_returned' });
    const destPng = path.join(project.local_path, 'sdk_data', 'characters', c.id + '.png');
    await fsp.mkdir(path.dirname(destPng), { recursive: true });
    await fsp.writeFile(destPng, r.pngBuffer);
    res.json({ ok: true, bytes: r.pngBuffer.length, path: destPng });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/sdk/scenes/:sceneId/asset — serve the current
// scene background PNG (or 404). Convenience for the editor UI thumbnails.
router.get('/:id/sdk/scenes/:sceneId/asset', async (req, res) => {
  try {
    const { project } = await readSdkProject(req.params.id);
    const p = path.join(project.local_path, 'sdk_data', 'scenes', req.params.sceneId + '.png');
    if (!fs.existsSync(p)) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=10');
    fs.createReadStream(p).pipe(res);
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/sdk/characters/:charId/asset
router.get('/:id/sdk/characters/:charId/asset', async (req, res) => {
  try {
    const { project } = await readSdkProject(req.params.id);
    const p = path.join(project.local_path, 'sdk_data', 'characters', req.params.charId + '.png');
    if (!fs.existsSync(p)) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=10');
    fs.createReadStream(p).pipe(res);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
module.exports.installPreviewWs = installPreviewWs;
