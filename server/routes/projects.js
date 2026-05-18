'use strict';

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const projects = require('../services/projects');
const { validateProjectCreate, validateProjectPatch, validateId } = require('../services/validation');

const router = express.Router();

// Slugify a pitch into a safe project id.
function slugifyPitch(pitch) {
  let s = String(pitch || '').toLowerCase();
  s = s.replace(/[^a-z0-9-]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  if (!s) s = 'game';
  if (!/^[a-z0-9]/.test(s)) s = 'g' + s;
  return s.slice(0, 24);
}

function dataDir() {
  return process.env.PROJECTS_DATA_DIR
    ? path.resolve(process.env.PROJECTS_DATA_DIR)
    : path.join(__dirname, '..', 'data');
}

router.get('/', async (_req, res, next) => {
  try {
    const list = await projects.listProjects();
    res.json({ projects: list });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const err = validateId(req.params.id);
    if (err) return res.status(400).json({ error: 'bad_request', detail: err });
    const p = await projects.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json({ project: p });
  } catch (e) { next(e); }
});

// POST /api/projects/quick
// Body: { pitch: string }
// Creates a minimal pulp project under the server's data dir (scratch_projects/<id>),
// scaffolds a .git marker + pulp_data/ so the rest of the pipeline can write
// freely, and returns the created project. Caller (UI) then kicks off the
// autopilot SSE stream against it.
router.post('/quick', async (req, res, next) => {
  try {
    const body = req.body || {};
    const pitch = typeof body.pitch === 'string' ? body.pitch.trim() : '';
    if (!pitch) return res.status(400).json({ error: 'bad_request', detail: 'pitch required' });
    if (pitch.length > 4000) return res.status(400).json({ error: 'bad_request', detail: 'pitch too long' });

    const baseSlug = slugifyPitch(pitch);
    // Append a short timestamp suffix so concurrent quick-creates don't clash.
    const suffix = Date.now().toString(36).slice(-5);
    const id = `${baseSlug}-${suffix}`.slice(0, 48);

    const scratchRoot = path.join(dataDir(), 'scratch_projects');
    await fsp.mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    const localPath = path.join(scratchRoot, id);
    await fsp.mkdir(localPath, { recursive: true, mode: 0o700 });
    // Drop a .git marker so validateLocalPath accepts the directory.
    const gitMarker = path.join(localPath, '.git');
    if (!fs.existsSync(gitMarker)) {
      await fsp.mkdir(gitMarker, { recursive: true, mode: 0o700 });
    }
    // Pre-create the pulp_data dir so the workflow + assets services don't race.
    await fsp.mkdir(path.join(localPath, 'pulp_data'), { recursive: true, mode: 0o700 });

    const input = {
      id,
      name: pitch.slice(0, 80) || id,
      description: pitch.slice(0, 1000),
      repo: 'https://github.com/local/scratch.git',
      local_path: localPath,
      platform: 'playdate',
      publisher: '23 Studios',
      developer: '23 Studios',
      build_command: '',
      preflight_command: '',
      captures_dir: '',
      status: 'active',
      game_type: 'sdk'
    };
    const errors = validateProjectCreate(input);
    if (errors.length) {
      return res.status(400).json({ error: 'validation_failed', detail: errors });
    }
    const created = await projects.createProject(input);
    res.status(201).json({ project: created });
  } catch (e) {
    if (e && e.status === 409) return res.status(409).json({ error: e.code || 'conflict' });
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const errors = validateProjectCreate(req.body || {});
    if (errors.length) return res.status(400).json({ error: 'validation_failed', detail: errors });
    const created = await projects.createProject(req.body);
    res.status(201).json({ project: created });
  } catch (e) {
    if (e && e.status === 409) return res.status(409).json({ error: e.code || 'conflict' });
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const errors = validateProjectPatch(req.body || {});
    if (errors.length) return res.status(400).json({ error: 'validation_failed', detail: errors });
    const patched = await projects.patchProject(req.params.id, req.body);
    if (!patched) return res.status(404).json({ error: 'not_found' });
    res.json({ project: patched });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const ok = await projects.deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
