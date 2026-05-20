'use strict';

// batches.js — REST API for per-batch asset generation review.
//
// Mount: app.use('/api/projects', batchesRouter)
//
// GET  /api/projects/:id/batches                       — list all batch gates + manifests
// GET  /api/projects/:id/batches/:batch_id/manifest    — return manifest JSON for a batch
// POST /api/projects/:id/batches/:batch_id/approve     — mark gate chosen='approved'
// POST /api/projects/:id/batches/:batch_id/revise      — mark gate chosen='revise' + persist notes

const express = require('express');
const projects = require('../services/projects');
const {
  listBatchGates,
  readBatchManifest,
  updateBatchGate,
  readBatchGate
} = require('../services/sdk_asset_batches');

const router = express.Router();

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
// Accept scene batches (b1/b2/b3) and portrait batches (pb1/pb2/pb3).
const BATCH_RE = /^p?b[1-3]$/;

function sendErr(res, e, fallback = 500) {
  const status = (e && e.status) ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null
  });
}

async function resolveProject(req, res) {
  const { id } = req.params;
  if (!ID_RE.test(id)) { res.status(400).json({ error: 'bad_id' }); return null; }
  const project = await projects.getProject(id);
  if (!project || !project.local_path) { res.status(404).json({ error: 'not_found' }); return null; }
  return project;
}

// GET /api/projects/:id/batches
// Returns all batch gate objects with a summary of available manifests.
router.get('/:id/batches', async (req, res) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const sdkRoot = require('path').join(project.local_path, 'sdk_data');
    const gates = await listBatchGates(sdkRoot);

    // Attach manifest summary for each gate if found (by batch_id — may cover
    // scene + portrait kinds; return all found manifests for this batch_id).
    const withManifests = await Promise.all(gates.map(async (gate) => {
      const kinds = ['scene', 'portrait', 'launcher', 'item'];
      const manifests = {};
      for (const k of kinds) {
        const m = await readBatchManifest(sdkRoot, gate.batch_id, k).catch(() => null);
        if (m) manifests[k] = m;
      }
      return { ...gate, manifests };
    }));

    res.json({ batches: withManifests });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/batches/:batch_id/manifest
// Returns the gate + all manifests for that batch_id (across kinds).
router.get('/:id/batches/:batch_id/manifest', async (req, res) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const { batch_id } = req.params;
    if (!BATCH_RE.test(batch_id)) return res.status(400).json({ error: 'bad_batch_id' });

    const sdkRoot = require('path').join(project.local_path, 'sdk_data');
    const gate = await readBatchGate(sdkRoot, batch_id);
    if (!gate) return res.status(404).json({ error: 'batch_not_found' });

    const kinds = ['scene', 'portrait', 'launcher', 'item'];
    const manifests = {};
    for (const k of kinds) {
      const m = await readBatchManifest(sdkRoot, batch_id, k).catch(() => null);
      if (m) manifests[k] = m;
    }

    res.json({ gate, manifests });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/batches/:batch_id/approve
// Sets gate.chosen = 'approved'.
router.post('/:id/batches/:batch_id/approve', async (req, res) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const { batch_id } = req.params;
    if (!BATCH_RE.test(batch_id)) return res.status(400).json({ error: 'bad_batch_id' });

    const sdkRoot = require('path').join(project.local_path, 'sdk_data');
    const gate = await readBatchGate(sdkRoot, batch_id);
    if (!gate) return res.status(404).json({ error: 'batch_not_found' });

    const updated = await updateBatchGate(sdkRoot, batch_id, {
      chosen: 'approved',
      status: 'approved',
      approved_at: new Date().toISOString()
    });

    res.json({ gate: updated });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/batches/:batch_id/revise
// Body: { notes: string }
// Sets gate.chosen = 'revise' and persists notes.
router.post('/:id/batches/:batch_id/revise', async (req, res) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const { batch_id } = req.params;
    if (!BATCH_RE.test(batch_id)) return res.status(400).json({ error: 'bad_batch_id' });

    const sdkRoot = require('path').join(project.local_path, 'sdk_data');
    const gate = await readBatchGate(sdkRoot, batch_id);
    if (!gate) return res.status(404).json({ error: 'batch_not_found' });

    const notes = String((req.body && req.body.notes) || '').slice(0, 2000);
    const updated = await updateBatchGate(sdkRoot, batch_id, {
      chosen: 'revise',
      status: 'revise_requested',
      revise_notes: notes,
      revised_at: new Date().toISOString()
    });

    res.json({ gate: updated });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
