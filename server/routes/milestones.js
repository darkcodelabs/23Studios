'use strict';

// milestones.js — route handlers for incremental milestone builds.
//
// POST /:id/milestones/build        body: { milestone, force? }
// POST /:id/milestones/build_all    body: { force? }
// GET  /:id/milestones              list all milestone statuses
// GET  /:id/milestones/:milestone/log  text/plain build log

const express = require('express');
const fs = require('fs');
const path = require('path');
const { runMilestone, runAll, listMilestones } = require('../services/sdk_milestones');
const projects = require('../services/projects');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({ error: e && e.code || 'server_error', detail: e && e.message });
}

// POST /api/projects/:id/milestones/build
router.post('/:id/milestones/build', async (req, res) => {
  try {
    const milestoneId = String((req.body && req.body.milestone) || '').trim();
    const force = !!(req.body && req.body.force);
    if (!milestoneId) return res.status(400).json({ error: 'bad_request', detail: 'milestone required' });
    const status = await runMilestone(req.params.id, milestoneId, { force });
    res.json(status);
  } catch (e) { sendErr(res, e); }
});

// POST /api/projects/:id/milestones/build_all
router.post('/:id/milestones/build_all', async (req, res) => {
  try {
    const force = !!(req.body && req.body.force);
    const results = await runAll(req.params.id, { force });
    res.json({ results });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/milestones
router.get('/:id/milestones', async (req, res) => {
  try {
    const statuses = await listMilestones(req.params.id);
    res.json({ milestones: statuses });
  } catch (e) { sendErr(res, e); }
});

// GET /api/projects/:id/milestones/:milestone/log
router.get('/:id/milestones/:milestone/log', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.local_path) return res.status(500).json({ error: 'no_local_path' });
    const logPath = path.join(
      project.local_path, 'sdk_data', 'milestones',
      req.params.milestone, 'log.txt'
    );
    if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'no_log' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(logPath).pipe(res);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
