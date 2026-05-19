'use strict';

// GET /api/projects/:id/card_meta
// Aggregates the "studio shelf card" data the Dashboard renders per project:
// hero title image, scene + character counts, version, last build stat, +
// a direct download URL for the newest packaged .pdx.zip.
//
// All filesystem reads are scoped to the project's local_path and validated
// with realpath() to block symlink escapes — same posture as routes/files.js.

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const projects = require('../services/projects');
const { validateId } = require('../services/validation');

const router = express.Router({ mergeParams: true });

const MAX_ZIP_BYTES = 1024 * 1024 * 1024; // 1 GiB ceiling on raw zip download

async function realPathSafe(p) {
  try { return await fsp.realpath(p); }
  catch (_e) { return null; }
}

// Walk a directory non-recursively and return matching dirents.
async function readDirSafe(absDir) {
  try { return await fsp.readdir(absDir, { withFileTypes: true }); }
  catch (_e) { return []; }
}

// Recursively count files in `absDir` whose name ends with `suffix`.
// Bounded depth so a runaway symlink chain can't spin forever.
async function countByExt(absDir, suffix, depth = 6) {
  if (depth < 0) return 0;
  const ents = await readDirSafe(absDir);
  let n = 0;
  for (const ent of ents) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      n += await countByExt(full, suffix, depth - 1);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith(suffix)) {
      n += 1;
    }
  }
  return n;
}

async function pickTitleImage(base, projectId) {
  // Search order: sdk_data/scenes/title_*.png → source/images/title_screen.png
  // → assets/title.png. Returns the /api/projects/:id/file/raw URL so the
  // browser can pull it through the existing file route (CSP-safe, cookie-
  // authenticated, path-validated).
  const fileRawUrl = (rel) =>
    `/api/projects/${projectId}/file/raw?path=${encodeURIComponent(rel)}`;

  // 1. sdk_data/scenes/title_*.png
  const scenesDir = path.join(base, 'sdk_data', 'scenes');
  const sceneEnts = await readDirSafe(scenesDir);
  const titleMatch = sceneEnts
    .filter((e) => e.isFile() && /^title_.*\.png$/i.test(e.name))
    .map((e) => e.name)
    .sort();
  if (titleMatch.length > 0) {
    return fileRawUrl(path.posix.join('sdk_data', 'scenes', titleMatch[0]));
  }

  // 2. source/images/title_screen.png
  const ss = path.join(base, 'source', 'images', 'title_screen.png');
  if (fs.existsSync(ss)) return fileRawUrl('source/images/title_screen.png');

  // 3. assets/title.png
  const at = path.join(base, 'assets', 'title.png');
  if (fs.existsSync(at)) return fileRawUrl('assets/title.png');

  return null;
}

async function pickSceneCount(base) {
  // Prefer sdk_data/scenes/*.json (declarative scene manifests).
  const jsonDir = path.join(base, 'sdk_data', 'scenes');
  const jsonEnts = await readDirSafe(jsonDir);
  const jsonCount = jsonEnts.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.json')
  ).length;
  if (jsonCount > 0) return jsonCount;
  // Fallback: count *.lua under source/scenes/** (recursive).
  return countByExt(path.join(base, 'source', 'scenes'), '.lua');
}

async function pickCharacterCount(base) {
  const dir = path.join(base, 'sdk_data', 'characters');
  const ents = await readDirSafe(dir);
  return ents.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.png')
  ).length;
}

async function pickVersion(base) {
  const pdx = path.join(base, 'source', 'pdxinfo');
  try {
    const raw = await fsp.readFile(pdx, 'utf8');
    const m = raw.match(/^\s*version\s*=\s*(.+?)\s*$/m);
    return m ? m[1].trim() : null;
  } catch (_e) {
    return null;
  }
}

async function pickLatestBuild(base, projectId) {
  // Newest *.pdx.zip in <local>/build/. Used for both the "last built" pill
  // and the in-card download link — points at the dedicated download route
  // below since /file/raw refuses .pdx.zip (blocked binary).
  const buildDir = path.join(base, 'build');
  const ents = await readDirSafe(buildDir);
  let newest = null;
  for (const ent of ents) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.pdx.zip')) continue;
    const full = path.join(buildDir, ent.name);
    try {
      const s = await fsp.stat(full);
      if (!newest || s.mtimeMs > newest.mtimeMs) {
        newest = { name: ent.name, size: s.size, mtimeMs: s.mtimeMs };
      }
    } catch (_e) { /* skip */ }
  }
  if (!newest) {
    return { last_build_at: null, last_build_size: null, latest_pdx_zip_url: null };
  }
  return {
    last_build_at: Math.round(newest.mtimeMs),
    last_build_size: newest.size,
    latest_pdx_zip_url:
      `/api/projects/${projectId}/card_meta/pdx?name=${encodeURIComponent(newest.name)}`
  };
}

router.get('/:id/card_meta', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.local_path) {
      return res.json({
        title_image_url: null,
        scene_count: 0,
        character_count: 0,
        version: null,
        last_build_at: null,
        last_build_size: null,
        latest_pdx_zip_url: null
      });
    }
    const base = await realPathSafe(project.local_path);
    if (!base) {
      return res.json({
        title_image_url: null,
        scene_count: 0,
        character_count: 0,
        version: null,
        last_build_at: null,
        last_build_size: null,
        latest_pdx_zip_url: null
      });
    }

    const [title_image_url, scene_count, character_count, version, buildInfo] =
      await Promise.all([
        pickTitleImage(base, project.id),
        pickSceneCount(base),
        pickCharacterCount(base),
        pickVersion(base),
        pickLatestBuild(base, project.id)
      ]);

    res.json({
      title_image_url,
      scene_count,
      character_count,
      version,
      ...buildInfo
    });
  } catch (e) { next(e); }
});

// GET /api/projects/:id/card_meta/pdx?name=<basename>
// Streams a *.pdx.zip from <local_path>/build/. Filename-only (no path
// traversal), extension-locked, size-capped, resolved through realpath so
// a symlink in build/ can't redirect outside the project root.
router.get('/:id/card_meta/pdx', async (req, res, next) => {
  try {
    const idErr = validateId(req.params.id);
    if (idErr) return res.status(400).json({ error: 'bad_request', detail: idErr });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.local_path) return res.status(400).json({ error: 'no_local_path' });

    const rawName = String(req.query.name || '');
    // Filename-only: reject any path separator + dotfile + anything not
    // ending in .pdx.zip.
    if (!/^[\w.\- ]+\.pdx\.zip$/i.test(rawName) || rawName.includes('/') ||
        rawName.includes('\\') || rawName.startsWith('.')) {
      return res.status(400).json({ error: 'bad_filename' });
    }

    const base = await realPathSafe(project.local_path);
    if (!base) return res.status(404).json({ error: 'not_found' });

    const buildDir = path.join(base, 'build');
    const joined = path.join(buildDir, rawName);
    const real = await realPathSafe(joined);
    if (!real || !real.startsWith(buildDir + path.sep)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const stat = await fsp.lstat(real);
    if (stat.isSymbolicLink()) return res.status(403).json({ error: 'forbidden' });
    if (!stat.isFile()) return res.status(400).json({ error: 'not_a_file' });
    if (stat.size > MAX_ZIP_BYTES) return res.status(413).json({ error: 'file_too_large' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${rawName}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(real).pipe(res);
  } catch (e) {
    if (e && e.code === 'ENOENT') return res.status(404).json({ error: 'not_found' });
    next(e);
  }
});

module.exports = router;
