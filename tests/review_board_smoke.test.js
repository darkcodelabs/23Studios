'use strict';

// review_board_smoke.test.js — smoke tests for sdk_review_board service.
//
// Fixture project with:
//   - 1 concept_pick gate awaiting_pick
//   - 1 batch awaiting_review
//   - 1 milestone in failed state
//
// Assertions:
//   - sync() writes review_board.md + review_board.json
//   - board contains all 3 item ids
//   - board contains copy-command strings
//   - recordDecision() appends to decisions.md + decisions.jsonl
//   - pendingCount() >= 3 before approvals
//   - markItemStatus() decreases pendingCount
//
// Run: node tests/review_board_smoke.test.js

const fs   = require('fs');
const fsp  = require('fs/promises');
const os   = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  ok  ' + msg);
    passed++;
  } else {
    console.error('  FAIL ' + msg);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpData, tmpLocal, projectId, sdkRoot;

async function setup() {
  tmpData   = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-rb-data-'));
  tmpLocal  = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-rb-local-'));
  projectId = 'rb-smoke-test';
  sdkRoot   = path.join(tmpLocal, 'sdk_data');

  process.env.PROJECTS_DATA_DIR = tmpData;
  process.env.SESSION_SECRET    = process.env.SESSION_SECRET || 'test-rb-secret';
  process.env.STUDIO_PASSWORD   = process.env.STUDIO_PASSWORD || 'test';
  process.env.NODE_ENV          = 'test';

  // Write projects registry
  await fsp.writeFile(
    path.join(tmpData, 'projects.json'),
    JSON.stringify({
      projects: [{
        id: projectId,
        name: 'Review Board Smoke Test',
        description: 'Smoke test',
        local_path: tmpLocal,
        platform: 'playdate',
        game_type: 'sdk',
        created_at: '2026-05-19',
        status: 'active'
      }]
    }, null, 2)
  );

  // Create sdk_data structure
  const gatesDir     = path.join(sdkRoot, 'gates');
  const conceptsDir  = path.join(sdkRoot, 'concepts');
  const batchesDir   = path.join(sdkRoot, 'batches');
  const milestonesDir = path.join(sdkRoot, 'milestones', 'm01_boot');

  await fsp.mkdir(gatesDir,      { recursive: true });
  await fsp.mkdir(conceptsDir,   { recursive: true });
  await fsp.mkdir(batchesDir,    { recursive: true });
  await fsp.mkdir(milestonesDir, { recursive: true });

  // 1. concept_pick gate awaiting_pick with 2 concepts
  await fsp.writeFile(path.join(gatesDir, 'concept_pick.json'), JSON.stringify({
    status: 'awaiting_pick',
    concepts: ['concept_01', 'concept_02'],
    chosen: null,
    hybridized_from: null
  }, null, 2));

  // Write concept files
  await fsp.writeFile(path.join(conceptsDir, 'concept_01.json'), JSON.stringify({
    id: 'concept_01', title: 'Dungeon Crawler', pitch_text: 'A dark dungeon crawler.'
  }, null, 2));
  await fsp.writeFile(path.join(conceptsDir, 'concept_02.json'), JSON.stringify({
    id: 'concept_02', title: 'Cozy Farm', pitch_text: 'A cozy farming sim.'
  }, null, 2));

  // 2. Batch awaiting_review
  await fsp.writeFile(path.join(batchesDir, 'batch_scenes.json'), JSON.stringify({
    id: 'batch_scenes',
    status: 'awaiting_review',
    items: ['scene_01.png', 'scene_02.png']
  }, null, 2));

  // 3. Milestone in failed state
  await fsp.writeFile(path.join(milestonesDir, 'status.json'), JSON.stringify({
    milestone: 'm01_boot',
    boots: false,
    built_at: '2026-05-19T00:00:00.000Z',
    pdx_path: null,
    bytes: null,
    errors: ['pdc: source/main.lua:5: syntax error'],
    depends_on: []
  }, null, 2));
  await fsp.writeFile(path.join(milestonesDir, 'log.txt'), '[milestone] m01_boot\n[pdc] exit 1\n');

  // Seed the DEFAULT_GATES JSON files so listGates doesn't throw
  // (gates.js will seed them on first call, but seeding requires a project
  // resolve — we already have the project registered above)
}

async function cleanup() {
  try { fs.rmSync(tmpData,  { recursive: true, force: true }); } catch (_e) { /* */ }
  try { fs.rmSync(tmpLocal, { recursive: true, force: true }); } catch (_e) { /* */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  await setup();
  console.log('\n[review_board smoke]\n');

  // Import AFTER env is set
  const reviewBoard = require('../server/services/sdk_review_board');

  // --- T1: sync() produces review_board.json + review_board.md ---
  console.log('# sync() writes board files');
  const board = await reviewBoard.sync(projectId, sdkRoot);
  assert(typeof board === 'object' && board !== null, 'sync returns object');
  assert(board.project_id === projectId, 'board has project_id');
  assert(Array.isArray(board.items), 'board.items is array');

  // sdkRoot is already <tmpLocal>/sdk_data — files written directly into it
  const mdPath   = path.join(sdkRoot, 'review_board.md');
  const jsonPath = path.join(sdkRoot, 'review_board.json');
  assert(fs.existsSync(jsonPath), 'review_board.json written');
  assert(fs.existsSync(mdPath),   'review_board.md written');

  // --- T2: board contains expected item ids ---
  console.log('\n# board contains expected items');
  const itemIds = board.items.map((i) => i.id);
  assert(itemIds.some((id) => id === 'concept:concept_01'), 'concept_01 in board');
  assert(itemIds.some((id) => id === 'concept:concept_02'), 'concept_02 in board');
  assert(itemIds.some((id) => id === 'batch:batch_scenes'),  'batch_scenes in board');
  assert(itemIds.some((id) => id === 'milestone:m01_boot'),  'm01_boot milestone in board');

  // --- T3: board.md contains item ids + copy-command strings ---
  console.log('\n# review_board.md contains copy-command strings');
  const mdContent = fs.readFileSync(mdPath, 'utf8');
  assert(mdContent.includes('concept_01'), 'md contains concept_01');
  assert(mdContent.includes('concept_02'), 'md contains concept_02');
  assert(mdContent.includes('batch_scenes'), 'md contains batch_scenes');
  assert(mdContent.includes('m01_boot'), 'md contains m01_boot');

  // Command grammar strings
  assert(mdContent.includes('APPROVE CONCEPT concept_01'), 'md has APPROVE CONCEPT concept_01');
  assert(mdContent.includes('APPROVE CONCEPT concept_02'), 'md has APPROVE CONCEPT concept_02');
  assert(mdContent.includes('APPROVE PHASE'), 'md has APPROVE PHASE');
  assert(mdContent.includes('REVISE PHASE'), 'md has REVISE PHASE');
  assert(mdContent.includes('SHOW SAMPLE'), 'md has SHOW SAMPLE');
  assert(mdContent.includes('RUN SIMULATOR'), 'md has RUN SIMULATOR');
  assert(mdContent.includes('BUILD SAMPLE'), 'md has BUILD SAMPLE');

  // How-to header
  assert(mdContent.includes('How to use'), 'md has How to use header');
  assert(mdContent.includes('LOCK DESIGN'), 'md has LOCK DESIGN in grammar');
  assert(mdContent.includes('KICK OFF FULL BUILD'), 'md has KICK OFF FULL BUILD in grammar');
  assert(mdContent.includes('APPROVE RELEASE'), 'md has APPROVE RELEASE in grammar');

  // --- T4: pendingCount >= 3 before any approvals ---
  console.log('\n# pendingCount before approvals');
  const count0 = await reviewBoard.pendingCount(projectId, sdkRoot);
  assert(typeof count0 === 'number', 'pendingCount returns number');
  assert(count0 >= 3, `pendingCount >= 3 (got ${count0})`);

  // --- T5: recordDecision appends to decisions.md + decisions.jsonl ---
  console.log('\n# recordDecision appends correctly');
  const dec = await reviewBoard.recordDecision(projectId, sdkRoot, {
    id: 'dec-test-001',
    by: 'user',
    phase: 0,
    category: 'gate-signoff',
    decision_text: 'Approved concept_01 as the primary concept.',
    rationale: 'Tone matches the target audience better.',
    references: ['sdk_data/concepts/concept_01.json', 'concept:concept_01'],
  });

  assert(typeof dec === 'object' && dec !== null, 'recordDecision returns object');
  assert(dec.id === 'dec-test-001', 'decision id preserved');
  assert(dec.category === 'gate-signoff', 'decision category correct');
  assert(dec.decision_text.includes('concept_01'), 'decision_text persisted');

  const decisionsMdPath    = path.join(sdkRoot, 'decisions.md');
  const decisionsJsonlPath = path.join(sdkRoot, 'decisions.jsonl');
  assert(fs.existsSync(decisionsMdPath),    'decisions.md written');
  assert(fs.existsSync(decisionsJsonlPath), 'decisions.jsonl written');

  const mdDec   = fs.readFileSync(decisionsMdPath, 'utf8');
  const jsonlDec = fs.readFileSync(decisionsJsonlPath, 'utf8');

  assert(mdDec.includes('gate-signoff'), 'decisions.md has category');
  assert(mdDec.includes('concept_01'),   'decisions.md has decision_text content');
  assert(mdDec.includes('**Decision:**'), 'decisions.md has Decision: field');
  assert(mdDec.includes('**Rationale:**'), 'decisions.md has Rationale: field');
  assert(mdDec.includes('**References:**'), 'decisions.md has References: field');

  const jsonlLines = jsonlDec.trim().split('\n').filter(Boolean);
  assert(jsonlLines.length >= 1, 'decisions.jsonl has at least 1 line');
  const parsedEntry = JSON.parse(jsonlLines[0]);
  assert(parsedEntry.id === 'dec-test-001', 'jsonl entry id correct');
  assert(parsedEntry.category === 'gate-signoff', 'jsonl entry category correct');

  // --- T6: listDecisions returns parsed array ---
  console.log('\n# listDecisions');
  const decList = await reviewBoard.listDecisions(projectId, sdkRoot);
  assert(Array.isArray(decList), 'listDecisions returns array');
  assert(decList.length >= 1, 'listDecisions has at least 1 entry');
  assert(decList[0].id === 'dec-test-001', 'listDecisions returns correct entry');

  // --- T7: pendingCount decreases after markItemStatus(approved) ---
  console.log('\n# pendingCount decreases after approval');
  await reviewBoard.markItemStatus(projectId, sdkRoot, 'concept:concept_01', 'approved');
  const count1 = await reviewBoard.pendingCount(projectId, sdkRoot);
  assert(count1 < count0, `pendingCount decreased from ${count0} to ${count1}`);

  // --- T8: markItemStatus(revise) works ---
  console.log('\n# markItemStatus revise');
  const revised = await reviewBoard.markItemStatus(
    projectId, sdkRoot, 'concept:concept_02', 'revise', 'Tone is too dark for target audience.'
  );
  const revisedItem = revised.items.find((i) => i.id === 'concept:concept_02');
  assert(revisedItem !== undefined, 'concept_02 found in updated board');
  assert(revisedItem.status === 'revise', 'concept_02 status is revise');
  assert(revisedItem.changes_notes && revisedItem.changes_notes.includes('Tone'), 'changes_notes persisted');

  // --- T9: list() returns cached board ---
  console.log('\n# list() returns board');
  const listed = await reviewBoard.list(projectId, sdkRoot);
  assert(Array.isArray(listed.items), 'list().items is array');
  assert(listed.items.length === board.items.length, 'list() item count matches');

  // --- T10: multiple decisions append correctly ---
  console.log('\n# multiple recordDecision calls append');
  await reviewBoard.recordDecision(projectId, sdkRoot, {
    id: 'dec-test-002',
    by: 'user',
    phase: 1,
    category: 'scope',
    decision_text: 'Scope locked to 5 scenes.',
    rationale: 'Budget constraint.',
    references: [],
  });
  const decList2 = await reviewBoard.listDecisions(projectId, sdkRoot);
  assert(decList2.length === 2, `2 decisions in log (got ${decList2.length})`);
  assert(decList2[1].id === 'dec-test-002', 'second decision appended correctly');

  // decisions.md should have both entries
  const mdDec2 = fs.readFileSync(decisionsMdPath, 'utf8');
  assert(mdDec2.includes('gate-signoff'), 'decisions.md still has first entry');
  assert(mdDec2.includes('scope'),        'decisions.md has second entry');

  // Cleanup
  await cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall ok');
}

main().catch((e) => {
  console.error('crash:', e);
  process.exit(1);
});
