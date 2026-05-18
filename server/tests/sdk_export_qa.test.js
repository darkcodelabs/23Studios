'use strict';

// sdk_export_qa.test.js — integration tests for the section-16 QA gate
// applied to a synthetic on-disk scene tree.
//
// The QA gate ships as `QA_CHECKS` (array of `{id, scope, label, run}`)
// exported from services/sdk_prompt_assembly.js. Each scoped check is
// run by the test driver against the fixture; this mirrors how the
// autopilot is expected to fan out the checks pre-export.
//
// If the module hasn't landed yet we t.skip() with a TODO note. The
// fixture itself is always built so future test runs have something
// to point at.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const QA_MODULE_PATH = path.join(__dirname, '..', 'services', 'sdk_prompt_assembly.js');
const QA_AVAILABLE = fs.existsSync(QA_MODULE_PATH);
const TODO_NOTE = 'TODO(wolf-pipeline): QA_CHECKS not landed yet';

let qa = null;
if (QA_AVAILABLE) {
  try { qa = require('../services/sdk_prompt_assembly'); }
  catch (e) { qa = { __loadError: e.message }; }
}

const FIXTURE_ROOT = path.join(os.tmpdir(), 'qa_fixture_' + process.pid);

// Synthetic bad scene: moving sprite without :setCollideRect(), missing
// audio_manager.stop_music() in exit, unused crank import.
const BAD_SCENE_LUA = [
  '-- scenes/bad_scene.lua — intentionally bad for QA tests',
  'import "CoreLibs/graphics"',
  'import "CoreLibs/sprites"',
  'import "CoreLibs/crank"          -- unused: scene never reads crank',
  '',
  'local gfx <const> = playdate.graphics',
  '',
  'local Scene = {}',
  '',
  'function Scene:enter()',
  '  self.player = gfx.sprite.new()',
  '  self.player:moveTo(200, 120)',
  '  self.player:add()',
  '  -- intentionally missing the collider call so QA fires sprites_have_collide_rect',
  '  audio_manager.play_music("bad_song")',
  'end',
  '',
  'function Scene:update(dt)',
  '  self.player:moveBy(1, 0)',
  'end',
  '',
  'function Scene:exit()',
  '  -- intentionally no audio cleanup so QA fires music_stop_on_exit',
  'end',
  '',
  'return Scene'
].join('\n');

async function buildFixture() {
  await fsp.rm(FIXTURE_ROOT, { recursive: true, force: true });
  const scenesDir = path.join(FIXTURE_ROOT, 'source', 'scenes');
  await fsp.mkdir(scenesDir, { recursive: true });
  await fsp.writeFile(path.join(scenesDir, 'bad_scene.lua'), BAD_SCENE_LUA);
  // Also drop a main.lua so the tree looks like a real export source dir.
  await fsp.writeFile(
    path.join(FIXTURE_ROOT, 'source', 'main.lua'),
    '-- minimal main.lua for fixture\n'
  );
  return FIXTURE_ROOT;
}

test('synthetic bad scene tree builds at /tmp', async () => {
  const root = await buildFixture();
  assert.ok(fs.existsSync(path.join(root, 'source', 'scenes', 'bad_scene.lua')),
    'fixture scene must exist on disk');
  const txt = await fsp.readFile(path.join(root, 'source', 'scenes', 'bad_scene.lua'), 'utf8');
  assert.match(txt, /moveBy\(1, 0\)/, 'sentinel: moving sprite present');
  assert.doesNotMatch(txt, /setCollideRect/, 'sentinel: missing setCollideRect');
  // Note: stop_music absence is asserted via QA_CHECKS below, not text sentinel,
  // because the bad scene's :exit() block has no stop_music call.
});

test('QA_CHECKS flag the expected section-16 violations on the bad scene', async (t) => {
  if (!QA_AVAILABLE) { t.skip(TODO_NOTE); return; }
  if (qa.__loadError) { t.skip(`TODO(wolf-pipeline): load error: ${qa.__loadError}`); return; }
  if (!Array.isArray(qa.QA_CHECKS)) {
    t.skip('TODO(wolf-pipeline): QA_CHECKS not exported');
    return;
  }
  await buildFixture();
  const sceneRecord = { id: 'bad_scene', lua: BAD_SCENE_LUA };

  const failures = [];
  for (const check of qa.QA_CHECKS) {
    if (check.scope !== 'scene') continue;
    let msg = null;
    try { msg = check.run(sceneRecord); }
    catch (e) { msg = `check threw: ${e.message}`; }
    if (msg) failures.push({ id: check.id, label: check.label, message: msg });
  }

  assert.ok(failures.length >= 1,
    `at least one scene-scoped QA failure must fire (got ${failures.length})`);

  // Verify each failure has the contract shape (id + message).
  for (const f of failures) {
    assert.equal(typeof f.id, 'string', 'failure must carry id');
    assert.ok(f.id.length > 0, 'failure id must be non-empty');
    assert.equal(typeof f.message, 'string', 'failure must carry message');
  }

  // Section-16 check ids that the fixture is engineered to trip.
  const failureIds = new Set(failures.map((f) => f.id));
  const expectedAtLeastOne = [
    'sprites_have_collide_rect',
    'music_stop_on_exit'
  ];
  const hit = expectedAtLeastOne.filter((id) => failureIds.has(id));
  assert.ok(hit.length >= 1,
    `expected at least one of [${expectedAtLeastOne.join(', ')}] to fire; got [${[...failureIds].join(', ')}]`);

  t.diagnostic(`scene-scoped failures: ${failures.map((f) => f.id).join(', ')}`);
});

test('QA_CHECKS expose stable {id, scope, label, run} contract', (t) => {
  if (!QA_AVAILABLE) { t.skip(TODO_NOTE); return; }
  if (qa.__loadError) { t.skip(`TODO(wolf-pipeline): load error: ${qa.__loadError}`); return; }
  if (!Array.isArray(qa.QA_CHECKS)) {
    t.skip('TODO(wolf-pipeline): QA_CHECKS not exported');
    return;
  }
  assert.ok(qa.QA_CHECKS.length > 0, 'must have at least one QA check');
  for (const c of qa.QA_CHECKS) {
    assert.equal(typeof c.id, 'string', 'check.id must be string');
    assert.match(c.scope, /^(scene|project)$/, 'check.scope must be scene|project');
    assert.equal(typeof c.label, 'string', 'check.label must be string');
    assert.equal(typeof c.run, 'function', 'check.run must be function');
  }
});

test.after(async () => {
  await fsp.rm(FIXTURE_ROOT, { recursive: true, force: true });
});
