'use strict';

// arch_diagram_smoke.test.js — Smoke tests for sdk_arch_diagram.
//
// Fixture: compiled_design with 5 rooms forming a small DAG + 3 puzzles +
// 5 save schema fields. Calls generate(). Asserts architecture.md exists,
// contains the project name, flowchart TD mermaid block, all 5 room ids,
// all puzzle ids, and the save schema table.
//
// Run: node tests/arch_diagram_smoke.test.js

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  ok ' + msg);
    passed++;
  } else {
    console.error('  FAIL ' + msg);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ROOMS_GRAPH = {
  title: {
    id: 'title',
    name: 'Title Screen',
    exits: [{ to: 'main_menu', trigger: 'press_a' }]
  },
  main_menu: {
    id: 'main_menu',
    name: 'Main Menu',
    exits: [{ to: 'room_kitchen', trigger: 'start_game' }]
  },
  room_kitchen: {
    id: 'room_kitchen',
    name: 'Kitchen',
    exits: [
      { to: 'room_garage', trigger: 'go_garage' },
      { to: 'room_basement', trigger: 'open_hatch', locked: true, requires: ['has_key'] }
    ]
  },
  room_garage: {
    id: 'room_garage',
    name: 'Garage',
    exits: [{ to: 'room_kitchen', trigger: 'go_back' }]
  },
  room_basement: {
    id: 'room_basement',
    name: 'Basement',
    exits: []
  }
};

const PUZZLE_DAG = [
  { id: 'find_key',       name: 'Find the Key',       requires: [] },
  { id: 'unlock_hatch',   name: 'Unlock the Hatch',   requires: ['find_key'] },
  { id: 'defeat_monster', name: 'Defeat the Monster', requires: ['unlock_hatch'] }
];

const SAVE_SCHEMA = {
  fields: [
    { key: 'game_started',    type: 'boolean', default: false,   description: 'Whether a game has started' },
    { key: 'current_scene',   type: 'string',  default: 'title', description: 'Active scene id' },
    { key: 'has_key',         type: 'boolean', default: false,   description: 'Player has the basement key' },
    { key: 'hatch_unlocked',  type: 'boolean', default: false,   description: 'Basement hatch is open' },
    { key: 'game_completed',  type: 'boolean', default: false,   description: 'Player completed the game' }
  ]
};

const COMPILED_DESIGN = {
  project_name: 'Dungeon Escape',
  rooms_graph: ROOMS_GRAPH,
  puzzle_dag: PUZZLE_DAG,
  save_schema: SAVE_SCHEMA,
  interactions_map: {},
  inventory_rules: {},
  dialogue_triggers: {},
  state_flags: ['game_started', 'has_key', 'hatch_unlocked', 'game_completed'],
  endings: [],
  compiler_version: 1,
  compiled_at: new Date().toISOString(),
  compiler_warnings: []
};

async function makeSdkRoot() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'arch_diag_test_'));
  // sdk_data is dir itself (matches how the route constructs sdkRoot).
  await fsp.writeFile(
    path.join(dir, 'compiled_design.json'),
    JSON.stringify(COMPILED_DESIGN, null, 2)
  );
  await fsp.writeFile(
    path.join(dir, 'project.json'),
    JSON.stringify({ title: 'Dungeon Escape', scenes: [], characters: [] }, null, 2)
  );
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  const archDiagram = require('../server/services/sdk_arch_diagram');

  // --- Test group 1: generate() succeeds and returns paths ---
  console.log('\n# generate() returns paths');
  const sdkRoot = await makeSdkRoot();
  let result;
  try {
    result = await archDiagram.generate('dungeon-escape', sdkRoot);
  } catch (e) {
    console.error('  FAIL generate() threw:', e.message);
    failed++;
    process.exit(1);
  }

  assert(typeof result === 'object' && result !== null, 'generate() returns object');
  assert(typeof result.md_path === 'string', 'result.md_path is a string');
  // svg_path is null when mmdc is absent — that is the expected case.
  assert('svg_path' in result, 'result.svg_path key is present');

  // --- Test group 2: architecture.md exists on disk ---
  console.log('\n# architecture.md written to disk');
  const mdPath = path.join(sdkRoot, 'architecture.md');
  assert(fs.existsSync(mdPath), 'architecture.md exists');

  const md = fs.readFileSync(mdPath, 'utf8');
  assert(md.length > 0, 'architecture.md is non-empty');

  // --- Test group 3: project name in doc ---
  console.log('\n# project name present');
  assert(md.includes('Dungeon Escape'), 'architecture.md contains project name');

  // --- Test group 4: Mermaid flowchart block present ---
  console.log('\n# Mermaid flowchart block');
  assert(md.includes('flowchart TD'), 'architecture.md contains "flowchart TD"');
  assert(md.includes('```mermaid'), 'architecture.md has mermaid code fence');

  // --- Test group 5: all 5 room ids present ---
  console.log('\n# all 5 room ids present');
  const ROOM_IDS = ['title', 'main_menu', 'room_kitchen', 'room_garage', 'room_basement'];
  for (const id of ROOM_IDS) {
    assert(md.includes(id), `architecture.md contains room id "${id}"`);
  }

  // --- Test group 6: locked edge syntax ---
  console.log('\n# locked edge syntax');
  assert(md.includes('-.locked.->'), 'architecture.md uses -.locked.-> for locked exits');

  // --- Test group 7: all puzzle ids present ---
  console.log('\n# all puzzle ids present');
  const PUZZLE_IDS = ['find_key', 'unlock_hatch', 'defeat_monster'];
  for (const id of PUZZLE_IDS) {
    assert(md.includes(id), `architecture.md contains puzzle id "${id}"`);
  }

  // --- Test group 8: save schema table ---
  console.log('\n# save schema table present');
  assert(md.includes('## Save State Schema'), 'architecture.md has Save State Schema heading');
  const SCHEMA_KEYS = ['game_started', 'current_scene', 'has_key', 'hatch_unlocked', 'game_completed'];
  for (const key of SCHEMA_KEYS) {
    assert(md.includes(key), `save schema table contains key "${key}"`);
  }
  // Table should have markdown pipe syntax.
  assert(md.includes('| Key |') || md.includes('|Key|') || md.includes('| key |') || /\| *Key *\|/.test(md),
    'save schema section contains table header with Key column');

  // --- Test group 9: headings present ---
  console.log('\n# required headings');
  assert(md.includes('## Lua Modules'),          'architecture.md has "## Lua Modules"');
  assert(md.includes('## Scene Graph'),           'architecture.md has "## Scene Graph"');
  assert(md.includes('## Puzzle Dependency DAG'), 'architecture.md has "## Puzzle Dependency DAG"');
  assert(md.includes('## Asset Manifest'),        'architecture.md has "## Asset Manifest"');

  // --- Test group 10: read() returns the md ---
  console.log('\n# read() returns md');
  const readBack = archDiagram.read(sdkRoot);
  assert(typeof readBack === 'object' && readBack !== null, 'read() returns object');
  assert(typeof readBack.md === 'string', 'read().md is string');
  assert(readBack.md.includes('Dungeon Escape'), 'read().md contains project name');
  assert('svg_path' in readBack, 'read() has svg_path key');

  // --- Test group 11: generate() fails with helpful error when compiled_design missing ---
  console.log('\n# missing compiled_design error');
  const emptyDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'arch_empty_'));
  let threw = false;
  let thrownErr = null;
  try {
    await archDiagram.generate('no-design', emptyDir);
  } catch (e) {
    threw = true;
    thrownErr = e;
  }
  assert(threw, 'generate() throws when compiled_design.json absent');
  assert(thrownErr && thrownErr.status === 422, 'error has status 422');
  assert(thrownErr && /compiled_design/i.test(thrownErr.message), 'error message mentions compiled_design');

  // --- Test group 12: read() returns null md when not generated ---
  console.log('\n# read() returns null md when not generated');
  const neverGenerated = archDiagram.read(emptyDir);
  assert(neverGenerated.md === null, 'read().md is null for un-generated project');
  assert(neverGenerated.svg_path === null, 'read().svg_path is null for un-generated project');

  // Cleanup.
  for (const d of [sdkRoot, emptyDir]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }

  // --- Summary ---
  console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log('all ok');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
