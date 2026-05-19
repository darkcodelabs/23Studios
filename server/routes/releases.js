'use strict';

// releases.js
//
// GET  /api/projects/:id/releases              — GitHub releases list (existing)
// POST /api/projects/:id/releases/pack         — trigger local release packaging (Step 10)
// GET  /api/projects/:id/releases/pack/latest  — most recently packed release manifest

const express = require('express');
const { spawn } = require('child_process');
const projects = require('../services/projects');
const packager = require('../services/sdk_release_packager');

const router = express.Router();
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const REPO_RE = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;
const TAG_RE = /^[a-zA-Z0-9._+/-]{1,64}$/;

function ghJson(args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (b) => { out += b; });
    proc.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('gh timeout')); }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('gh ' + code + ': ' + err.slice(0, 200)));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

router.get('/:id/releases', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.repo) return res.json({ releases: [] });
    const m = project.repo.match(REPO_RE);
    if (!m) return res.json({ releases: [] });
    const slug = `${m[1]}/${m[2]}`;
    const list = await ghJson(['release', 'list', '--repo', slug, '--limit', '50', '--json', 'tagName,name,publishedAt,isLatest,isDraft,isPrerelease']);
    const tags = list.filter((r) => !r.isDraft).map((r) => r.tagName);
    // Fetch assets per release (parallel-ish, bounded)
    const out = [];
    for (const tag of tags) {
      try {
        const view = await ghJson(['release', 'view', tag, '--repo', slug, '--json', 'tagName,name,publishedAt,isLatest,isPrerelease,assets']);
        out.push({
          tag: view.tagName,
          name: view.name || view.tagName,
          published_at: view.publishedAt,
          is_latest: !!view.isLatest,
          is_prerelease: !!view.isPrerelease,
          assets: (view.assets || []).filter((a) => /\.pdx\.zip$|\.pdx$/.test(a.name)).map((a) => ({
            name: a.name,
            size: a.size,
            url: `https://github.com/${slug}/releases/download/${view.tagName}/${a.name}`
          }))
        });
      } catch (_e) { /* skip unreadable tag */ }
    }
    res.json({ repo: slug, releases: out });
  } catch (e) {
    res.status(500).json({ error: 'gh_failed', detail: String(e).slice(0, 200) });
  }
});

// POST /api/projects/:id/releases/pack
// Body: { tag: string, include_screenshots?: bool, force?: bool }
// Returns: { release_dir, tag, files, screenshots_copied, pdx_zipped }
router.post('/:id/releases/pack', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
    const body = req.body || {};
    const tag = String(body.tag || 'v0.1.0');
    if (!TAG_RE.test(tag)) return res.status(400).json({ error: 'invalid_tag', detail: 'tag must match [a-zA-Z0-9._+/-]{1,64}' });
    const result = await packager.pack(req.params.id, {
      tag,
      force: !!body.force,
      include_screenshots: body.include_screenshots !== false
    });
    res.json(result);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || 'pack_failed', detail: String(e).slice(0, 400) });
  }
});

// GET /api/projects/:id/releases/pack/latest
// Returns the manifest of the most recently packed local release.
router.get('/:id/releases/pack/latest', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
    const result = await packager.getLatestPack(req.params.id);
    if (!result) return res.status(404).json({ error: 'no_pack_found' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'pack_latest_failed', detail: String(e).slice(0, 400) });
  }
});

module.exports = router;
