'use strict';

const express = require('express');
const projects = require('../services/projects');
const { validateProjectCreate, validateProjectPatch, validateId } = require('../services/validation');

const router = express.Router();

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
