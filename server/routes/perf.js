'use strict';

// perf.js — Performance audit routes (Phase 13).
//
// POST /api/projects/:id/perf/audit         — run audit, return report
// GET  /api/projects/:id/perf/audit/latest  — return persisted report (404 if absent)

const express = require('express');
const path = require('path');
const projects = require('../services/projects');
const perfAudit = require('../services/sdk_perf_audit');

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null
  });
}

// POST /api/projects/:id/perf/audit
// Runs a full static perf audit and returns the report.  Safe to re-run.
router.post('/:id/perf/audit', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }
    const report = await perfAudit.audit(project.id, project.local_path);
    res.json(report);
  } catch (e) {
    sendErr(res, e);
  }
});

// GET /api/projects/:id/perf/audit/latest
// Returns the most recently persisted report. 404 if the audit has never run.
router.get('/:id/perf/audit/latest', async (req, res) => {
  try {
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!project.local_path) {
      return res.status(422).json({ error: 'project_has_no_local_path' });
    }
    const report = await perfAudit.readLatest(project.local_path);
    if (!report) {
      return res.status(404).json({
        error: 'no_audit_report',
        detail: 'Run POST /api/projects/:id/perf/audit first'
      });
    }
    res.json(report);
  } catch (e) {
    sendErr(res, e);
  }
});

module.exports = router;
