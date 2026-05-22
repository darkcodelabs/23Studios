'use strict';

// bible.js — modular story bible section CRUD + compile + diff.
//
// GET    /api/projects/:id/bible              -> { sections: [...], compiled_bytes }
// GET    /api/projects/:id/bible/:filename    -> raw markdown
// POST   /api/projects/:id/bible/:filename    -> { content } upsert
// DELETE /api/projects/:id/bible/:filename
// POST   /api/projects/:id/bible/compile      -> concat into story_bible.md
// POST   /api/projects/:id/bible/snapshot     -> take snapshot of current bible state
// GET    /api/projects/:id/bible/diff         -> diff current vs latest snapshot

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const projects = require('../services/projects');
const bible = require('../services/sdk_bible');
const bibleDiff = require('../services/sdk_bible_diff');
const bibleParser = require('../services/story_bible_parser');

const router = express.Router();

// In-memory cache for /bible/parsed — keyed by project local_path, invalidated
// when the underlying story_bible.md mtime changes. Read by /parsed endpoint
// + (eventually) by every stage prompt that asks for typed bible data.
const _parsedCache = new Map();

function loadCompiledBible(localPath) {
  // The parser keys off `## SECTION` headers from the original rich source
  // bible. The per-section bible/*.md files use level-1 `#` headers, so
  // concatenating them would defeat the section detector. PREFER the flat
  // sdk_data/story_bible.md (always written by /bible/ingest + the legacy
  // template seeder) — fall back to the section concat only if it's
  // missing AND the section files happen to keep `##` headers.
  const compiledPath = path.join(localPath, 'sdk_data', 'story_bible.md');
  const dirPath = path.join(localPath, 'sdk_data', 'bible');
  let raw = null;
  let mtime = 0;
  try {
    if (fs.existsSync(compiledPath)) {
      const st = fs.statSync(compiledPath);
      mtime = st.mtimeMs;
      raw = fs.readFileSync(compiledPath, 'utf8');
    } else if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath)
        .filter((f) => /^[a-z0-9][a-z0-9_-]*\.md$/.test(f))
        .sort();
      if (files.length > 0) {
        const parts = [];
        for (const f of files) {
          const fp = path.join(dirPath, f);
          const st = fs.statSync(fp);
          if (st.mtimeMs > mtime) mtime = st.mtimeMs;
          parts.push(fs.readFileSync(fp, 'utf8').trimEnd());
        }
        raw = parts.join('\n\n---\n\n') + '\n';
      }
    }
  } catch (_e) { /* swallow — return null so caller 404s */ }
  return raw ? { raw, mtime } : null;
}

function sendErr(res, e, fallback = 500) {
  const status = e && e.status ? e.status : fallback;
  res.status(status).json({
    error: (e && e.code) || (e && e.message) || 'server_error',
    detail: (e && e.detail) || null
  });
}

async function loadProject(req, res) {
  const p = await projects.getProject(req.params.id);
  if (!p) { res.status(404).json({ error: 'project_not_found' }); return null; }
  if (!p.local_path) { res.status(422).json({ error: 'no_local_path' }); return null; }
  return p;
}

router.get('/:id/bible', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const sections = await bible.list(p.local_path);
    const compiledPath = require('path').join(p.local_path, 'sdk_data', 'story_bible.md');
    let compiledBytes = null;
    if (fs.existsSync(compiledPath)) compiledBytes = fs.statSync(compiledPath).size;
    res.json({ sections, compiled_bytes: compiledBytes });
  } catch (e) { sendErr(res, e); }
});

// --- Phase 4.7: parsed bible endpoints (declared BEFORE /:filename so
// `parse`, `parsed`, `ingest` don't get swallowed by the section-CRUD route).

router.post('/:id/bible/parse', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const md = (req.body && typeof req.body.markdown === 'string') ? req.body.markdown : '';
    if (!md || md.length < 5) {
      return res.status(400).json({ error: 'markdown_required' });
    }
    const parsed = bibleParser.parseBible(md);
    res.json({
      parsed,
      sections_detected: bibleParser.sectionsDetected(parsed),
      counts: bibleParser.countsFor(parsed),
    });
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/bible/ingest', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const md = (req.body && typeof req.body.markdown === 'string') ? req.body.markdown : '';
    if (!md || md.length < 5) {
      return res.status(400).json({ error: 'markdown_required' });
    }
    const parsed = bibleParser.parseBible(md);
    const outDir = path.join(p.local_path, 'sdk_data', 'bible');
    await fsp.mkdir(outDir, { recursive: true });
    const r = await bibleParser.splitToFiles(parsed, outDir);
    const compiledPath = path.join(p.local_path, 'sdk_data', 'story_bible.md');
    await fsp.mkdir(path.dirname(compiledPath), { recursive: true });
    await fsp.writeFile(compiledPath, md);
    _parsedCache.delete(p.local_path);
    res.json({
      written: r.written,
      compiled_path: compiledPath,
      compiled_bytes: Buffer.byteLength(md, 'utf8'),
      counts: bibleParser.countsFor(parsed),
    });
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/bible/parsed', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const loaded = loadCompiledBible(p.local_path);
    if (!loaded) {
      return res.status(404).json({ error: 'bible_not_found' });
    }
    const cached = _parsedCache.get(p.local_path);
    if (cached && cached.mtime === loaded.mtime) {
      return res.json(cached.parsed);
    }
    const parsed = bibleParser.parseBible(loaded.raw);
    parsed._meta = {
      source_bytes: loaded.raw.length,
      source_mtime: loaded.mtime,
      counts: bibleParser.countsFor(parsed),
    };
    _parsedCache.set(p.local_path, { mtime: loaded.mtime, parsed });
    res.json(parsed);
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/bible/:filename', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const content = await bible.read(p.local_path, req.params.filename);
    res.type('text/markdown; charset=utf-8').send(content);
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/bible/:filename', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const r = await bible.write(p.local_path, req.params.filename,
                                req.body && req.body.content);
    // Auto-compile on every write so story_bible.md stays in sync with
    // the section files. Cheap — concat is O(sections).
    await bible.compile(p.local_path);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

router.delete('/:id/bible/:filename', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const ok = await bible.remove(p.local_path, req.params.filename);
    if (!ok) return res.status(404).json({ error: 'section_not_found' });
    await bible.compile(p.local_path);
    res.json({ deleted: req.params.filename });
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/bible/compile', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const r = await bible.compile(p.local_path);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

router.post('/:id/bible/snapshot', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const r = await bibleDiff.snapshot(p.local_path);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

router.get('/:id/bible/diff', async (req, res) => {
  try {
    const p = await loadProject(req, res); if (!p) return;
    const vs = req.query.vs || 'latest';
    const r = await bibleDiff.diff(p.local_path, vs);
    res.json(r);
  } catch (e) { sendErr(res, e); }
});

module.exports = router;
// Expose the cache + loader for cross-module access (sdk_autopilot reads it
// via these so it can grab parsed bible context without re-parsing inside
// the hot stage path).
module.exports._parsedCache = _parsedCache;
module.exports._loadCompiledBible = loadCompiledBible;
