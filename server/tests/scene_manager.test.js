'use strict';

// Phase 6 B2 — scene manager service tests.
//
// Mirrors the synthetic project tree from storyboard.test.js but adds
// dependency wiring + a QA report so we can exercise every stage in the
// 6-stage state machine.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const sceneManager = require('../services/scene_manager');

async function mkProject() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'scenemgr-test-'));
  await fsp.mkdir(path.join(root, 'source', 'scenes', 'pwnglove'), { recursive: true });
  await fsp.mkdir(path.join(root, 'sdk_data', 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(root, 'build', 'game-v0.1.0.pdx', 'scenes'), { recursive: true });
  return root;
}

test('buildSceneDetail returns 6-stage state + dependency map', async () => {
  const root = await mkProject();
  try {
    await fsp.writeFile(path.join(root, 'sdk_data', 'project.json'), JSON.stringify({
      scenes: [
        { id: 'sc01', name: 'Opening', description: 'Title screen', dependencies: [] },
        { id: 'sc02', name: 'Forest', description: 'Dark wood', dependencies: ['sc01'] }
      ]
    }, null, 2));
    await fsp.writeFile(path.join(root, 'sdk_data', 'scenes', 'sc01.json'), JSON.stringify({
      prompt: 'Generate a 400x240 1-bit title card with dither sky.',
      qa: { failed: false, checks: ['dither_ok', 'palette_ok'] },
      sim: { passed: true, frames: 120 },
      canon_section: '§3 — Title screens',
      skill_rules: ['SKILL.1', 'SKILL.4'],
      dependencies: []
    }));
    // PNG present + shipped artifact in build/<>.pdx.
    await fsp.writeFile(path.join(root, 'sdk_data', 'scenes', 'sc01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fsp.writeFile(path.join(root, 'build', 'game-v0.1.0.pdx', 'scenes', 'sc01.pdz'), Buffer.from([0]));
    // No Lua for sc01 yet.

    const det = await sceneManager.buildSceneDetail({ id: 'p1', name: 'Test', local_path: root }, 'sc01');

    assert.strictEqual(det.card.scene_id, 'sc01');
    assert.strictEqual(det.canon_section, '§3 — Title screens');
    assert.deepStrictEqual(det.skill_rules, ['SKILL.1', 'SKILL.4']);

    // Stages.
    assert.strictEqual(det.stages.prompt_drafted.done, true);
    assert.match(det.stages.prompt_drafted.prompt, /title card/);
    assert.strictEqual(det.stages.asset_generated.done, true);
    assert.strictEqual(det.stages.asset_generated.asset_path, path.join('sdk_data', 'scenes', 'sc01.png'));
    assert.strictEqual(det.stages.qa_passed.done, true);
    assert.strictEqual(det.stages.lua_written.done, false);
    assert.strictEqual(det.stages.sim_tested.done, true);
    assert.strictEqual(det.stages.shipped.done, true);

    // Dependency map — sc01 blocks sc02.
    assert.deepStrictEqual(det.dependencies.blocked_by, []);
    assert.deepStrictEqual(det.dependencies.blocks, ['sc02']);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('buildSceneDetail surfaces inline Lua for hand-written scenes', async () => {
  const root = await mkProject();
  try {
    const luaBody = '-- Title scene.\nlocal title = "HAKCD"\n_G.title = M\nreturn M\n';
    await fsp.writeFile(path.join(root, 'source', 'scenes', 'title.lua'), luaBody);
    const det = await sceneManager.buildSceneDetail({ id: 'p1', name: 'T', local_path: root }, 'title');
    assert.strictEqual(det.stages.lua_written.done, true);
    assert.strictEqual(det.stages.lua_written.lua_path, path.join('source', 'scenes', 'title.lua'));
    assert.strictEqual(det.stages.lua_written.lua_text, luaBody);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('findLuaForScene resolves composite nested ids', async () => {
  const root = await mkProject();
  try {
    const nested = path.join(root, 'source', 'scenes', 'pwnglove', 'panel_wires.lua');
    await fsp.writeFile(nested, '-- nested\n');
    const { findLuaForScene } = sceneManager._internals;
    const found = await findLuaForScene(root, 'pwnglove_panel_wires');
    assert.strictEqual(found, nested);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('buildSceneDetail 404s on unknown scene', async () => {
  const root = await mkProject();
  try {
    await fsp.writeFile(path.join(root, 'sdk_data', 'project.json'), JSON.stringify({ scenes: [] }));
    await assert.rejects(
      () => sceneManager.buildSceneDetail({ id: 'p1', name: 'T', local_path: root }, 'does_not_exist'),
      (err) => err.status === 404 && err.message === 'scene_not_found'
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
