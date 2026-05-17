'use strict';

const express = require('express');
const path = require('path');
const fsp = require('fs/promises');

const projects = require('../services/projects');
const { validateId, validateRelativePath } = require('../services/validation');

const router = express.Router({ mergeParams: true });

const MAX_FILE_BYTES = 1024 * 1024;
const EXCLUDED_NAMES = new Set(['.env', '.git', 'node_modules', '.DS_Store']);
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff',
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
  '.mp4', '.mov', '.avi', '.webm', '.mkv',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.psd', '.ai', '.sketch',
  '.so', '.dylib', '.dll', '.exe', '.bin', '.dat',
  '.pdz', '.pdx', '.pdt',
  '.ttf', '.otf', '.woff', '.woff2'
]);

async function realPathSafe(p) {
  try { return await fsp.realpath(p); }
  catch (_e) { return null; }
}

async function resolveSafe(project, rel) {
  const relErr = validateRelativePath(rel || '');
  if (relErr) return { error: relErr, status: 400 };
  const base = await realPathSafe(project.local_path);
  if (!base) return { error: 'project local_path missing', status: 500 };
  const joined = path.resolve(base, rel || '');
  const real = await realPathSafe(joined) || joined;
  if (real !== base && !real.startsWith(base + path.sep)) {
    return { error: 'path escapes project root', status: 400 };
  }
  return { abs: real, base };
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true;
  }
  return false;
}

router.get('/:id/files', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });

    const r = await resolveSafe(project, req.query.path || '');
    if (r.error) return res.status(r.status).json({ error: 'bad_request', detail: r.error });

    const stat = await fsp.stat(r.abs);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'not_a_directory' });

    const entries = await fsp.readdir(r.abs, { withFileTypes: true });
    const items = [];
    for (const ent of entries) {
      if (EXCLUDED_NAMES.has(ent.name)) continue;
      const full = path.join(r.abs, ent.name);
      let s;
      try { s = await fsp.lstat(full); } catch (_e) { continue; }
      if (s.isSymbolicLink()) continue;
      items.push({
        name: ent.name,
        type: s.isDirectory() ? 'dir' : (s.isFile() ? 'file' : 'other'),
        size: s.isFile() ? s.size : null,
        modified: s.mtimeMs
      });
    }
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ path: req.query.path || '', items });
  } catch (e) {
    if (e && e.code === 'ENOENT') return res.status(404).json({ error: 'not_found' });
    next(e);
  }
});

router.get('/:id/file', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });

    const r = await resolveSafe(project, req.query.path || '');
    if (r.error) return res.status(r.status).json({ error: 'bad_request', detail: r.error });

    const base = r.base;
    const abs = r.abs;
    const baseName = path.basename(abs);
    if (EXCLUDED_NAMES.has(baseName)) return res.status(403).json({ error: 'forbidden' });
    const relParts = path.relative(base, abs).split(path.sep);
    if (relParts.some((p) => EXCLUDED_NAMES.has(p))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const stat = await fsp.lstat(abs);
    if (stat.isSymbolicLink()) return res.status(403).json({ error: 'forbidden' });
    if (!stat.isFile()) return res.status(400).json({ error: 'not_a_file' });
    if (stat.size > MAX_FILE_BYTES) return res.status(413).json({ error: 'file_too_large', max: MAX_FILE_BYTES });

    const ext = path.extname(abs).toLowerCase();
    if (BINARY_EXTS.has(ext)) return res.status(415).json({ error: 'binary_file' });

    const buf = await fsp.readFile(abs);
    if (looksBinary(buf)) return res.status(415).json({ error: 'binary_file' });

    res.json({
      path: req.query.path || '',
      size: stat.size,
      modified: stat.mtimeMs,
      ext,
      content: buf.toString('utf8')
    });
  } catch (e) {
    if (e && e.code === 'ENOENT') return res.status(404).json({ error: 'not_found' });
    next(e);
  }
});

module.exports = router;
