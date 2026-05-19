'use strict';

// Canon document service (Phase 6 B4).
//
// Canon lives at `<local_path>/sdk_data/source/canon.md` as a symlink
// pointing at the latest `canon_versions/v<N>.md`. Editing canon writes a
// new versioned file and atomically retargets the symlink, so every edit is
// recoverable + git-trackable.
//
// `getUsage()` reads `<local_path>/sdk_data/work_graph.json` (A7's output)
// and returns a map of canon-section anchor -> list of work-graph node ids
// that cite it. If the work graph hasn't shipped yet, returns an empty map.

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const projects = require('./projects');

function canonRoot(project) {
  return path.join(project.local_path, 'sdk_data', 'source');
}

function canonFile(project) {
  return path.join(canonRoot(project), 'canon.md');
}

function versionsDir(project) {
  return path.join(canonRoot(project), 'canon_versions');
}

function workGraphFile(project) {
  return path.join(project.local_path, 'sdk_data', 'work_graph.json');
}

async function loadProject(projectId) {
  const project = await projects.getProject(projectId);
  if (!project) {
    const err = new Error('project not found');
    err.status = 404;
    err.code = 'not_found';
    throw err;
  }
  return project;
}

async function readCanonMarkdown(project) {
  try {
    return await fsp.readFile(canonFile(project), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return '';
    throw e;
  }
}

// Parse `# Title`, `## Title`, `### Title` headings into a flat anchor
// list. Anchor format mirrors GitHub: lowercase, hyphenated, ASCII-only.
// Also recognise explicit `§N` markers (the canon doc's own convention)
// and treat them as siblings — useful since the spec talks about “§4”.
function parseSections(md) {
  const out = [];
  if (!md) return out;
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const title = m[2].trim();
    const slug = title.toLowerCase()
      .replace(/[^a-z0-9\s§-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    // If the heading itself starts with `§N`, expose `§N` as a second anchor
    // form so "Used by" lookups work whether the citer wrote `§4` or
    // `inside-the-vault`.
    const symbolMatch = /^(§\s*\d+(?:\.\d+)*)/.exec(title);
    out.push({
      level,
      title,
      anchor: slug || `section-${i + 1}`,
      section_symbol: symbolMatch ? symbolMatch[1].replace(/\s+/g, '') : null,
      line: i + 1
    });
  }
  return out;
}

async function readWorkGraph(project) {
  try {
    const raw = await fsp.readFile(workGraphFile(project), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return null; // tolerate malformed work_graph.json — usage is best-effort
  }
}

// A7 work-graph node shape (per spec): each node has a `canon_refs` array of
// section identifiers (anchor or symbol). We tolerate either.
function indexUsage(graph) {
  const out = Object.create(null);
  if (!graph) return out;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes
              : Array.isArray(graph)       ? graph
              : [];
  for (const node of nodes) {
    if (!node || !node.id) continue;
    const refs = Array.isArray(node.canon_refs) ? node.canon_refs : [];
    for (const ref of refs) {
      const key = String(ref).trim();
      if (!key) continue;
      if (!out[key]) out[key] = [];
      if (!out[key].includes(node.id)) out[key].push(node.id);
    }
  }
  return out;
}

async function getCanon(projectId) {
  const project = await loadProject(projectId);
  const content = await readCanonMarkdown(project);
  const sections = parseSections(content);
  // Best-effort: surface which version file is currently active (the symlink
  // target). Useful for the editor to show "you're editing v3".
  let active_version = null;
  try {
    const target = await fsp.readlink(canonFile(project));
    active_version = path.basename(target);
  } catch (_e) {
    // canon.md is a regular file (or absent) — no version label.
  }
  return { content, sections, active_version };
}

async function getCanonUsage(projectId) {
  const project = await loadProject(projectId);
  const graph = await readWorkGraph(project);
  const usage = indexUsage(graph);
  return { usage, source: graph ? 'work_graph.json' : 'empty' };
}

// Create a new versioned canon file + retarget symlink atomically.
// Returns { version, file } so the caller can confirm. `edit_note` is stored
// as the first comment line of the version file to give the history meaning.
async function saveCanon(projectId, content, opts = {}) {
  if (typeof content !== 'string' || !content) {
    const err = new Error('content required');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  const project = await loadProject(projectId);
  await fsp.mkdir(versionsDir(project), { recursive: true, mode: 0o700 });

  // Pick the next version number by scanning existing v<N>.md files.
  let entries = [];
  try {
    entries = await fsp.readdir(versionsDir(project));
  } catch (_e) { /* dir didn't exist, just created */ }
  let next = 1;
  for (const name of entries) {
    const m = /^v(\d+)\.md$/.exec(name);
    if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
  }

  const note = (opts.edit_note || '').toString().replace(/\r?\n/g, ' ').slice(0, 240);
  const editor = (opts.actor || 'studio').toString().slice(0, 64);
  const stamp = new Date().toISOString();
  const header = `<!-- canon v${next} — ${stamp} — by ${editor}${note ? ` — note: ${note}` : ''} -->\n`;

  const versionFile = path.join(versionsDir(project), `v${next}.md`);
  await fsp.writeFile(versionFile, header + content, { mode: 0o600 });

  // Retarget canon.md to point at the new version.
  const link = canonFile(project);
  try { await fsp.unlink(link); } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
  await fsp.symlink(path.relative(canonRoot(project), versionFile), link);

  return {
    version: next,
    file: path.relative(project.local_path, versionFile),
    edit_note: note || null,
    saved_at: stamp
  };
}

module.exports = {
  getCanon,
  getCanonUsage,
  saveCanon,
  // exposed for tests
  _internal: { parseSections, indexUsage, canonFile, versionsDir }
};
