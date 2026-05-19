'use strict';

// sdk_arch_diagram.js — Phase 9 architecture diagram generator.
//
// Reads compiled_design.json + project.json (+ optional Lua source tree) for
// an SDK project and emits two artifacts:
//
//   <sdkRoot>/sdk_data/architecture.md   — human-readable doc with Mermaid
//   <sdkRoot>/sdk_data/architecture.svg  — optional; requires mmdc on PATH
//
// Exported API:
//   generate(projectId, sdkRoot) → Promise<{ md_path, svg_path }>
//   read(sdkRoot)                → { md: string|null, svg_path: string|null }

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const SDK_DATA_REL = 'sdk_data';
const ARCH_MD = 'architecture.md';
const ARCH_SVG = 'architecture.svg';
const COMPILED_FILENAME = 'compiled_design.json';
const PROJECT_FILENAME = 'project.json';

// ---------------------------------------------------------------------------
// Loader helpers
// ---------------------------------------------------------------------------

function loadJson(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_e) {
    return fallback;
  }
}

// Walk a directory tree returning all .lua files relative to base.
function walkLua(dir, base, acc) {
  if (!base) base = dir;
  if (!acc) acc = [];
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLua(full, base, acc);
    } else if (entry.isFile() && entry.name.endsWith('.lua')) {
      acc.push(path.relative(base, full));
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Mermaid builders
// ---------------------------------------------------------------------------

// Sanitize a node id: replace non-alphanumeric with underscore.
function nodeId(str) {
  return String(str).replace(/[^a-zA-Z0-9_]/g, '_');
}

// Sanitize a label: escape brackets/quotes for Mermaid.
function nodeLabel(str) {
  return String(str).replace(/[[\]"]/g, ' ').trim() || str;
}

function buildSceneGraph(roomsGraph) {
  if (!roomsGraph || typeof roomsGraph !== 'object') return null;
  const ids = Object.keys(roomsGraph);
  if (ids.length === 0) return null;

  const lines = ['flowchart TD'];
  const edgesEmitted = new Set();

  for (const id of ids) {
    const room = roomsGraph[id];
    const label = (room && room.name) ? room.name : id;
    lines.push(`  ${nodeId(id)}["${nodeLabel(label)}"]`);
  }

  for (const id of ids) {
    const room = roomsGraph[id];
    const exits = (room && Array.isArray(room.exits)) ? room.exits : [];
    for (const exit of exits) {
      if (!exit || !exit.to) continue;
      const from = nodeId(id);
      const to = nodeId(exit.to);
      const key = `${from}->${to}`;
      if (edgesEmitted.has(key)) continue;
      edgesEmitted.add(key);

      const isLocked = exit.locked === true || (exit.requires && exit.requires.length > 0);
      if (isLocked) {
        lines.push(`  ${from} -.locked.-> ${to}`);
      } else {
        lines.push(`  ${from} --> ${to}`);
      }
    }
  }

  return lines.join('\n');
}

function buildPuzzleDAG(puzzleDag) {
  if (!puzzleDag) return null;

  // puzzleDag may be an array of puzzle objects, or an object keyed by id.
  let puzzles = [];
  if (Array.isArray(puzzleDag)) {
    puzzles = puzzleDag;
  } else if (typeof puzzleDag === 'object') {
    puzzles = Object.values(puzzleDag);
  }
  if (puzzles.length === 0) return null;

  const lines = ['flowchart TD'];
  const edgesEmitted = new Set();

  for (const p of puzzles) {
    if (!p || !p.id) continue;
    const label = p.name || p.id;
    lines.push(`  ${nodeId(p.id)}["${nodeLabel(label)}"]`);
  }

  for (const p of puzzles) {
    if (!p || !p.id) continue;
    const deps = p.requires || p.depends_on || [];
    for (const dep of deps) {
      if (!dep) continue;
      const from = nodeId(dep);
      const to = nodeId(p.id);
      const key = `${from}->${to}`;
      if (edgesEmitted.has(key)) continue;
      edgesEmitted.add(key);
      lines.push(`  ${from} --> ${to}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Save schema table
// ---------------------------------------------------------------------------

function buildSaveSchemaTable(saveSchema) {
  if (!saveSchema) return null;
  const fields = Array.isArray(saveSchema) ? saveSchema : (saveSchema.fields || []);
  if (fields.length === 0) return null;

  const rows = ['| Key | Type | Default | Description |', '|-----|------|---------|-------------|'];
  for (const f of fields) {
    if (!f) continue;
    const key = f.key || '—';
    const type = f.type || f.kind || '—';
    const def = f.default !== undefined ? String(f.default) : '—';
    const desc = f.description || f.desc || '';
    rows.push(`| ${key} | ${type} | ${def} | ${desc} |`);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Lua module analysis
// ---------------------------------------------------------------------------

function analyzeLuaTree(sourceDir) {
  if (!fs.existsSync(sourceDir)) return null;

  const allLua = walkLua(sourceDir);

  // Separate by subdirectory.
  const systems = allLua.filter((f) => f.startsWith('systems/') || f.startsWith('systems\\'));
  const scenes = allLua.filter((f) => f.startsWith('scenes/') || f.startsWith('scenes\\'));
  const concepts = allLua.filter((f) => f.startsWith('concepts/') || f.startsWith('concepts\\'));
  const entities = allLua.filter((f) => f.startsWith('entities/') || f.startsWith('entities\\'));

  return { allLua, systems, scenes, concepts, entities };
}

function buildLuaModulesSection(lua) {
  if (!lua) return null;
  const { systems, concepts, scenes, entities, allLua } = lua;

  const lines = [];
  lines.push(`- main.lua loads ${systems.length} system(s) and ${concepts.length} concept(s)`);
  lines.push('');
  lines.push('| Module | Path |');
  lines.push('|--------|------|');

  const categorized = [
    ...systems.map((f) => ({ cat: 'system', f })),
    ...scenes.map((f) => ({ cat: 'scene', f })),
    ...concepts.map((f) => ({ cat: 'concept', f })),
    ...entities.map((f) => ({ cat: 'entity', f }))
  ];

  // Also add top-level lua files not in any subdir.
  const subDirs = new Set(['systems', 'scenes', 'concepts', 'entities']);
  const topLevel = allLua.filter((f) => {
    const parts = f.split(/[/\\]/);
    return parts.length === 1 || !subDirs.has(parts[0]);
  });
  for (const f of topLevel) {
    categorized.push({ cat: 'module', f });
  }

  for (const { cat, f } of categorized) {
    lines.push(`| ${cat} | ${f} |`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Asset manifest
// ---------------------------------------------------------------------------

function buildAssetManifest(projectData) {
  if (!projectData) return null;
  const scenes = Array.isArray(projectData.scenes) ? projectData.scenes.length : 0;
  const characters = Array.isArray(projectData.characters) ? projectData.characters.length : 0;

  const rows = ['| Asset type | Count |', '|------------|-------|'];
  rows.push(`| Scenes | ${scenes} |`);
  rows.push(`| Characters / portraits | ${characters} |`);

  // Count sfx/music from subdirectories if present via compiledDesign.
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown assembler
// ---------------------------------------------------------------------------

function assembleMarkdown(opts) {
  const {
    projectName,
    lua,
    roomsGraph,
    puzzleDag,
    saveSchema,
    projectData
  } = opts;

  const sections = [];

  sections.push(`# ${projectName} Architecture`);
  sections.push('');
  sections.push('> Auto-generated by sdk_arch_diagram. Re-run via POST /api/projects/:id/architecture/generate.');
  sections.push('');

  // --- Lua Modules ---
  const luaSection = buildLuaModulesSection(lua);
  sections.push('## Lua Modules');
  sections.push('');
  if (luaSection) {
    sections.push(luaSection);
  } else {
    sections.push('_No Lua source tree found at `<project>/source/`._');
  }
  sections.push('');

  // --- Scene Graph ---
  sections.push('## Scene Graph');
  sections.push('');
  const sceneGraphMermaid = buildSceneGraph(roomsGraph);
  if (sceneGraphMermaid) {
    sections.push('```mermaid');
    sections.push(sceneGraphMermaid);
    sections.push('```');
  } else {
    sections.push('_No rooms graph found in compiled_design.json._');
  }
  sections.push('');

  // --- Puzzle Dependency DAG ---
  sections.push('## Puzzle Dependency DAG');
  sections.push('');
  const puzzleMermaid = buildPuzzleDAG(puzzleDag);
  if (puzzleMermaid) {
    sections.push('```mermaid');
    sections.push(puzzleMermaid);
    sections.push('```');
  } else {
    sections.push('_No puzzle DAG found in compiled_design.json._');
  }
  sections.push('');

  // --- Save State Schema ---
  sections.push('## Save State Schema');
  sections.push('');
  const schemaTable = buildSaveSchemaTable(saveSchema);
  if (schemaTable) {
    sections.push(schemaTable);
  } else {
    sections.push('_No save schema found in compiled_design.json._');
  }
  sections.push('');

  // --- Asset Manifest ---
  sections.push('## Asset Manifest');
  sections.push('');
  const manifest = buildAssetManifest(projectData);
  if (manifest) {
    sections.push(manifest);
  } else {
    sections.push('_No project.json asset data found._');
  }
  sections.push('');

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// SVG generation (optional — requires mmdc)
// ---------------------------------------------------------------------------

async function tryGenerateSvg(mdPath, svgPath) {
  try {
    const { stdout: mmdcPath } = await execFileAsync('which', ['mmdc'], { timeout: 5000 });
    if (!mmdcPath || !mmdcPath.trim()) return null;
  } catch (_e) {
    // mmdc not on PATH — skip silently.
    return null;
  }

  try {
    await execFileAsync('mmdc', ['-i', mdPath, '-o', svgPath], { timeout: 30000 });
    return fs.existsSync(svgPath) ? svgPath : null;
  } catch (_e) {
    // mmdc failed (e.g. no Chromium) — skip silently.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function generate(projectId, sdkRoot) {
  if (!projectId) throw Object.assign(new Error('projectId is required'), { status: 400 });
  if (!sdkRoot) throw Object.assign(new Error('sdkRoot is required'), { status: 400 });

  // sdkRoot is the sdk_data directory. The Lua source lives one level up.
  const sdkDataDir = sdkRoot;
  const projectRoot = path.dirname(sdkDataDir);

  // Load compiled_design.json — required.
  const compiledPath = path.join(sdkDataDir, COMPILED_FILENAME);
  if (!fs.existsSync(compiledPath)) {
    throw Object.assign(
      new Error('compiled_design.json not found — run the design compiler first'),
      { status: 422, code: 'no_compiled_design', detail: `Expected at ${compiledPath}` }
    );
  }
  const compiled = loadJson(compiledPath, {});

  // Load project.json — optional, graceful fallback.
  const projectJson = loadJson(path.join(sdkDataDir, PROJECT_FILENAME), {});

  // Derive project name.
  const projectName =
    compiled.project_name ||
    projectJson.title ||
    projectJson.name ||
    projectId ||
    'Untitled Project';

  // Analyze Lua source tree — lives at <projectRoot>/source/.
  const sourceDir = path.join(projectRoot, 'source');
  const lua = analyzeLuaTree(sourceDir);

  // Assemble markdown.
  const md = assembleMarkdown({
    projectName,
    lua,
    roomsGraph: compiled.rooms_graph || null,
    puzzleDag: compiled.puzzle_dag || null,
    saveSchema: compiled.save_schema || null,
    projectData: projectJson
  });

  // Write architecture.md.
  await fsp.mkdir(sdkDataDir, { recursive: true });
  const mdPath = path.join(sdkDataDir, ARCH_MD);
  await fsp.writeFile(mdPath, md, 'utf8');

  // Try to generate SVG.
  const svgPath = path.join(sdkDataDir, ARCH_SVG);
  const generatedSvg = await tryGenerateSvg(mdPath, svgPath);

  return {
    md_path: mdPath,
    svg_path: generatedSvg || null
  };
}

function read(sdkRoot) {
  const mdPath = path.join(sdkRoot, ARCH_MD);
  const svgPath = path.join(sdkRoot, ARCH_SVG);

  return {
    md: fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null,
    svg_path: fs.existsSync(svgPath) ? svgPath : null
  };
}

module.exports = { generate, read };
