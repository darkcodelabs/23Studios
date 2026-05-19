'use strict';

// sdk_bible.js — modular story bible management.
//
// Layout under <local_path>/sdk_data/bible/:
//   00_premise.md
//   01_era_location.md
//   02_cast.md
//   ...
//   custom_<slug>.md          (user-added)
//   cast_<character>.md       (per-character additions)
//   scene_<id>.md             (per-scene additions)
//
// Files are concatenated in sorted filename order into the canonical
// <local_path>/sdk_data/story_bible.md that sdk_autopilot.readStoryBible
// already consumes. No data shape changes downstream.
//
// API:
//   list(localPath)           -> [{ filename, title, bytes, mtime }]
//   read(localPath, filename) -> string
//   write(localPath, filename, content) -> { filename, bytes }
//   delete(localPath, filename) -> boolean
//   compile(localPath)        -> { bytes, sections: N, path }
//
// Filename rules: must match /^[a-z0-9][a-z0-9_-]*\.md$/, length <= 80.
// No subdirs (yet), no traversal.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const FILENAME_RE = /^[a-z0-9][a-z0-9_-]*\.md$/;
const MAX_FILENAME = 80;
const MAX_BYTES = 256 * 1024;

function bibleDir(localPath) {
  return path.join(localPath, 'sdk_data', 'bible');
}

function safeName(name) {
  if (typeof name !== 'string' || name.length > MAX_FILENAME) return null;
  if (!FILENAME_RE.test(name)) return null;
  return name;
}

async function list(localPath) {
  const dir = bibleDir(localPath);
  try { await fsp.mkdir(dir, { recursive: true }); } catch (_e) { /* */ }
  const entries = await fsp.readdir(dir);
  const out = [];
  for (const f of entries.sort()) {
    if (!FILENAME_RE.test(f)) continue;
    try {
      const st = await fsp.stat(path.join(dir, f));
      if (!st.isFile()) continue;
      const head = (await fsp.readFile(path.join(dir, f), 'utf8')).slice(0, 200);
      const titleMatch = head.match(/^#\s+(.+?)$/m);
      out.push({
        filename: f,
        title: titleMatch ? titleMatch[1].trim() : f,
        bytes: st.size,
        mtime: st.mtimeMs
      });
    } catch (_e) { /* skip */ }
  }
  return out;
}

async function read(localPath, filename) {
  const safe = safeName(filename);
  if (!safe) { const e = new Error('invalid_filename'); e.status = 400; throw e; }
  const fp = path.join(bibleDir(localPath), safe);
  if (!fs.existsSync(fp)) { const e = new Error('section_not_found'); e.status = 404; throw e; }
  return fsp.readFile(fp, 'utf8');
}

async function write(localPath, filename, content) {
  const safe = safeName(filename);
  if (!safe) { const e = new Error('invalid_filename'); e.status = 400; throw e; }
  if (typeof content !== 'string') {
    const e = new Error('content_must_be_string'); e.status = 400; throw e;
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    const e = new Error('section_too_large'); e.status = 413; throw e;
  }
  const dir = bibleDir(localPath);
  await fsp.mkdir(dir, { recursive: true });
  const fp = path.join(dir, safe);
  await fsp.writeFile(fp, content);
  const st = await fsp.stat(fp);
  return { filename: safe, bytes: st.size };
}

async function remove(localPath, filename) {
  const safe = safeName(filename);
  if (!safe) { const e = new Error('invalid_filename'); e.status = 400; throw e; }
  const fp = path.join(bibleDir(localPath), safe);
  if (!fs.existsSync(fp)) return false;
  await fsp.unlink(fp);
  return true;
}

async function compile(localPath) {
  const sections = await list(localPath);
  const dir = bibleDir(localPath);
  const parts = [];
  for (const s of sections) {
    try {
      const raw = await fsp.readFile(path.join(dir, s.filename), 'utf8');
      parts.push(raw.trimEnd());
    } catch (_e) { /* skip */ }
  }
  const concat = parts.join('\n\n---\n\n') + '\n';
  const outPath = path.join(localPath, 'sdk_data', 'story_bible.md');
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, concat);
  return { path: outPath, bytes: Buffer.byteLength(concat, 'utf8'),
           sections: sections.length };
}

module.exports = { list, read, write, remove, compile, bibleDir };
