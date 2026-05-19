'use strict';

// Reference image library routes (Phase 6 B5).

const express = require('express');
const references = require('../services/references');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e) {
  const status = e && e.status ? e.status : 500;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message
  });
}

// GET /api/projects/:id/references
router.get('/projects/:id/references', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const data = await references.listReferences(req.params.id);
    res.json(data);
  } catch (e) { sendErr(res, e); }
});

// PATCH /api/projects/:id/references — body: { path, tags?, anchored_to?, notes? }
router.patch('/projects/:id/references', express.json({ limit: '32kb' }), async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const body = req.body || {};
  const rel = typeof body.path === 'string' ? body.path : '';
  if (!rel) return res.status(400).json({ error: 'bad_request', detail: 'path required' });
  try {
    const out = await references.updateReference(req.params.id, rel, {
      tags: body.tags,
      anchored_to: body.anchored_to,
      notes: body.notes
    });
    res.json({ item: out });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/references/bulk-tag
//   body: { paths: string[], add_tags?: string[], remove_tags?: string[] }
router.post('/projects/:id/references/bulk-tag', express.json({ limit: '64kb' }), async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const body = req.body || {};
  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return res.status(400).json({ error: 'bad_request', detail: 'paths[] required' });
  }
  const add = Array.isArray(body.add_tags) ? body.add_tags : [];
  const remove = Array.isArray(body.remove_tags) ? body.remove_tags : [];
  if (add.length === 0 && remove.length === 0) {
    return res.status(400).json({ error: 'bad_request', detail: 'add_tags or remove_tags required' });
  }
  try {
    const r = await references.bulkApplyTags(req.params.id, body.paths, add, remove);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
