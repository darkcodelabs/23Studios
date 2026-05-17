'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const projects = require('../services/projects');
const pulpExport = require('../services/pulp_export');
const logBus = require('../services/logBus');
const { isAuthenticated } = require('../services/wsAuth');
const { validateId } = require('../services/validation');

const router = express.Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// In-process pubsub for WS clients waiting on a specific job.
// Live events stream from the export pipeline; clients subscribe by job_id.
// ---------------------------------------------------------------------------
const { EventEmitter } = require('events');
const jobBus = new EventEmitter();
jobBus.setMaxListeners(0);

// We buffer the recent event history for each job so a client connecting
// shortly after job kickoff can replay what they missed (the WS handshake
// runs concurrently with the first few steps).
const JOB_HISTORY = new Map(); // jobId -> array<event>
const JOB_HISTORY_MAX = 500;

function pushHistory(jobId, evt) {
  const arr = JOB_HISTORY.get(jobId) || [];
  arr.push(evt);
  if (arr.length > JOB_HISTORY_MAX) arr.splice(0, arr.length - JOB_HISTORY_MAX);
  JOB_HISTORY.set(jobId, arr);
}

function publishJobEvent(jobId, projectId, evt) {
  pushHistory(jobId, evt);
  jobBus.emit('e:' + jobId, evt);
  // Mirror into the per-project logBus for any general listeners.
  try { logBus.emit(projectId, { kind: 'export_' + evt.type, ...evt }); } catch (_e) { /* ignore */ }
}

function sendErr(res, e, fallback = 500) {
  if (e && e.status && e.code) {
    const body = { error: e.code };
    if (e.detail !== undefined) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // eslint-disable-next-line no-console
  console.error('[pulp_export]', id, e && (e.code || e.message) || 'unknown');
  return res.status(fallback).json({ error: 'server_error', id });
}

// POST /api/projects/:id/pulp/export
router.post('/:id/pulp/export', async (req, res) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_project_id', detail: idErr });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.game_type !== 'pulp') {
      return res.status(400).json({ error: 'not_pulp_project' });
    }

    const target = (req.body && req.body.target) || 'pdx';
    if (target !== 'pdx') return res.status(400).json({ error: 'bad_target' });

    const { jobId } = pulpExport.startExport({
      project,
      onEvent: (evt) => publishJobEvent(jobId, project.id, evt),
    });

    res.status(202).json({
      job_id: jobId,
      ws_url: `/ws/export/${jobId}`,
      download_url: `/api/projects/${project.id}/pulp/export/jobs/${jobId}/download`,
    });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/pulp/export/jobs/:job_id/download
router.get('/:id/pulp/export/jobs/:job_id/download', async (req, res) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_project_id' });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });

    const job = pulpExport.getJob(req.params.job_id);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    if (job.project_id !== project.id) return res.status(404).json({ error: 'job_not_found' });
    if (job.status !== 'done') return res.status(409).json({ error: 'job_not_ready', status: job.status });
    if (!job.pdx_path) return res.status(404).json({ error: 'pdx_missing' });

    let stat;
    try { stat = fs.statSync(job.pdx_path); }
    catch (_e) { return res.status(404).json({ error: 'pdx_missing' }); }

    const filename = `${project.id}.pdx`;

    if (stat.isDirectory()) {
      // .pdx is a bundle; tar it up so a single binary stream is returned.
      // Avoid spawning tar: do a minimal in-process zip instead.
      const archive = await tarDirToBuffer(job.pdx_path);
      res.setHeader('Content-Type', 'application/x-tar');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.tar"`);
      res.setHeader('Content-Length', archive.length);
      return res.end(archive);
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(job.pdx_path);
    stream.on('error', () => { try { res.destroy(); } catch (_e) { /* ignore */ } });
    return stream.pipe(res);
  } catch (e) { sendErr(res, e); }
});

// Minimal POSIX ustar archive of a directory tree (PDX bundle case).
// Lets us serve the multi-file bundle as a single attachment without a
// shell-out to `tar` (keeps with no-subprocess-with-user-input rule).
async function tarDirToBuffer(rootDir) {
  const fsp = require('fs/promises');
  const chunks = [];
  const baseName = path.basename(rootDir);

  async function walk(dir, relPrefix) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const sp = path.join(dir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        chunks.push(tarHeader(rel + '/', 0, '5'));
        await walk(sp, rel);
      } else if (e.isFile()) {
        const data = await fsp.readFile(sp);
        chunks.push(tarHeader(rel, data.length, '0'));
        chunks.push(data);
        const pad = (512 - (data.length % 512)) % 512;
        if (pad) chunks.push(Buffer.alloc(pad));
      }
    }
  }
  await walk(rootDir, baseName);

  // Two 512-byte zero blocks mark end of archive.
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function tarHeader(name, size, typeflag) {
  const buf = Buffer.alloc(512);
  buf.write(name.slice(0, 100), 0, 100, 'utf8');
  buf.write('0000644 ', 100, 8, 'ascii');
  buf.write('0000000 ', 108, 8, 'ascii');
  buf.write('0000000 ', 116, 8, 'ascii');
  const sizeOct = size.toString(8).padStart(11, '0') + ' ';
  buf.write(sizeOct, 124, 12, 'ascii');
  const mtimeOct = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ';
  buf.write(mtimeOct, 136, 12, 'ascii');
  buf.write('        ', 148, 8, 'ascii');   // checksum placeholder
  buf.write(typeflag, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  const cs = sum.toString(8).padStart(6, '0') + '\0 ';
  buf.write(cs, 148, 8, 'ascii');
  return buf;
}

// ---------------------------------------------------------------------------
// WebSocket attach: install on the Express server. Mirrors chat.js pattern.
// ---------------------------------------------------------------------------

function attachExportWs(wss) {
  wss.on('connection', (ws, req) => {
    const jobId = req._jobId;
    if (!jobId) {
      try { ws.close(1008, 'bad_job'); } catch (_e) { /* ignore */ }
      return;
    }

    const send = (obj) => {
      if (ws.readyState !== ws.OPEN) return;
      try { ws.send(JSON.stringify(obj)); } catch (_e) { /* ignore */ }
    };

    // Replay history.
    const hist = JOB_HISTORY.get(jobId) || [];
    send({ type: 'ready', job_id: jobId });
    for (const evt of hist) send(evt);

    const onEvt = (evt) => send(evt);
    jobBus.on('e:' + jobId, onEvt);

    // If the job is already terminal, close after flushing.
    const job = pulpExport.getJob(jobId);
    if (job && (job.status === 'done' || job.status === 'error')) {
      // Already replayed everything via history; close softly.
      setTimeout(() => { try { ws.close(1000); } catch (_e) { /* ignore */ } }, 100);
    }

    ws.on('close', () => {
      jobBus.off('e:' + jobId, onEvt);
    });
  });
}

function installExportWs(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  attachExportWs(wss);

  server.on('upgrade', async (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/ws/export/')) return;
    const ok = await isAuthenticated(req);
    if (!ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const m = url.match(/^\/ws\/export\/(job_[a-f0-9]{16})(?:\?.*)?$/);
    if (!m) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    req._jobId = m[1];
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return { wss };
}

module.exports = router;
module.exports.installExportWs = installExportWs;
