'use strict';

// quality_reports.js — Stub-aware GETters for the four "latest report" reads
// the Workspace + Quality screens hit on every load:
//
//   GET /api/projects/:id/architecture                — returns architecture diagram
//   GET /api/projects/:id/design/validate/latest      — returns static validator report
//   GET /api/projects/:id/perf/audit/latest           — returns perf audit report
//   GET /api/projects/:id/qa/critique/latest          — returns multi-persona critic report
//
// All four return HTTP 200 with either the real cached artifact OR a stub
// shape carrying { project_id, generated_at: null, ..., note } so the
// frontend stops 404-ing while the user hasn't run the corresponding
// pass yet. The POST endpoints that *generate* these reports already exist
// (see routes/architecture.js, routes/design.js, routes/perf.js) — those
// are intentionally left alone. This router only owns the read side.
//
// Mounted in server/index.js BEFORE the older routers (architecture,
// design, perf) so these GETs match first. The POSTs still flow through
// the original routers.
//
// Conventions follow routes/perf.js: validateId guard, sendErr helper,
// readLatest()-style probes that swallow missing-file errors.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('../services/projects');
const { validateId } = require('../services/validation');

// Lazy require so a missing service file doesn't crash the server boot.
function safeRequire(modPath) {
  try { return require(modPath); }
  catch (_e) { return null; }
}

const archDiagram     = safeRequire('../services/sdk_arch_diagram');
const staticValidator = safeRequire('../services/sdk_static_validator');
const perfAudit       = safeRequire('../services/sdk_perf_audit');
const qaPass          = safeRequire('../services/sdk_qa_pass');

const SDK_DATA_REL = 'sdk_data';

const router = express.Router();

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || (e && e.message) || null
  });
}

// Resolves the project; if no local_path, returns null so the caller
// can still emit a stub (rather than 422-ing the frontend before it
// even has a chance to provision the project on disk).
async function resolveProject(id) {
  const idErr = validateId(id);
  if (idErr) {
    const e = new Error(idErr);
    e.status = 400; e.code = 'bad_request';
    throw e;
  }
  const p = await projects.getProject(id);
  if (!p) {
    const e = new Error('project_not_found');
    e.status = 404; e.code = 'not_found';
    throw e;
  }
  return p;
}

// Read a JSON file safely; returns null on any failure (missing, parse err).
async function tryReadJson(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = await fsp.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

// File mtime as ISO string, or null if missing.
function mtimeIso(fp) {
  try {
    const s = fs.statSync(fp);
    return s.mtime.toISOString();
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/projects/:id/architecture
// ---------------------------------------------------------------------------
router.get('/:id/architecture', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);

    // Stub branch — no local_path or no architecture.md on disk.
    if (!project.local_path) {
      return res.json({
        project_id: project.id,
        generated_at: null,
        diagram: null,
        note: 'architecture diagram not yet generated'
      });
    }

    const sdkDataDir = path.join(project.local_path, SDK_DATA_REL);
    const mdPath = path.join(sdkDataDir, 'architecture.md');

    // Prefer the service's read() if available.
    if (archDiagram && typeof archDiagram.read === 'function') {
      const r = archDiagram.read(sdkDataDir);
      if (r && r.md) {
        return res.json({
          project_id: project.id,
          generated_at: mtimeIso(mdPath),
          diagram: r.md,
          svg_url: r.svg_path ? `/api/projects/${project.id}/architecture/svg` : null
        });
      }
    }

    // No cached diagram — return stub at 200 so the frontend doesn't 404.
    return res.json({
      project_id: project.id,
      generated_at: null,
      diagram: null,
      note: 'architecture diagram not yet generated'
    });
  } catch (e) { sendErr(res, e); }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/design/validate/latest
// ---------------------------------------------------------------------------
router.get('/:id/design/validate/latest', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);

    if (!project.local_path) {
      return res.json({
        project_id: project.id,
        validated_at: null,
        ok: null,
        findings: [],
        note: 'no validation report yet'
      });
    }

    // sdk_static_validator doesn't expose a readLatest(); the persisted
    // file lives at <sdk_data>/design_validation.json (see routes/design.js
    // and the service's own writeFile target at sdk_static_validator.js:479).
    const fp = path.join(project.local_path, SDK_DATA_REL, 'design_validation.json');

    if (staticValidator && typeof staticValidator.getLatestReport === 'function') {
      const r = await staticValidator.getLatestReport(project.id);
      if (r) return res.json(r);
    }

    const cached = await tryReadJson(fp);
    if (cached) return res.json(cached);

    return res.json({
      project_id: project.id,
      validated_at: null,
      ok: null,
      findings: [],
      note: 'no validation report yet'
    });
  } catch (e) { sendErr(res, e); }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/perf/audit/latest
// ---------------------------------------------------------------------------
router.get('/:id/perf/audit/latest', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);

    if (!project.local_path) {
      return res.json({
        project_id: project.id,
        audited_at: null,
        ok: null,
        findings: [],
        note: 'no perf audit report yet'
      });
    }

    // Service exposes readLatest(sdkRoot); sdkRoot is the project local_path
    // (not the sdk_data subdir) — see sdk_perf_audit.js:562 which joins on
    // 'sdk_data'.
    if (perfAudit && typeof perfAudit.readLatest === 'function') {
      const r = await perfAudit.readLatest(project.local_path);
      if (r) return res.json(r);
    } else if (perfAudit && typeof perfAudit.getLatestReport === 'function') {
      const r = await perfAudit.getLatestReport(project.id);
      if (r) return res.json(r);
    }

    // Fall back to direct file probe.
    const fp = path.join(project.local_path, SDK_DATA_REL, 'perf_audit.json');
    const cached = await tryReadJson(fp);
    if (cached) return res.json(cached);

    return res.json({
      project_id: project.id,
      audited_at: null,
      ok: null,
      findings: [],
      note: 'no perf audit report yet'
    });
  } catch (e) { sendErr(res, e); }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/qa/critique/latest
// ---------------------------------------------------------------------------
router.get('/:id/qa/critique/latest', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);

    if (!project.local_path) {
      return res.json({
        project_id: project.id,
        critiqued_at: null,
        ok: null,
        findings: [],
        note: 'no qa critique report yet'
      });
    }

    if (qaPass && typeof qaPass.readLatest === 'function') {
      const r = await qaPass.readLatest(project.local_path);
      if (r) return res.json(r);
    } else if (qaPass && typeof qaPass.getLatestReport === 'function') {
      const r = await qaPass.getLatestReport(project.id);
      if (r) return res.json(r);
    }

    const fp = path.join(project.local_path, SDK_DATA_REL, 'qa_critic.json');
    const cached = await tryReadJson(fp);
    if (cached) return res.json(cached);

    return res.json({
      project_id: project.id,
      critiqued_at: null,
      ok: null,
      findings: [],
      note: 'no qa critique report yet'
    });
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
