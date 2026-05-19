'use strict';

// Phase 6 B12 — Linked-doc service.
//
// Surfaces the three "always-on" reference docs (story bible, style canon,
// SKILL.md) to the LinkedDocPane right-rail. The pane is mounted on
// storyboard / scene-manager / approver, and needs:
//
//   - the full text of each doc (rendered by the pane in tabs)
//   - a section index so the pane can scroll to a relevant section based on
//     the current scene / asset context
//   - per-scene pinned-note storage so authors can pin quotes from any tab
//     into the scene's working notes
//
// All paths live under <local_path>/sdk_data/:
//   sdk_data/source/bible.md      (intake-uploaded)        OR
//   sdk_data/story_bible.md       (rendered from template)
//   sdk_data/canon.md             (canon service)
//   sdk_data/source/skill.md      (intake-uploaded)
//   sdk_data/scenes/<id>.notes.jsonl  (B12 pinned notes — append-only)

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projects = require('./projects');

const MAX_NOTE_BYTES = 4 * 1024;
const MAX_EXCERPT_BYTES = 2 * 1024;

function sdkDir(localPath) { return path.join(localPath, 'sdk_data'); }
function biblePathIntake(localPath) { return path.join(sdkDir(localPath), 'source', 'bible.md'); }
function biblePathRendered(localPath) { return path.join(sdkDir(localPath), 'story_bible.md'); }
function canonPath(localPath) { return path.join(sdkDir(localPath), 'canon.md'); }
function skillPath(localPath) { return path.join(sdkDir(localPath), 'source', 'skill.md'); }
function sceneNotesPath(localPath, sceneId) {
  return path.join(sdkDir(localPath), 'scenes', `${sceneId}.notes.jsonl`);
}

async function readIfPresent(p) {
  try { return await fsp.readFile(p, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// Parse `# Title`, `## Title`, etc. into a flat list. Mirrors canon.js
// section indexing so the pane can use one renderer across all three tabs.
function parseSections(md) {
  const out = [];
  if (!md) return out;
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const level = m[1].length;
    const title = m[2].trim();
    const slug = title.toLowerCase()
      .replace(/[^a-z0-9\s§-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const symMatch = /^(§\s*\d+(?:\.\d+)*)/.exec(title);
    out.push({
      level,
      title,
      anchor: slug || `section-${i + 1}`,
      section_symbol: symMatch ? symMatch[1].replace(/\s+/g, '') : null,
      line: i + 1
    });
  }
  return out;
}

async function loadProject(projectId) {
  const p = await projects.getProject(projectId);
  if (!p) { const e = new Error('project not found'); e.status = 404; e.code = 'not_found'; throw e; }
  if (!p.local_path) { const e = new Error('project has no local_path'); e.status = 400; e.code = 'no_local_path'; throw e; }
  return p;
}

// readDocs returns all three docs in one round-trip. UI calls this once on
// pane mount; tab switches are local.
async function readDocs(projectId) {
  const proj = await loadProject(projectId);
  const lp = proj.local_path;

  // bible: prefer intake bible.md, fall back to rendered story_bible.md
  let bibleContent = await readIfPresent(biblePathIntake(lp));
  let bibleSource = bibleContent ? 'source/bible.md' : null;
  if (!bibleContent) {
    bibleContent = await readIfPresent(biblePathRendered(lp));
    bibleSource = bibleContent ? 'story_bible.md' : null;
  }
  const canonContent = await readIfPresent(canonPath(lp));
  const skillContent = await readIfPresent(skillPath(lp));

  return {
    project_id: proj.id,
    bible: {
      content: bibleContent || '',
      source: bibleSource,
      sections: parseSections(bibleContent || ''),
      present: !!bibleContent
    },
    canon: {
      content: canonContent || '',
      source: canonContent ? 'canon.md' : null,
      sections: parseSections(canonContent || ''),
      present: !!canonContent
    },
    skill: {
      content: skillContent || '',
      source: skillContent ? 'source/skill.md' : null,
      sections: parseSections(skillContent || ''),
      present: !!skillContent
    }
  };
}

// Append a pinned note to a scene's notes file. Notes are JSONL so we can
// stream-read large lists and easily migrate; the small size cap per note +
// per-call validation prevents pathological growth.
//
// Each entry:
//   { id, scene_id, tab, anchor?, excerpt, note?, pinned_by, pinned_at, source_path }
async function pinNote(projectId, sceneId, body) {
  const proj = await loadProject(projectId);
  if (!sceneId || typeof sceneId !== 'string') {
    const e = new Error('scene_id required'); e.status = 400; throw e;
  }
  const tab = String((body && body.tab) || '').toLowerCase();
  if (!['bible', 'canon', 'skill'].includes(tab)) {
    const e = new Error('tab must be one of: bible, canon, skill'); e.status = 400; throw e;
  }
  const excerpt = typeof body.excerpt === 'string'
    ? body.excerpt.slice(0, MAX_EXCERPT_BYTES)
    : '';
  if (!excerpt.trim()) {
    const e = new Error('excerpt required'); e.status = 400; throw e;
  }
  const note = typeof body.note === 'string'
    ? body.note.slice(0, MAX_NOTE_BYTES)
    : '';
  const anchor = body.anchor == null ? null : String(body.anchor).slice(0, 256);
  const sourcePath = (() => {
    switch (tab) {
      case 'bible': return 'sdk_data/source/bible.md OR sdk_data/story_bible.md';
      case 'canon': return 'sdk_data/canon.md';
      case 'skill': return 'sdk_data/source/skill.md';
      default: return null;
    }
  })();

  const entry = {
    id: 'note-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
    scene_id: sceneId,
    tab,
    anchor,
    excerpt,
    note,
    pinned_by: typeof body.pinned_by === 'string' ? body.pinned_by.slice(0, 64) : 'studio',
    pinned_at: new Date().toISOString(),
    source_path: sourcePath
  };

  const file = sceneNotesPath(proj.local_path, sceneId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
  return entry;
}

async function readNotes(projectId, sceneId) {
  const proj = await loadProject(projectId);
  const file = sceneNotesPath(proj.local_path, sceneId);
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { items: [] }; throw e; }
  const items = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { items.push(JSON.parse(line)); }
    catch (_e) { /* skip malformed */ }
  }
  return { items, count: items.length };
}

async function deleteNote(projectId, sceneId, noteId) {
  const proj = await loadProject(projectId);
  const file = sceneNotesPath(proj.local_path, sceneId);
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') { const er = new Error('not found'); er.status = 404; throw er; } throw e; }
  const lines = raw.split('\n').filter(Boolean);
  const kept = [];
  let removed = null;
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (_e) { continue; }
    if (obj && obj.id === noteId) removed = obj;
    else kept.push(line);
  }
  if (!removed) { const er = new Error('not found'); er.status = 404; throw er; }
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, kept.length ? kept.join('\n') + '\n' : '', { mode: 0o600 });
  await fsp.rename(tmp, file);
  return removed;
}

module.exports = {
  readDocs,
  pinNote,
  readNotes,
  deleteNote,
  _internals: { parseSections, biblePathIntake, biblePathRendered, canonPath, skillPath, sceneNotesPath }
};
