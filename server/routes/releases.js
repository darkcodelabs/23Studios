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
    let proc;
    try { proc = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) {
      const err = new Error('gh_not_installed'); err.kind = 'gh_not_installed';
      return reject(err);
    }
    let out = '', err = '';
    proc.stdout.on('data', (b) => { out += b; });
    proc.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      const e = new Error('gh_timeout'); e.kind = 'timeout';
      reject(e);
    }, timeoutMs);
    proc.on('error', (e) => {
      clearTimeout(timer);
      const wrapped = new Error('gh_not_installed: ' + e.message);
      wrapped.kind = 'gh_not_installed';
      reject(wrapped);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const lower = (err || '').toLowerCase();
        const wrapped = new Error('gh ' + code + ': ' + err.slice(0, 200));
        if (/http 404|not found|could not resolve|repository .* not found/i.test(lower)) {
          wrapped.kind = 'repo_not_on_github';
        } else if (/auth|login|token|gh auth login/i.test(lower)) {
          wrapped.kind = 'gh_not_authenticated';
        } else {
          wrapped.kind = 'gh_failed';
        }
        return reject(wrapped);
      }
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

router.get('/:id/releases', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
    const project = await projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.repo) {
      return res.json({ releases: [], warning: 'no_repo',
        detail: 'project has no Git repo URL configured' });
    }
    const m = project.repo.match(REPO_RE);
    if (!m) {
      return res.json({ releases: [], warning: 'repo_not_github',
        detail: 'project.repo is not a GitHub URL: ' + project.repo });
    }
    const slug = `${m[1]}/${m[2]}`;
    let list;
    try {
      list = await ghJson(['release', 'list', '--repo', slug, '--limit', '50',
                           '--json', 'tagName,name,publishedAt,isLatest,isDraft,isPrerelease']);
    } catch (e) {
      const kind = e.kind || 'gh_failed';
      const detail = kind === 'gh_not_installed' ? 'install gh CLI on the host to enable releases sync'
        : kind === 'gh_not_authenticated' ? 'run `gh auth login` on the host'
        : kind === 'repo_not_on_github' ? `${slug} does not exist on GitHub or is private`
        : kind === 'timeout' ? 'gh CLI timed out after 8s'
        : 'gh CLI failed: ' + (e.message || 'unknown');
      return res.json({ releases: [], repo: slug, warning: kind, detail });
    }
    const tags = list.filter((r) => !r.isDraft).map((r) => r.tagName);
    const out = [];
    for (const tag of tags) {
      try {
        const view = await ghJson(['release', 'view', tag, '--repo', slug, '--json',
                                   'tagName,name,publishedAt,isLatest,isPrerelease,assets']);
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
    // Reserve 500 for genuinely unexpected errors (project lookup crash, etc.)
    res.status(500).json({ error: 'internal_error', detail: String(e).slice(0, 200) });
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
