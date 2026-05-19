'use strict';

// Phase 6 A3 — derive_requirements unit tests.
//
// Drives deriveRequirements() against a hand-rolled extracted.json fixture +
// reference_catalog.json and asserts the shape of the produced requirements
// doc. Uses a temp project under PROJECTS_DATA_DIR with a stub project record.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-derive-'));
process.env.PROJECTS_DATA_DIR = tmpRoot;

// Seed the registry so projects.getProject('hakcd-test') resolves to our temp dir.
const projects = require('../services/projects');
const PROJECT_ID = 'hakcd-test';
const PROJECT_DIR = path.join(tmpRoot, 'hakcd_test_project');
fs.mkdirSync(PROJECT_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(PROJECT_DIR, 'sdk_data', 'requirements'), { recursive: true });

const derive = require('../services/derive_requirements');

async function seedProject() {
  await projects.createProject({
    id: PROJECT_ID,
    name: 'hakcd test fixture',
    description: 'A3 derive test',
    repo: 'https://example.invalid/r.git',
    local_path: PROJECT_DIR,
    platform: 'playdate',
    game_type: 'sdk'
  });
}

async function writeFixtures(extracted, refCatalog) {
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'extracted.json'),
    JSON.stringify(extracted, null, 2)
  );
  if (refCatalog) {
    await fsp.writeFile(
      path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'reference_catalog.json'),
      JSON.stringify(refCatalog, null, 2)
    );
  }
}

test('deriveRequirements produces scene_bg + scene_lua + dialog per scene', async (t) => {
  await seedProject();
  await writeFixtures({
    scenes: [
      { id: 'SC01', title: 'Bedroom Hub', summary: 'Player wakes', characters: ['Cass'], gameplay_type: 'hub' },
      { id: 'SC02', title: 'AOL Lobby', summary: 'first chat', characters: ['Cass', 'k0nsole'] }
    ],
    characters: [
      { name: 'Cass', role: 'protagonist', portrait_ref: 'pixel_collection/cass.png' },
      { name: 'k0nsole' }
    ],
    locations: [],
    minigames: [],
    ui_surfaces: [{ name: 'launcher_menu' }],
    inventory_items: [],
    sfx: [{ name: 'modem_handshake', scene: 'SC02' }],
    music: [{ name: 'act1_theme', scene: 'SC01' }]
  }, {
    images: [
      { path: 'pixel_collection/bedroom.png', anchored_to: { scenes: ['SC01'], characters: [], ui: [] } },
      { path: 'pixel_collection/cass.png', anchored_to: { scenes: [], characters: ['Cass'], ui: [] } }
    ]
  });

  const doc = await derive.deriveRequirements(PROJECT_ID);

  assert.ok(doc, 'doc returned');
  assert.ok(Array.isArray(doc.requirements), 'requirements is array');
  // 2 scene_bg + 2 scene_lua + 2 dialog + 2 portraits + 1 ui + 1 sfx + 1 music + 1 launcher
  assert.ok(doc.requirements.length >= 11, 'has ≥ 11 derived items');

  const byKind = doc.counts_by_kind;
  assert.equal(byKind.scene_bg, 2, '2 scene backgrounds');
  assert.equal(byKind.scene_lua, 2, '2 scene lua modules');
  assert.equal(byKind.dialog_block, 2, '2 dialog blocks (both scenes have chars)');
  assert.equal(byKind.character_portrait, 2, '2 character portraits');
  assert.equal(byKind.launcher_asset, 1, 'launcher always included');

  // SC01 background should pick up the bedroom.png anchor.
  const sc01bg = doc.requirements.find((r) => r.id === 'req-SC01-scene_bg');
  assert.ok(sc01bg, 'SC01 scene_bg requirement exists');
  assert.deepEqual(sc01bg.anchor_refs, ['pixel_collection/bedroom.png']);
  assert.ok(sc01bg.skill_rules.includes('1bit'), '1bit rule attached');

  // Cass portrait should pick up the explicit portrait_ref.
  const cassPortrait = doc.requirements.find((r) => r.title === 'Cass portrait');
  assert.ok(cassPortrait);
  assert.deepEqual(cassPortrait.anchor_refs, ['pixel_collection/cass.png']);

  // SC02 scene_lua depends on its scene_bg.
  const sc02Lua = doc.requirements.find((r) => r.id === 'req-SC02-scene_lua');
  assert.ok(sc02Lua);
  assert.deepEqual(sc02Lua.dependencies, ['req-SC02-scene_bg']);

  // Cost totals make sense.
  assert.ok(doc.totals.est_cost_usd_zero_reroll > 0, 'has positive base cost');
  assert.ok(doc.totals.est_cost_usd_avg_reroll_1_5 > doc.totals.est_cost_usd_zero_reroll,
    'reroll-avg cost exceeds base');
});

test('deriveRequirements survives missing extracted.json by falling back to bible parse', async (t) => {
  // Create a SECOND project that doesn't have extracted.json — just a bible.
  const otherDir = path.join(tmpRoot, 'fallback_project');
  fs.mkdirSync(path.join(otherDir, 'sdk_data'), { recursive: true });
  fs.writeFileSync(
    path.join(otherDir, 'sdk_data', 'story_bible.md'),
    '# Fallback Game\n\n## SC01 — Opening\n\n- **Hero** appears.\n\n## SC02 — Choice\n\n- **Hero** speaks.\n'
  );
  await projects.createProject({
    id: 'fallback-test',
    name: 'fallback',
    description: 'bible-only',
    repo: 'https://example.invalid/r.git',
    local_path: otherDir,
    platform: 'playdate',
    game_type: 'sdk'
  });

  const doc = await derive.deriveRequirements('fallback-test');
  assert.equal(doc.extraction_source, 'bible_fallback_parse');
  // Found 2 scene IDs in the markdown → 2 backgrounds + 2 lua modules + launcher.
  assert.ok(doc.requirements.length >= 5);
  assert.equal(doc.counts_by_kind.scene_bg, 2);
});

test.after(async () => {
  // Best-effort cleanup so subsequent test runs start fresh.
  try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});
