'use strict';

// static_validator_smoke.test.js — Step 7 validator tests.
//
// Exercises each of the six checks with fixtures that guarantee specific
// outcomes. No network calls, no file I/O for the design data itself (we
// pass a temp dir with a pre-written compiled_design.json).
//
// Run: node tests/static_validator_smoke.test.js

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { validate } = require('../server/services/sdk_static_validator');

let failed = 0;
let passed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log('  ok  ' + msg);
    passed++;
  } else {
    console.error('  FAIL ' + msg);
    failed++;
  }
}

function findCheck(report, id) {
  return (report.checks || []).find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeSdkRoot(design) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'validator-smoke-'));
  const sdkData = path.join(tmpDir, 'sdk_data');
  await fsp.mkdir(sdkData, { recursive: true });
  await fsp.writeFile(
    path.join(sdkData, 'compiled_design.json'),
    JSON.stringify(design, null, 2)
  );
  return tmpDir;
}

async function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Fixture: absent compiled_design.json
// ---------------------------------------------------------------------------
console.log('\n# absent compiled_design.json');
{
  const run = async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'validator-smoke-empty-'));
    await fsp.mkdir(path.join(tmpDir, 'sdk_data'), { recursive: true });
    try {
      const report = await validate('test-proj', tmpDir);
      assert(!report.ok, 'absent file returns ok=false');
      assert(report.error === 'no_compiled_design', 'error is no_compiled_design');
    } finally {
      await cleanup(tmpDir);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 1: orphan room
// ---------------------------------------------------------------------------
console.log('\n# rooms_reachable — orphan room');
{
  const design = {
    rooms_graph: {
      start: { is_start: true, exits: [{ to: 'room_a' }] },
      room_a: { exits: [] },
      orphan_room: { exits: [] }   // not reachable from start
    },
    interactions_map: {},
    puzzle_dag: {},
    dialogue_triggers: {},
    inventory_rules: { items: [] },
    state_flags: {},
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-orphan', sdkRoot);
      const check = findCheck(report, 'rooms_reachable');
      assert(check !== undefined, 'rooms_reachable check present');
      assert(check.severity === 'warn', 'orphan room → severity=warn (not >50%)');
      assert(Array.isArray(check.orphans) && check.orphans.includes('orphan_room'), 'orphan_room listed');
      // Persist file should exist
      const persistPath = path.join(sdkRoot, 'sdk_data', 'design_validation.json');
      assert(fs.existsSync(persistPath), 'design_validation.json written as side-effect');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 2: >50% orphaned rooms → fail severity
// ---------------------------------------------------------------------------
console.log('\n# rooms_reachable — >50% orphaned → fail');
{
  const design = {
    rooms_graph: {
      start: { is_start: true, exits: [] },
      dead1: { exits: [] },
      dead2: { exits: [] },
      dead3: { exits: [] }
    },
    interactions_map: {},
    puzzle_dag: {},
    dialogue_triggers: {},
    inventory_rules: { items: [] },
    state_flags: {},
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-50pct', sdkRoot);
      const check = findCheck(report, 'rooms_reachable');
      assert(check.severity === 'fail', '>50% orphans → severity=fail');
      assert(check.orphans.length === 3, 'three orphans listed');
      assert(!report.ok, 'report.ok=false when a check fails');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 3: broken item ref in interactions_map
// ---------------------------------------------------------------------------
console.log('\n# item_refs_resolve — broken interaction ref');
{
  const design = {
    rooms_graph: {},
    interactions_map: {
      inspect_box: { object: 'missing_item' }  // not in inventory
    },
    puzzle_dag: {},
    dialogue_triggers: {},
    inventory_rules: {
      items: [
        { id: 'known_item' }
      ]
    },
    state_flags: {},
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-itemref', sdkRoot);
      const check = findCheck(report, 'item_refs_resolve');
      assert(check.severity === 'fail', 'broken item ref → severity=fail');
      assert(check.broken.length === 1, 'one broken ref reported');
      assert(check.broken[0].ref === 'missing_item', 'correct ref id in broken list');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 4: good item refs pass
// ---------------------------------------------------------------------------
console.log('\n# item_refs_resolve — all refs resolve');
{
  const design = {
    rooms_graph: {},
    interactions_map: {
      open_chest: { object: 'golden_key' }
    },
    puzzle_dag: {},
    dialogue_triggers: {},
    inventory_rules: {
      items: [{ id: 'golden_key' }]
    },
    state_flags: {},
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-gooditem', sdkRoot);
      const check = findCheck(report, 'item_refs_resolve');
      assert(check.severity === 'pass', 'all refs resolve → pass');
      assert(check.broken.length === 0, 'no broken refs');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 5: dialogue dead end
// ---------------------------------------------------------------------------
console.log('\n# dialogue_no_dead_ends — terminal node detected');
{
  const design = {
    rooms_graph: {},
    interactions_map: {},
    puzzle_dag: {},
    dialogue_triggers: {
      npc_guard: {
        nodes: {
          node_start: {
            text: 'Halt! Who goes there?',
            responses: [
              { text: 'A traveler', next: 'node_end' },
              { text: 'No one', next: 'node_end' }
            ]
          },
          node_end: {
            text: 'Move along.',
            responses: [
              { text: 'Ok', next: 'node_dead' }  // leads somewhere with nothing further
            ]
          },
          node_dead: {
            text: 'Nothing more.',
            responses: [
              // Non-empty responses array but all lead to nodes with no options + no effect
              { text: '...', next: 'node_truly_done' }
            ]
          },
          node_truly_done: {
            text: 'Silence.',
            responses: []  // truly terminal — OK on its own
          }
        }
      }
    },
    inventory_rules: { items: [] },
    state_flags: {},
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-deadend', sdkRoot);
      const check = findCheck(report, 'dialogue_no_dead_ends');
      assert(check !== undefined, 'dialogue_no_dead_ends check present');
      // node_dead has responses leading to node_truly_done which has no further options + no effect
      assert(check.severity === 'warn', 'dead end detected → warn');
      assert(check.terminal_nodes.length > 0, 'at least one terminal node reported');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 6: cyclic puzzle DAG → fail
// ---------------------------------------------------------------------------
console.log('\n# puzzle_solvable — cyclic DAG');
{
  const design = {
    rooms_graph: {},
    interactions_map: {},
    puzzle_dag: {
      puzzle_a: {
        requires: ['flag_b'],
        produces: ['flag_a']
      },
      puzzle_b: {
        requires: ['flag_a'],   // cycle: a needs b, b needs a
        produces: ['flag_b']
      }
    },
    dialogue_triggers: {},
    inventory_rules: { items: [] },
    state_flags: {
      flag_a: false,
      flag_b: false
    },
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-cycle', sdkRoot);
      const check = findCheck(report, 'puzzle_solvable');
      assert(check.severity === 'fail', 'cycle → severity=fail');
      assert(check.cycles.length > 0, 'cycles array non-empty');
      assert(check.cycles[0].includes('puzzle_a') || check.cycles[0].includes('puzzle_b'),
        'cycle members include puzzle_a or puzzle_b');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 7: unreachable ending
// ---------------------------------------------------------------------------
console.log('\n# endings_reachable — ending with impossible flag');
{
  const design = {
    rooms_graph: {},
    interactions_map: {},
    puzzle_dag: {
      puzzle_one: {
        requires: [],
        produces: ['flag_collected']
      }
    },
    dialogue_triggers: {},
    inventory_rules: { items: [] },
    state_flags: {
      flag_collected: false,
      flag_secret: false
    },
    save_schema: { fields: [] },
    endings: [
      { id: 'good_ending', requires: ['flag_collected'] },         // reachable
      { id: 'secret_ending', requires: ['flag_collected', 'flag_never_produced'] }  // unreachable
    ]
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-ending', sdkRoot);
      const check = findCheck(report, 'endings_reachable');
      assert(check.severity === 'fail', 'unreachable ending → severity=fail');
      assert(check.unreachable.length === 1, 'one unreachable ending');
      assert(check.unreachable[0].ending === 'secret_ending', 'correct ending id');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 8: flag consistency — read-never-written
// ---------------------------------------------------------------------------
console.log('\n# flag_consistency — read-never-written');
{
  const design = {
    rooms_graph: {},
    interactions_map: {},
    puzzle_dag: {
      puzzle_read: {
        requires: ['ghost_flag'],  // reads ghost_flag
        produces: ['real_flag']
      }
    },
    dialogue_triggers: {},
    inventory_rules: { items: [] },
    state_flags: {
      ghost_flag: false,   // read but never produced by any puzzle or interaction
      real_flag: false
    },
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-flagread', sdkRoot);
      const check = findCheck(report, 'flag_consistency');
      assert(check.severity === 'warn', 'read-never-written → warn');
      assert(check.read_never_written.includes('ghost_flag'), 'ghost_flag in read_never_written');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 9: flag consistency — written-never-read
// ---------------------------------------------------------------------------
console.log('\n# flag_consistency — written-never-read');
{
  const design = {
    rooms_graph: {},
    interactions_map: {
      pick_up_item: {
        effect: { set_flag: 'orphan_flag' }  // sets orphan_flag, never required anywhere
      }
    },
    puzzle_dag: {},
    dialogue_triggers: {},
    inventory_rules: { items: [] },
    state_flags: {
      orphan_flag: false
    },
    save_schema: { fields: [] },
    endings: []
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-flagwrite', sdkRoot);
      const check = findCheck(report, 'flag_consistency');
      assert(check.severity === 'warn', 'written-never-read → warn');
      assert(check.written_never_read.includes('orphan_flag'), 'orphan_flag in written_never_read');
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Fixture 10: clean design — all checks pass
// ---------------------------------------------------------------------------
console.log('\n# clean design — all checks pass');
{
  const design = {
    rooms_graph: {
      start: { is_start: true, exits: [{ to: 'room_a' }] },
      room_a: { exits: [{ to: 'room_b' }] },
      room_b: { exits: [] }
    },
    interactions_map: {
      use_key: { object: 'gold_key', effect: { set_flag: 'door_opened' } }
    },
    puzzle_dag: {
      find_key: {
        requires: [],
        produces: ['has_key']
      },
      open_door: {
        requires: ['has_key'],
        produces: ['door_opened']
      }
    },
    dialogue_triggers: {
      innkeeper: {
        nodes: {
          greeting: {
            text: 'Welcome!',
            responses: [
              { text: 'Thanks', next: 'farewell', effect: { set_flag: 'greeted_innkeeper' } }
            ]
          },
          farewell: {
            text: 'Safe travels.',
            responses: []
          }
        }
      }
    },
    inventory_rules: {
      items: [{ id: 'gold_key' }]
    },
    state_flags: {
      has_key: false,
      door_opened: false,
      greeted_innkeeper: false
    },
    save_schema: {
      fields: []
    },
    endings: [
      { id: 'victory', requires: ['door_opened'] }
    ]
  };

  const run = async () => {
    const sdkRoot = await makeSdkRoot(design);
    try {
      const report = await validate('proj-clean', sdkRoot);
      assert(report.ok, 'clean design → report.ok=true');
      assert(report.summary.failed === 0, 'zero failed checks');
      for (const check of report.checks) {
        if (check.id === 'flag_consistency') continue; // greeted_innkeeper written-never-read is a warn
        assert(check.severity !== 'fail', `${check.id} not a failure on clean design`);
      }
    } finally {
      await cleanup(sdkRoot);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Wait for all async tests then report
// ---------------------------------------------------------------------------
setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  else console.log('all ok');
}, 500);
