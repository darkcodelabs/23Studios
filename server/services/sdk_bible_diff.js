'use strict';

// sdk_bible_diff.js — Bible snapshot + diff service.
//
// snapshot(localPath) — copies sdk_data/bible/ into sdk_data/bible_snapshots/<iso>/
//   and writes sdk_data/bible_snapshots/latest.json { taken_at, files: { filename: sha256 } }.
//   Called fire-and-forget after each autopilot stage.
//
// diff(localPath, vsSnapshot?) — compares current bible against a snapshot.
//   Returns { since, added, modified, removed, impact }.
//
// Routes (mounted in routes/bible.js):
//   POST /api/projects/:id/bible/snapshot
//   GET  /api/projects/:id/bible/diff

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function bibleDir(localPath) {
  return path.join(localPath, 'sdk_data', 'bible');
}

function snapshotRoot(localPath) {
  return path.join(localPath, 'sdk_data', 'bible_snapshots');
}

function latestJsonPath(localPath) {
  return path.join(snapshotRoot(localPath), 'latest.json');
}

async function sha256File(fp) {
  try {
    const buf = await fsp.readFile(fp);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (_e) {
    return null;
  }
}

// Returns { filename: sha256 } for all .md files in bibleDir.
async function hashCurrentBible(localPath) {
  const dir = bibleDir(localPath);
  const hashes = {};
  let entries = [];
  try { entries = await fsp.readdir(dir); } catch (_e) { return hashes; }
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const h = await sha256File(path.join(dir, f));
    if (h) hashes[f] = h;
  }
  return hashes;
}

async function snapshot(localPath) {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const snapDir = path.join(snapshotRoot(localPath), iso);
  const srcDir = bibleDir(localPath);

  await fsp.mkdir(snapDir, { recursive: true });

  // Copy every .md file into the snapshot folder.
  let entries = [];
  try { entries = await fsp.readdir(srcDir); } catch (_e) { /* empty bible */ }

  const files = {};
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const src = path.join(srcDir, f);
    const dst = path.join(snapDir, f);
    try {
      const buf = await fsp.readFile(src);
      await fsp.writeFile(dst, buf);
      files[f] = crypto.createHash('sha256').update(buf).digest('hex');
    } catch (_e) { /* skip unreadable */ }
  }

  const manifest = { taken_at: iso, files };
  await fsp.writeFile(latestJsonPath(localPath), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function loadSnapshot(localPath, vsSnapshot) {
  const root = snapshotRoot(localPath);
  let manifest;
  if (!vsSnapshot || vsSnapshot === 'latest') {
    try {
      const raw = await fsp.readFile(latestJsonPath(localPath), 'utf8');
      manifest = JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  } else {
    // vsSnapshot is an iso timestamp string — load that folder's files.
    const snapDir = path.join(root, vsSnapshot);
    const files = {};
    let entries = [];
    try { entries = await fsp.readdir(snapDir); } catch (_e) { return null; }
    for (const f of entries) {
      if (!f.endsWith('.md')) continue;
      const h = await sha256File(path.join(snapDir, f));
      if (h) files[f] = h;
    }
    manifest = { taken_at: vsSnapshot, files };
  }
  return manifest;
}

// Heuristic impact analysis from changed filenames + content.
async function analyzeImpact(localPath, added, modified, removed) {
  const all = [...added, ...modified, ...removed];
  const impact = {
    characters_changed: [],
    scenes_changed: [],
    tone_changed: false,
    do_not_changed: false,
    setting_anchors_changed: false,
  };

  const castRe = /^(?:02_cast|cast_.+)\.md$/;
  const sceneRe = /^scene_(.+)\.md$/;
  const toneRe = /^(?:05_tone|06_dither|07_setting_anchors)\.md$/;
  const doNotRe = /^09_do_not\.md$/;
  const settingRe = /^(?:01_era_location|07_setting_anchors)\.md$/;

  for (const f of all) {
    if (doNotRe.test(f)) { impact.do_not_changed = true; }
    if (toneRe.test(f)) { impact.tone_changed = true; }
    if (settingRe.test(f)) { impact.setting_anchors_changed = true; }

    // scene_<id>.md → scenes_changed includes <id>
    const sm = f.match(sceneRe);
    if (sm) {
      const sceneId = sm[1];
      if (!impact.scenes_changed.includes(sceneId)) impact.scenes_changed.push(sceneId);
    }

    // Cast file → parse character names from the current content.
    if (castRe.test(f)) {
      const fp = path.join(bibleDir(localPath), f);
      let content = '';
      try { content = await fsp.readFile(fp, 'utf8'); } catch (_e) { /* deleted */ }
      // Extract names from H2 headings (## Name) or bolded names (**Name**).
      const h2s = [...content.matchAll(/^##\s+(.+?)$/gm)].map((m) => m[1].trim());
      const bolds = [...content.matchAll(/\*\*([A-Z][a-z]+(?: [A-Z][a-z]+)*)\*\*/g)].map((m) => m[1]);
      const names = [...new Set([...h2s, ...bolds])].map((n) => n.toLowerCase().replace(/\s+/g, '_'));
      for (const n of names) {
        if (!impact.characters_changed.includes(n)) impact.characters_changed.push(n);
      }
    }
  }

  return impact;
}

async function diff(localPath, vsSnapshot) {
  const snap = await loadSnapshot(localPath, vsSnapshot || 'latest');
  if (!snap) {
    return {
      since: null,
      added: [],
      modified: [],
      removed: [],
      impact: {
        characters_changed: [],
        scenes_changed: [],
        tone_changed: false,
        do_not_changed: false,
        setting_anchors_changed: false,
      }
    };
  }

  const current = await hashCurrentBible(localPath);
  const snapFiles = snap.files || {};

  const added = [];
  const modified = [];
  const removed = [];

  for (const [f, h] of Object.entries(current)) {
    if (!snapFiles[f]) added.push(f);
    else if (snapFiles[f] !== h) modified.push(f);
  }
  for (const f of Object.keys(snapFiles)) {
    if (!current[f]) removed.push(f);
  }

  const impact = await analyzeImpact(localPath, added, modified, removed);

  return { since: snap.taken_at, added, modified, removed, impact };
}

module.exports = { snapshot, diff, _internals: { hashCurrentBible, analyzeImpact } };
