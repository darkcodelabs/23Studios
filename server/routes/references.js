'use strict';

// Reference image library routes (Phase 6 B5 + Phase 4.5 Patch A extensions).

const express = require('express');
const multer = require('multer');
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

// ---------------------------------------------------------------------------
// Multer config for upload endpoint (Phase 4.5 Patch A)
// ---------------------------------------------------------------------------

// 10 MB per file, 1 file per request, in-memory (magic-bytes validation
// happens in the service layer once we've got the buffer).
const referenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
}).single('file');

function wrapMulter(handler) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large' });
      }
      if (err && err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'too_many_files' });
      }
      if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'unexpected_field' });
      }
      return sendErr(res, err);
    });
  };
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

// ---------------------------------------------------------------------------
// Phase 4.5 Patch A — upload / delete / merged manifest
// ---------------------------------------------------------------------------

// POST /api/projects/:id/references — multipart upload (single PNG, max 10MB).
//   Field name: "file". Optional form field "filename" overrides the name
//   used on disk (must still pass the safe-filename regex).
router.post('/projects/:id/references',
  wrapMulter(referenceUpload),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'no_file', detail: 'expected multipart field "file"' });
    }
    const requestedName =
      (req.body && typeof req.body.filename === 'string' && req.body.filename) ||
      req.file.originalname;
    try {
      const item = await references.addReference(req.params.id, req.file.buffer, requestedName);
      const manifest = await references.getMergedManifest(req.params.id);
      res.json({ uploaded: item, manifest });
    } catch (e) { sendErr(res, e); }
  }
);

// DELETE /api/projects/:id/references/:filename
//   Removes from per-project upload dir + scrubs from per-project manifest.
//   Refuses to touch global defaults (those aren't stored on disk in this
//   patch — they live in services/reference_images_defaults.js).
router.delete('/projects/:id/references/:filename', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const result = await references.deleteReference(req.params.id, req.params.filename);
    res.json(result);
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/references/manifest
//   Merged manifest: project-specific entries override global defaults. The
//   returned _source map tells the UI where each entry came from.
router.get('/projects/:id/references/manifest', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try {
    const manifest = await references.getMergedManifest(req.params.id);
    res.json(manifest);
  } catch (e) { sendErr(res, e); }
});

// PUT /api/projects/:id/references/manifest
//   Body: full manifest object. Saves project-specific entries; doesn't
//   touch global defaults. Returns the merged result.
router.put('/projects/:id/references/manifest',
  express.json({ limit: '64kb' }),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    try {
      const manifest = await references.updateProjectManifest(req.params.id, req.body || {});
      res.json(manifest);
    } catch (e) { sendErr(res, e); }
  }
);

module.exports = router;
