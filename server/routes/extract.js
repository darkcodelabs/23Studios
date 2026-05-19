'use strict';

// extract.js — Phase 6 A2 (Parse + Extract) HTTP/SSE surface.
//
// Endpoints:
//   POST /api/projects/:id/extract/run        -> start a job, returns {job_id}
//   GET  /api/projects/:id/extract/stream/:job_id -> SSE stream of progress
//   GET  /api/projects/:id/extract/result     -> latest extracted.json + catalog
//   GET  /api/projects/:id/extract/log        -> latest extraction_log.json

const path = require('path');
const fsp = require('fs/promises');
const express = require('express');

const projects = require('../services/projects');
const extractor = require('../services/extract_requirements');
const { validateId } = require('../services/validation');

const router = express.Router();

async function loadProjectOr404(req, res) {
  const idErr = validateId(req.params.id);
  if (idErr) { res.status(400).json({ error: 'bad_request', detail: idErr }); return null; }
  const proj = await projects.getProject(req.params.id);
  if (!proj) { res.status(404).json({ error: 'not_found' }); return null; }
  if (!proj.local_path) { res.status(400).json({ error: 'no_local_path' }); return null; }
  return proj;
}

router.post('/:id/extract/run', async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;
    const job = extractor.startJob(proj.local_path, proj.id);
    res.status(202).json({
      ok: true,
      job_id: job.id,
      started_at: job.started_at,
      stream_url: `/api/projects/${proj.id}/extract/stream/${job.id}`
    });
  } catch (e) { next(e); }
});

router.get('/:id/extract/stream/:job_id', async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;
    const job = extractor.getJob(req.params.job_id);
    if (!job || job.projectId !== proj.id) {
      return res.status(404).json({ error: 'job_not_found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();

    const send = (evt) => {
      try {
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch (_e) { /* client gone */ }
    };

    const unsubscribe = extractor.subscribeJob(job.id, send);

    // If the job is already finished, push the terminal state + close.
    if (job.state === 'done' || job.state === 'failed') {
      send({ phase: 'terminal', state: job.state, result: job.result, error: job.error });
      if (unsubscribe) unsubscribe();
      res.end();
      return;
    }

    // Heartbeat every 15s so proxies don't close the stream.
    const heartbeat = setInterval(() => {
      try { res.write(':\n\n'); } catch (_e) { /* ignore */ }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    };

    req.on('close', cleanup);
    req.on('end', cleanup);
  } catch (e) { next(e); }
});

router.get('/:id/extract/result', async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;
    const dir = path.join(proj.local_path, 'sdk_data', 'requirements');
    const ext = path.join(dir, 'extracted.json');
    const cat = path.join(dir, 'reference_catalog.json');
    let extracted = null;
    let catalog = null;
    try { extracted = JSON.parse(await fsp.readFile(ext, 'utf8')); } catch (_e) { /* none yet */ }
    try { catalog = JSON.parse(await fsp.readFile(cat, 'utf8')); } catch (_e) { /* none yet */ }
    if (!extracted && !catalog) {
      return res.status(404).json({ error: 'no_extraction_yet' });
    }
    res.json({ ok: true, extracted, reference_catalog: catalog });
  } catch (e) { next(e); }
});

router.get('/:id/extract/log', async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;
    const fp = path.join(proj.local_path, 'sdk_data', 'requirements', 'extraction_log.json');
    let log = null;
    try { log = JSON.parse(await fsp.readFile(fp, 'utf8')); } catch (_e) { /* none */ }
    if (!log) return res.status(404).json({ error: 'no_log_yet' });
    res.json({ ok: true, log });
  } catch (e) { next(e); }
});

module.exports = router;
