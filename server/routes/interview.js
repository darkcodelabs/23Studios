'use strict';

// Phase 6 A5 — Interview routes.

const express = require('express');

const interview = require('../services/interview');
const { validateId } = require('../services/validation');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || 'server_error',
    detail: e && e.message,
    extra: (e && e.detail) || undefined
  });
}
function preflightId(req, res) {
  const err = validateId(req.params.id);
  if (err) { res.status(400).json({ error: 'bad_request', detail: err }); return false; }
  return true;
}

// POST /api/projects/:id/interview/queue   build (or rebuild) the question queue
router.post('/:id/interview/queue', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const queue = await interview.buildQuestionQueue(req.params.id);
    res.status(200).json({ ok: true, queue });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/interview/queue   latest queue
router.get('/:id/interview/queue', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const queue = await interview.getQueue(req.params.id);
    if (!queue) return res.status(404).json({ error: 'no_queue' });
    const state = await interview.getState(req.params.id);
    res.json({ ok: true, queue, state });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/interview/answer
router.post('/:id/interview/answer', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const body = req.body || {};
    const qid = String(body.question_id || '').trim();
    const action = String(body.action || '').trim();
    if (!qid || !action) {
      return res.status(400).json({ error: 'bad_request', detail: 'question_id + action required' });
    }
    const result = await interview.answerQuestion(req.params.id, qid, action, body.value, {
      note: body.note, high_stakes: !!body.high_stakes
    });
    res.json({ ok: true, ...result });
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/interview/lock  finalize the interview
router.post('/:id/interview/lock', async (req, res) => {
  if (!preflightId(req, res)) return;
  try {
    const candidate = await interview.lockInterview(req.params.id);
    res.json({ ok: true, scope_lock_candidate: candidate });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
