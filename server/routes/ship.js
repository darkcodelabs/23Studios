'use strict';

// ship.js — Phase 6 B11 routes.

const express = require('express');
const shipSvc = require('../services/ship');

const router = express.Router();

// GET /api/projects/:id/ship/preflight -> { ok, checks: [...] }
router.get('/projects/:id/ship/preflight', async (req, res) => {
  try {
    const r = await shipSvc.preflight(req.params.id);
    res.json(r);
  } catch (e) {
    res.status(e.status || 500).json({ error: 'preflight_failed', detail: e.message });
  }
});

// POST /api/projects/:id/ship -> { ship_id, status_url }
router.post('/projects/:id/ship', async (req, res) => {
  try {
    const r = await shipSvc.ship(req.params.id);
    res.status(202).json({
      ship_id: r.id,
      status_url: `/api/projects/${req.params.id}/ship/${r.id}`
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: 'ship_failed', detail: e.message });
  }
});

// GET /api/projects/:id/ship/:shipId -> { events, done, ok }
router.get('/projects/:id/ship/:shipId', (req, res) => {
  const s = shipSvc.get(req.params.shipId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ id: s.id, events: s.events, done: s.done, ok: s.ok });
});

module.exports = router;
