'use strict';

// design_compiler_smoke.test.js — Smoke tests for sdk_design_compiler.
//
// Uses a minimal in-memory fixture (2 scenes, 1 character, no items /
// dialogue / interactions) to exercise compile() without hitting disk
// for real project data.
//
// Run: node tests/design_compiler_smoke.test.js

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok ' + msg); }
  else { console.error('  FAIL ' + msg); failed++; }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function makeSdkRoot(scenes, characters, storyBible) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'design_compiler_test_'));
  const sdkRoot = dir;

  // project.json  (the primary scene/character source the compiler prefers)
  await fsp.writeFile(
    path.join(sdkRoot, 'project.json'),
    JSON.stringify({ scenes, characters }, null, 2)
  );

  // story_bible.md (optional text source for flags)
  if (storyBible) {
    await fsp.writeFile(path.join(sdkRoot, 'story_bible.md'), storyBible);
  }

  return { sdkRoot, dir };
}

// Minimal fixture: 2 scenes, 1 character, no items/dialogue/interactions.
const SCENE_A = {
  id: 'library',
  name: 'The Library',
  type: 'explore',
  description: 'A dusty library with a locked door and an old chest. Take stairs to go to archives.',
  exits: [{ to: 'archives', trigger: 'use_stairs' }],
  mood: 'tense',
  music_intent: 'ambient'
};
const SCENE_B = {
  id: 'archives',
  name: 'The Archives',
  type: 'explore',
  description: 'Ancient scrolls fill the shelves. A lever on the wall controls a hidden door.',
  exits: [],
  mood: 'mysterious',
  music_intent: 'quiet'
};
const CHARACTER_A = {
  id: 'archivist',
  name: 'The Archivist',
  role: 'npc',
  home_scene: 'archives',
  visual_anchor: 'elderly scholar in robes',
  portrait_prompt: 'elderly scholar in robes, 1-bit pixel art'
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  const compiler = require('../server/services/sdk_design_compiler');

  // --- Test 1: compile returns all 8 required top-level keys + metadata ---
  console.log('# required top-level keys');
  const { sdkRoot: root1, dir: dir1 } = await makeSdkRoot(
    [SCENE_A, SCENE_B], [CHARACTER_A], '# Story Bible\nPrimary dither: Bayer 4x4\nVibe: tense mystery'
  );

  let compiled;
  try {
    compiled = await compiler.compile('test-project-1', root1);
  } catch (e) {
    console.error('  FAIL compile() threw:', e.message);
    failed++;
    process.exit(1);
  }

  const REQUIRED_KEYS = [
    'rooms_graph', 'interactions_map', 'puzzle_dag', 'inventory_rules',
    'dialogue_triggers', 'state_flags', 'save_schema', 'endings'
  ];
  for (const k of REQUIRED_KEYS) {
    assert(k in compiled, `output has key '${k}'`);
  }
  assert('compiler_version' in compiled, 'output has compiler_version');
  assert('compiled_at' in compiled, 'output has compiled_at');
  assert('compiler_warnings' in compiled, 'output has compiler_warnings');

  // --- Test 2: rooms_graph has entries for both scene ids ---
  console.log('# rooms_graph entries');
  assert(typeof compiled.rooms_graph === 'object', 'rooms_graph is an object');
  assert('library' in compiled.rooms_graph, 'rooms_graph has library');
  assert('archives' in compiled.rooms_graph, 'rooms_graph has archives');

  // Explicit exit from scene JSON should be preserved.
  const libraryExits = compiled.rooms_graph.library.exits || [];
  const exitToArchives = libraryExits.find((e) => e.to === 'archives');
  assert(exitToArchives !== undefined, 'library has exit to archives');
  assert(exitToArchives.trigger === 'use_stairs', 'exit trigger is use_stairs');

  // Objects should be extracted from description.
  const libraryObjects = compiled.rooms_graph.library.objects || [];
  assert(libraryObjects.length > 0, 'library objects extracted from description');
  assert(libraryObjects.some((o) => o === 'door' || o === 'chest'),
    'library objects include door or chest');

  // --- Test 3: compiler_warnings flags the empty derived sections ---
  console.log('# compiler_warnings for missing sources');
  const warnings = compiled.compiler_warnings || [];
  assert(warnings.length > 0, 'compiler_warnings is non-empty for minimal fixture');

  const warnText = warnings.join('\n');
  assert(/items\.json/i.test(warnText), 'warning mentions items.json');
  assert(/dialogue\.json/i.test(warnText), 'warning mentions dialogue.json');
  assert(/interactions\.json/i.test(warnText), 'warning mentions interactions.json');
  assert(/puzzle_dag/i.test(warnText), 'warning mentions puzzle_dag');
  assert(/inventory_rules/i.test(warnText), 'warning mentions inventory_rules');

  // --- Test 4: state_flags always includes universal flags ---
  console.log('# state_flags universal flags');
  const flags = compiled.state_flags || [];
  assert(Array.isArray(flags), 'state_flags is an array');
  assert(flags.includes('game_started'), 'state_flags includes game_started');
  assert(flags.includes('game_completed'), 'state_flags includes game_completed');

  // --- Test 5: dialogue_triggers has entry for the character ---
  console.log('# dialogue_triggers from character roster');
  const triggers = compiled.dialogue_triggers || {};
  assert('archivist' in triggers, 'dialogue_triggers has archivist');
  assert(Array.isArray(triggers.archivist), 'archivist triggers is an array');
  assert(triggers.archivist.length > 0, 'archivist has at least one trigger node');
  assert(triggers.archivist[0].node === 'root', 'archivist root trigger node present');

  // --- Test 6: save_schema has fields array ---
  console.log('# save_schema structure');
  const schema = compiled.save_schema || {};
  assert(Array.isArray(schema.fields), 'save_schema.fields is an array');
  assert(schema.fields.some((f) => f.key === 'game_started'),
    'save_schema has game_started field');
  assert(schema.fields.some((f) => f.key === 'current_scene'),
    'save_schema has current_scene field');

  // --- Test 7: compiled_design.json was written to disk ---
  console.log('# file was written to disk');
  const outPath = path.join(root1, 'compiled_design.json');
  assert(fs.existsSync(outPath), 'compiled_design.json exists on disk');
  const diskData = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert('rooms_graph' in diskData, 'disk JSON has rooms_graph');

  // --- Test 8: read() returns the written design ---
  console.log('# read() returns compiled design');
  const readBack = await compiler.read(root1);
  assert(readBack !== null, 'read() returns non-null for compiled project');
  assert('rooms_graph' in readBack, 'read() result has rooms_graph');

  // --- Test 9: read() returns null when not compiled ---
  console.log('# read() returns null for uncompiled project');
  const { sdkRoot: root2, dir: dir2 } = await makeSdkRoot([], [], null);
  const nada = await compiler.read(root2);
  assert(nada === null, 'read() returns null when compiled_design.json missing');

  // --- Test 10: compiledSectionForScene returns correct slice ---
  console.log('# compiledSectionForScene');
  const slice = compiler.compiledSectionForScene(compiled, 'library');
  assert(slice !== null && typeof slice === 'object', 'compiledSectionForScene returns object');
  assert(slice.room !== null && typeof slice.room === 'object', 'slice.room is object');
  assert(Array.isArray(slice.interactions), 'slice.interactions is array');
  assert(Array.isArray(slice.puzzles), 'slice.puzzles is array');
  assert(Array.isArray(slice.state_flags), 'slice.state_flags is array');

  // Unknown scene id returns safe empty slice.
  const unknown = compiler.compiledSectionForScene(compiled, 'no_such_scene');
  assert(unknown.room === null, 'unknown scene room is null');

  // --- Test 11: compile on empty scene list ---
  console.log('# empty scene list produces rooms_graph warning');
  const { sdkRoot: root3 } = await makeSdkRoot([], [], null);
  const emptyCompiled = await compiler.compile('test-project-3', root3);
  assert(typeof emptyCompiled.rooms_graph === 'object', 'rooms_graph is object for empty project');
  const emptyWarnings = emptyCompiled.compiler_warnings || [];
  assert(emptyWarnings.some((w) => /rooms_graph/i.test(w) || /no scenes/i.test(w)),
    'warning emitted when no scenes found');

  // Cleanup temp dirs.
  for (const d of [dir1, dir2, root3]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }

  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ok (${11 + REQUIRED_KEYS.length - 1} assertions)`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
