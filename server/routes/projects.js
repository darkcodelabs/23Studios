'use strict';

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const multer = require('multer');
const projects = require('../services/projects');
const intakeForm = require('../services/intake_form');
const intakeUpload = require('../services/intake_upload');
const { validateProjectCreate, validateProjectPatch, validateId } = require('../services/validation');
const gates = require('../services/gates');

const router = express.Router();

// Best-effort canonical gate seed. Never throws; errors are swallowed so they
// do not fail project creation.
async function tryGateSeed(projectId, localPath) {
  try {
    await gates.seedCanonicalGates(projectId, localPath);
  } catch (_e) { /* best-effort */ }
}

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
    await tryGateSeed(created.id, localPath);
    res.status(201).json({ project: created });
  } catch (e) {
    if (e && e.status === 409) return res.status(409).json({ error: e.code || 'conflict' });
    next(e);
  }
});

// POST /api/projects/intake
// Body: full intake form payload (section 1 of docs/23studios_intake_prompt.md).
// Only `pitch` is required. Blank string/list fields are filled by a single
// Claude inference pass; enums and numbers fall through to schema defaults.
// Side effects on success:
//   - <local_path>/sdk_data/intake.yaml  (final filled form)
//   - <local_path>/sdk_data/story_bible.md  (section 2 template, substituted)
//   - project record created via projects.createProject (game_type='sdk')
router.post('/intake', async (req, res, next) => {
  try {
    const body = req.body || {};
    const pitch = typeof body.pitch === 'string' ? body.pitch.trim() : '';
    if (!pitch) return res.status(400).json({ error: 'bad_request', detail: 'pitch required' });
    if (pitch.length > 4000) return res.status(400).json({ error: 'bad_request', detail: 'pitch too long' });

    const baseSlug = slugifyPitch(pitch);
    const suffix = Date.now().toString(36).slice(-5);
    const id = `${baseSlug}-${suffix}`.slice(0, 48);

    const scratchRoot = path.join(dataDir(), 'scratch_projects');
    await fsp.mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    const localPath = path.join(scratchRoot, id);
    await fsp.mkdir(localPath, { recursive: true, mode: 0o700 });
    const gitMarker = path.join(localPath, '.git');
    if (!fs.existsSync(gitMarker)) {
      await fsp.mkdir(gitMarker, { recursive: true, mode: 0o700 });
    }
    await fsp.mkdir(path.join(localPath, 'pulp_data'), { recursive: true, mode: 0o700 });
    await fsp.mkdir(path.join(localPath, 'sdk_data'), { recursive: true, mode: 0o700 });

    // Write the raw user intake first so the inference call has a recoverable
    // audit trail even if the LLM step blows up.
    const rawIntake = intakeForm.normalizeIntake(body);
    rawIntake.pitch = pitch;
    await intakeForm.writeIntake(localPath, rawIntake);

    // Inference fill. claude.sendMessage requires the project's cwd to exist
    // and a safe id — both already true at this point.
    const { intake: filled, fields_inferred, fields_provided } = await intakeForm.inferMissingFields({
      intake: rawIntake,
      claudeCtx: { projectId: id, cwd: localPath }
    });

    // Persist the FINAL filled intake (overwrites the raw stub above) +
    // render the story bible from the filled values.
    await intakeForm.writeIntake(localPath, filled);
    const name = (typeof body.name === 'string' && body.name.trim()) || pitch.slice(0, 80) || id;
    const bibleMd = intakeForm.renderStoryBible(filled, name);
    await intakeForm.writeStoryBible(localPath, bibleMd);

    const input = {
      id,
      name,
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
    await tryGateSeed(created.id, localPath);
    res.status(201).json({
      project: created,
      intake_summary: { fields_provided, fields_inferred }
    });
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
    if (created.local_path) await tryGateSeed(created.id, created.local_path);
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

// -----------------------------------------------------------------------------
// Phase 6 A1 — intake sources endpoints
// -----------------------------------------------------------------------------
// POST /api/projects/:id/intake/sources
//   multipart/form-data fields:
//     bible            text/markdown (file)        OR  bible_text (form field)
//     canon            text/markdown (file)        OR  canon_text
//     skill_md         text/markdown (file)        OR  skill_text
//     reference_images files[] (PNG/JPG)
//     reference_meta   JSON string: [{filename, tag?, subject_hint?}, ...]
//     urls             JSON string: [{url, tag?, subject_hint?}, ...]
//     notes            JSON string: [{text, tag?}, ...]
//
// GET    /api/projects/:id/intake/sources             -> current manifest + lists
// DELETE /api/projects/:id/intake/sources/refs/:name  -> drop a reference image

const SOURCES_FIELD_LIMITS = {
  fileSize: 16 * 1024 * 1024,
  files: 64,
  fields: 32
};

const sourcesUpload = multer({
  storage: multer.memoryStorage(),
  limits: SOURCES_FIELD_LIMITS
}).fields([
  { name: 'bible', maxCount: 1 },
  { name: 'canon', maxCount: 1 },
  { name: 'skill_md', maxCount: 1 },
  { name: 'reference_images', maxCount: 64 }
]);

function wrapMulter(handler) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'too_many_files' });
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'unexpected_field' });
      return next(err);
    });
  };
}

function parseJsonField(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw); }
  catch (_e) { return fallback; }
}

async function loadProjectOr404(req, res) {
  const idErr = validateId(req.params.id);
  if (idErr) { res.status(400).json({ error: 'bad_request', detail: idErr }); return null; }
  const proj = await projects.getProject(req.params.id);
  if (!proj) { res.status(404).json({ error: 'not_found' }); return null; }
  if (!proj.local_path) { res.status(400).json({ error: 'no_local_path' }); return null; }
  return proj;
}

router.post('/:id/intake/sources', wrapMulter(sourcesUpload), async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;

    const files = req.files || {};
    const body = req.body || {};

    const spec = {};

    // text docs — prefer file upload over text body, but support both.
    function pickText(field, textField) {
      const f = (files[field] && files[field][0]) || null;
      if (f && f.buffer) return { content: f.buffer };
      const t = body[textField];
      if (typeof t === 'string' && t.trim().length > 0) return { content: t };
      return null;
    }
    const bible = pickText('bible', 'bible_text');
    if (bible) spec.bible = bible;
    const canon = pickText('canon', 'canon_text');
    if (canon) spec.canon = canon;
    const skill = pickText('skill_md', 'skill_text');
    if (skill) spec.skill_md = skill;

    // reference images + their meta sidecar
    const refMeta = parseJsonField(body.reference_meta, []);
    const metaByName = new Map();
    if (Array.isArray(refMeta)) {
      for (const m of refMeta) {
        if (m && typeof m.filename === 'string') metaByName.set(m.filename, m);
      }
    }
    const refImgs = files.reference_images || [];
    if (refImgs.length > 0) {
      spec.reference_images = refImgs.map((f) => {
        const meta = metaByName.get(f.originalname) || {};
        return {
          filename: f.originalname,
          content: f.buffer,
          tag: typeof meta.tag === 'string' ? meta.tag : '',
          subject_hint: typeof meta.subject_hint === 'string' ? meta.subject_hint : ''
        };
      });
    }

    const urls = parseJsonField(body.urls, null);
    if (Array.isArray(urls)) spec.urls = urls;
    const notes = parseJsonField(body.notes, null);
    if (Array.isArray(notes)) spec.notes = notes;

    if (!spec.bible && !spec.canon && !spec.skill_md && !spec.reference_images && !spec.urls && !spec.notes) {
      return res.status(400).json({ error: 'bad_request', detail: 'no source material provided' });
    }

    const result = await intakeUpload.ingest(proj.local_path, spec);
    res.json({
      ok: true,
      manifest: result.manifest,
      diff: result.diff,
      written: {
        bible: !!result.written.bible,
        canon: !!result.written.canon,
        skill_md: !!result.written.skill_md,
        reference_images: result.written.reference_images.length,
        urls: result.written.urls,
        notes: result.written.notes
      }
    });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.code || 'error', detail: e.message });
    next(e);
  }
});

router.get('/:id/intake/sources', async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;
    const summary = await intakeUpload.listSources(proj.local_path);
    res.json({ ok: true, sources: summary });
  } catch (e) { next(e); }
});

router.delete('/:id/intake/sources/refs/:name', async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;
    const result = await intakeUpload.removeReferenceImage(proj.local_path, req.params.name);
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.code || 'error' });
    next(e);
  }
});

// POST /api/projects/:id/gates/seed
// Re-seed canonical gates for an existing project (idempotent — skips existing files).
router.post('/:id/gates/seed', async (req, res, next) => {
  try {
    const proj = await loadProjectOr404(req, res);
    if (!proj) return;
    await gates.seedCanonicalGates(proj.id, proj.local_path);
    res.json({ ok: true, seeded: gates.CANONICAL_GATES.map((g) => g.id) });
  } catch (e) { next(e); }
});

module.exports = router;
