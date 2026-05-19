'use strict';

// Phase 6 B12 — Linked-doc routes.
//
//   GET    /api/projects/:id/linked-docs              — bible/canon/skill content + sections
//   GET    /api/projects/:id/scenes/:sceneId/notes    — pinned notes for a scene
//   POST   /api/projects/:id/scenes/:sceneId/notes    — pin a new note
//   DELETE /api/projects/:id/scenes/:sceneId/notes/:noteId
//
// SceneId is validated with the same regex B1/B2 use so the path can't
// escape sdk_data/scenes/.

const express = require('express');
const linkedDocs = require('../services/linked_docs');
const { validateId } = require('../services/validation');

const router = express.Router();

const SCENE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const NOTE_ID_RE = /^note-[A-Za-z0-9_-]{1,64}$/;
function validateSceneId(v) {
  if (typeof v !== 'string' || !SCENE_ID_RE.test(v)) return 'sceneId must match ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$';
  return null;
}
function validateNoteId(v) {
  if (typeof v !== 'string' || !NOTE_ID_RE.test(v)) return 'noteId invalid';
  return null;
}
function sendErr(res, e) {
  const status = (e && e.status) || 500;
  res.status(status).json({ error: (e && e.code) || 'server_error', detail: e && e.message });
}

router.get('/projects/:id/linked-docs', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  try { res.json(await linkedDocs.readDocs(req.params.id)); }
  catch (e) { sendErr(res, e); }
});

router.get('/projects/:id/scenes/:sceneId/notes', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const sidErr = validateSceneId(req.params.sceneId);
  if (sidErr) return res.status(400).json({ error: 'bad_request', detail: sidErr });
  try { res.json(await linkedDocs.readNotes(req.params.id, req.params.sceneId)); }
  catch (e) { sendErr(res, e); }
});

router.post(
  '/projects/:id/scenes/:sceneId/notes',
  express.json({ limit: '16kb' }),
  async (req, res) => {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const sidErr = validateSceneId(req.params.sceneId);
    if (sidErr) return res.status(400).json({ error: 'bad_request', detail: sidErr });
    try {
      const entry = await linkedDocs.pinNote(req.params.id, req.params.sceneId, req.body || {});
      res.status(201).json(entry);
    } catch (e) { sendErr(res, e); }
  }
);

router.delete('/projects/:id/scenes/:sceneId/notes/:noteId', async (req, res) => {
  const idErr = validateId(req.params.id);
  if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
  const sidErr = validateSceneId(req.params.sceneId);
  if (sidErr) return res.status(400).json({ error: 'bad_request', detail: sidErr });
  const nidErr = validateNoteId(req.params.noteId);
  if (nidErr) return res.status(400).json({ error: 'bad_request', detail: nidErr });
  try {
    const removed = await linkedDocs.deleteNote(req.params.id, req.params.sceneId, req.params.noteId);
    res.json({ removed });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
