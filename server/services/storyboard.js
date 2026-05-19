'use strict';

// Phase 6 B1 — Storyboard service.
//
// Aggregates a project's scene list from two sources and returns cards
// suitable for the storyboard grid UI:
//
//   1. <local_path>/source/scenes/**/*.lua            (real, hand-written)
//   2. <local_path>/sdk_data/scenes/*.json (+ .png)   (autopilot-emitted)
//   3. <local_path>/sdk_data/project.json scenes[]    (autopilot manifest)
//
// All three are merged on a stable scene_id. The Lua scan is intentionally
// lightweight — we only sniff the first ~3KB looking for header comments,
// `local title = "..."`, `scene_manager.push("name", ...)` calls — enough to
// build a passable card without parsing Lua. Per-scene drilldown (B2) does the
// expensive work.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const SCENE_LUA_HEADER_BYTES = 4096;

function sceneIdFromLuaPath(luaPath, sourceScenesDir) {
  const rel = path.relative(sourceScenesDir, luaPath);
  // strip extension, replace path separators with '_' so nested dirs become
  // stable composite ids (e.g. pwnglove/panel_wires.lua -> pwnglove_panel_wires)
  const noExt = rel.replace(/\.lua$/i, '');
  return noExt.split(path.sep).join('_');
}

function titleCase(s) {
  return String(s || '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function* walkLuaFiles(dir) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (_e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkLuaFiles(full);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.lua')) {
      yield full;
    }
  }
}

// Pull a one-line summary from a Lua scene file: prefer the first
// `-- ... ` comment block at the top, then a `local title =`/`M.title =`
// assignment, then the basename.
async function sniffLuaScene(absPath) {
  let head = '';
  try {
    const fd = await fsp.open(absPath, 'r');
    try {
      const buf = Buffer.alloc(SCENE_LUA_HEADER_BYTES);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      head = buf.slice(0, bytesRead).toString('utf8');
    } finally {
      await fd.close();
    }
  } catch (_e) { /* ignore — file may have been deleted mid-scan */ }

  const lines = head.split(/\r?\n/);
  let summary = '';
  // First contiguous comment block at the top of the file.
  const commentLines = [];
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (trimmed.startsWith('--')) {
      const body = trimmed.replace(/^-+\s?/, '').trim();
      if (body) commentLines.push(body);
    } else if (trimmed === '') {
      if (commentLines.length) break;
    } else {
      break;
    }
  }
  if (commentLines.length) summary = commentLines.join(' ').slice(0, 240);

  // Title assignment heuristic.
  let title = '';
  const titleMatch = head.match(/(?:^|\n)\s*(?:local\s+title|M\.title)\s*=\s*["'`]([^"'`]+)["'`]/);
  if (titleMatch) title = titleMatch[1];

  // Mechanic / kit guess — looks for `kit = require("...")` or comment hints.
  let mechanic = '';
  const kitMatch = head.match(/(?:kit|recipe|template)\s*=\s*["']([\w_-]+)["']/i);
  if (kitMatch) mechanic = kitMatch[1];

  // Characters present — `dialog.pick("name"...)` and `npc.spawn("name"...)`.
  const characters = new Set();
  const reChars = /(?:dialog\.pick|npc\.spawn|spawnCharacter|character_id)\s*\(?\s*["']([\w_-]+)["']/g;
  let m;
  while ((m = reChars.exec(head)) !== null) characters.add(m[1]);

  return {
    summary,
    title,
    mechanic,
    characters: Array.from(characters)
  };
}

async function fileExists(p) {
  try { await fsp.access(p); return true; }
  catch (_e) { return false; }
}

async function readJsonSafe(p) {
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (_e) { return null; }
}

// Decide the status pill from what artifacts exist.
function deriveStatus({ hasLua, hasPng, hasJson, autopilotStatus, qaFailed }) {
  if (qaFailed) return 'failed';
  if (autopilotStatus === 'failed') return 'failed';
  if (hasLua && hasPng) return 'done';
  if (hasLua || hasPng || hasJson) return 'in_progress';
  return 'pending';
}

// Main entry. Returns { scenes: [...], counts: {...} }.
async function buildStoryboard(project) {
  const local = project.local_path;
  if (!local || !fs.existsSync(local)) {
    return { scenes: [], counts: { total: 0, by_status: {} } };
  }

  const sourceScenesDir = path.join(local, 'source', 'scenes');
  const sdkScenesDir = path.join(local, 'sdk_data', 'scenes');
  const sdkProjectFile = path.join(local, 'sdk_data', 'project.json');

  const cards = new Map(); // scene_id -> card

  function ensure(id) {
    if (!cards.has(id)) {
      cards.set(id, {
        scene_id: id,
        title: titleCase(id),
        summary: '',
        status: 'pending',
        thumbnail_path: null, // path relative to project root, for /file/raw
        characters_present: [],
        mechanic: '',
        anchor_refs: [],
        sources: [], // which inputs contributed (lua | sdk_json | manifest)
        lua_path: null,
        json_path: null,
        png_path: null,
        act: null,
        notes: ''
      });
    }
    return cards.get(id);
  }

  function mergeCharacters(card, extra) {
    if (!Array.isArray(extra) || !extra.length) return;
    const set = new Set([...(card.characters_present || []), ...extra]);
    card.characters_present = Array.from(set);
  }

  // Pass 1 — autopilot manifest in project.json (most authoritative).
  const sdkProject = await readJsonSafe(sdkProjectFile);
  if (sdkProject && Array.isArray(sdkProject.scenes)) {
    for (const s of sdkProject.scenes) {
      if (!s || !s.id) continue;
      const c = ensure(s.id);
      c.sources.push('manifest');
      if (s.name) c.title = s.name;
      if (s.description) c.summary = String(s.description).slice(0, 240);
      if (s.act) c.act = s.act;
      if (s.style_reference) c.anchor_refs.push(s.style_reference);
      if (s.mechanic) c.mechanic = s.mechanic;
      if (s.kit) c.mechanic = c.mechanic || s.kit;
      mergeCharacters(c, s.characters);
      if (s.status) c._autopilotStatus = s.status;
    }
  }

  // Pass 2 — sdk_data/scenes/*.json (autopilot per-scene side files).
  if (fs.existsSync(sdkScenesDir)) {
    let ents = [];
    try { ents = await fsp.readdir(sdkScenesDir, { withFileTypes: true }); }
    catch (_e) { /* ignore */ }
    for (const e of ents) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.json')) continue;
      const id = e.name.replace(/\.json$/i, '');
      const full = path.join(sdkScenesDir, e.name);
      const data = await readJsonSafe(full);
      const c = ensure(id);
      c.sources.push('sdk_json');
      c.json_path = path.relative(local, full);
      if (data) {
        if (data.title && !c.title) c.title = data.title;
        if (data.summary && !c.summary) c.summary = String(data.summary).slice(0, 240);
        if (Array.isArray(data.anchor_refs)) {
          for (const r of data.anchor_refs) if (r && !c.anchor_refs.includes(r)) c.anchor_refs.push(r);
        }
        if (data.mechanic && !c.mechanic) c.mechanic = data.mechanic;
        mergeCharacters(c, data.characters_present || data.characters);
        if (data.qa && data.qa.failed) c._qaFailed = true;
      }
    }
  }

  // Pass 3 — source/scenes/**/*.lua (real hand-written / generated Lua).
  if (fs.existsSync(sourceScenesDir)) {
    for await (const luaPath of walkLuaFiles(sourceScenesDir)) {
      const id = sceneIdFromLuaPath(luaPath, sourceScenesDir);
      const c = ensure(id);
      c.sources.push('lua');
      c.lua_path = path.relative(local, luaPath);
      const sniff = await sniffLuaScene(luaPath);
      if (sniff.title && c.title === titleCase(id)) c.title = sniff.title;
      if (sniff.summary && !c.summary) c.summary = sniff.summary;
      if (sniff.mechanic && !c.mechanic) c.mechanic = sniff.mechanic;
      mergeCharacters(c, sniff.characters);
    }
  }

  // Pass 4 — companion PNGs in sdk_data/scenes/<id>.png are the thumbnail.
  for (const c of cards.values()) {
    const pngCandidate = path.join(sdkScenesDir, c.scene_id + '.png');
    if (fs.existsSync(pngCandidate)) {
      c.png_path = path.relative(local, pngCandidate);
      c.thumbnail_path = c.png_path;
    } else if (c.anchor_refs.length) {
      // Fall back to the first anchor ref if it resolves to an existing file.
      for (const ref of c.anchor_refs) {
        const refAbs = path.isAbsolute(ref) ? ref : path.join(local, ref);
        if (fs.existsSync(refAbs)) {
          c.thumbnail_path = path.relative(local, refAbs);
          break;
        }
      }
    }
  }

  // Finalize: status, dedupe sources, sort.
  const out = [];
  for (const c of cards.values()) {
    c.status = deriveStatus({
      hasLua: !!c.lua_path,
      hasPng: !!c.png_path,
      hasJson: !!c.json_path,
      autopilotStatus: c._autopilotStatus,
      qaFailed: c._qaFailed
    });
    c.sources = Array.from(new Set(c.sources));
    delete c._autopilotStatus;
    delete c._qaFailed;
    out.push(c);
  }
  out.sort((a, b) => a.scene_id.localeCompare(b.scene_id));

  const counts = { total: out.length, by_status: {} };
  for (const c of out) {
    counts.by_status[c.status] = (counts.by_status[c.status] || 0) + 1;
  }

  return { scenes: out, counts };
}

module.exports = {
  buildStoryboard,
  // exported for unit tests
  _internals: { sniffLuaScene, sceneIdFromLuaPath, deriveStatus, titleCase }
};
