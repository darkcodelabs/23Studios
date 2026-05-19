'use strict';

// Phase 6 B2 — scene_detail service tests.
//
// Synthetic on-disk project tree exercising the 6-stage state machine:
//   sdk_data/scenes/<id>.json            → prompt_drafted
//   sdk_data/scenes/<id>.png             → asset_generated
//   sdk_data/qa_results/<id>.json        → qa_passed (or failed)
//   source/scenes/<id>.lua               → lua_written (incl. composite ids)
//   sdk_data/sim_walkthrough/<id>.png    → sim_tested
//   released/<id>.commit_sha             → shipped (OR build/*.pdx)

const test = require('node:test');
const assert = require('node:assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const sceneDetail = require('../services/scene_detail');

async function mkProject() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'scene-detail-test-'));
  await fsp.mkdir(path.join(root, 'sdk_data', 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(root, 'sdk_data', 'qa_results'), { recursive: true });
  await fsp.mkdir(path.join(root, 'sdk_data', 'sim_walkthrough'), { recursive: true });
  await fsp.mkdir(path.join(root, 'source', 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(root, 'released'), { recursive: true });
  await fsp.mkdir(path.join(root, 'build'), { recursive: true });
  return root;
}

function stagesById(stages) {
  return Object.fromEntries(stages.map((s) => [s.stage, s]));
}

test('buildSceneDetail returns all 6 stages pending on a bare project', async () => {
  const root = await mkProject();
  try {
    const detail = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    assert.strictEqual(detail.scene_id, 'sc01');
    assert.strictEqual(detail.stages.length, 6);
    const by = stagesById(detail.stages);
    for (const k of ['prompt_drafted', 'asset_generated', 'qa_passed', 'lua_written', 'sim_tested', 'shipped']) {
      assert.strictEqual(by[k].status, 'pending', `${k} expected pending`);
    }
    assert.strictEqual(detail.current_stage, 'prompt_drafted');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('buildSceneDetail advances through stages as artifacts appear', async () => {
  const root = await mkProject();
  try {
    // 1. prompt_drafted
    await fsp.writeFile(
      path.join(root, 'sdk_data', 'scenes', 'sc01.json'),
      JSON.stringify({ title: 'Opening', prompt: 'A title screen.' })
    );
    let d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    let by = stagesById(d.stages);
    assert.strictEqual(by.prompt_drafted.status, 'done');
    assert.strictEqual(by.prompt_drafted.artifact_path, path.join('sdk_data', 'scenes', 'sc01.json'));
    assert.strictEqual(d.current_stage, 'asset_generated');
    assert.strictEqual(d.panels.prompt.prompt_text, 'A title screen.');

    // 2. asset_generated
    await fsp.writeFile(path.join(root, 'sdk_data', 'scenes', 'sc01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    by = stagesById(d.stages);
    assert.strictEqual(by.asset_generated.status, 'done');
    assert.strictEqual(d.current_stage, 'qa_passed');

    // 3. qa_passed (with explicit failed=false)
    await fsp.writeFile(
      path.join(root, 'sdk_data', 'qa_results', 'sc01.json'),
      JSON.stringify({ failed: false, summary: 'all checks passed' })
    );
    d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    by = stagesById(d.stages);
    assert.strictEqual(by.qa_passed.status, 'done');
    assert.strictEqual(by.qa_passed.detail, 'all checks passed');
    assert.strictEqual(d.current_stage, 'lua_written');

    // 4. lua_written
    await fsp.writeFile(
      path.join(root, 'source', 'scenes', 'sc01.lua'),
      '-- sc01\nlocal title = "Opening"\n'
    );
    d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    by = stagesById(d.stages);
    assert.strictEqual(by.lua_written.status, 'done');
    assert.strictEqual(d.current_stage, 'sim_tested');
    assert.ok(d.panels.lua.text.includes('local title'));

    // 5. sim_tested
    await fsp.writeFile(path.join(root, 'sdk_data', 'sim_walkthrough', 'sc01.png'), Buffer.from([0x89]));
    d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    by = stagesById(d.stages);
    assert.strictEqual(by.sim_tested.status, 'done');
    assert.strictEqual(d.current_stage, 'shipped');

    // 6. shipped via released/.commit_sha
    await fsp.writeFile(path.join(root, 'released', 'sc01.commit_sha'), 'deadbeef');
    d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    by = stagesById(d.stages);
    assert.strictEqual(by.shipped.status, 'done');
    assert.strictEqual(by.shipped.detail, 'released_sha');
    assert.strictEqual(d.current_stage, 'shipped');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('qa_passed → failed when QA report flags failure', async () => {
  const root = await mkProject();
  try {
    await fsp.writeFile(
      path.join(root, 'sdk_data', 'qa_results', 'sc01.json'),
      JSON.stringify({ pass: false, failures: ['palette has 3 colors', 'text too small'] })
    );
    const d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    const by = stagesById(d.stages);
    assert.strictEqual(by.qa_passed.status, 'failed');
    assert.match(by.qa_passed.error, /palette has 3 colors/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('composite scene id resolves nested Lua path', async () => {
  const root = await mkProject();
  try {
    await fsp.mkdir(path.join(root, 'source', 'scenes', 'pwnglove'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'source', 'scenes', 'pwnglove', 'panel_wires.lua'),
      '-- wire panel\n'
    );
    const luaPath = await sceneDetail._internals.resolveLuaPath(
      path.join(root, 'source', 'scenes'),
      'pwnglove_panel_wires'
    );
    assert.ok(luaPath);
    assert.ok(luaPath.endsWith(path.join('pwnglove', 'panel_wires.lua')));

    const d = await sceneDetail.buildSceneDetail({ local_path: root }, 'pwnglove_panel_wires');
    const by = stagesById(d.stages);
    assert.strictEqual(by.lua_written.status, 'done');
    assert.strictEqual(by.lua_written.artifact_path, path.join('source', 'scenes', 'pwnglove', 'panel_wires.lua'));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('shipped detected via build/*.pdx fallback when no released sha', async () => {
  const root = await mkProject();
  try {
    await fsp.writeFile(path.join(root, 'build', 'game.pdx'), 'fake pdx');
    const d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    const by = stagesById(d.stages);
    assert.strictEqual(by.shipped.status, 'done');
    assert.strictEqual(by.shipped.detail, 'build_pdx');
    assert.ok(by.shipped.artifact_path.endsWith('.pdx'));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('dep_map surfaces blocks / is_blocked_by from Lua scene_manager calls', async () => {
  const root = await mkProject();
  try {
    // sc01 pushes sc02; sc03 pushes sc01.
    await fsp.writeFile(
      path.join(root, 'source', 'scenes', 'sc01.lua'),
      '-- sc01\nscene_manager.push("sc02")\n'
    );
    await fsp.writeFile(
      path.join(root, 'source', 'scenes', 'sc02.lua'),
      '-- sc02\n'
    );
    await fsp.writeFile(
      path.join(root, 'source', 'scenes', 'sc03.lua'),
      '-- sc03\nscene_manager.push("sc01")\n'
    );
    const d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    assert.deepStrictEqual(d.dep_map.is_blocked_by, ['sc02']);
    assert.deepStrictEqual(d.dep_map.blocks, ['sc03']);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('metadata header merges manifest + per-scene JSON', async () => {
  const root = await mkProject();
  try {
    await fsp.writeFile(
      path.join(root, 'sdk_data', 'project.json'),
      JSON.stringify({
        scenes: [{
          id: 'sc01',
          name: 'Opening',
          description: 'Title screen',
          characters: ['ace'],
          style_reference: 'refs/title.png',
          mechanic: 'menu',
          act: 1
        }]
      })
    );
    await fsp.writeFile(
      path.join(root, 'sdk_data', 'scenes', 'sc01.json'),
      JSON.stringify({
        characters_present: ['ace', 'echo'],
        anchor_refs: ['refs/forest.png'],
        canon_sections: ['§3', '§7'],
        skill_rules: ['#1', '#4']
      })
    );
    const d = await sceneDetail.buildSceneDetail({ local_path: root }, 'sc01');
    assert.strictEqual(d.metadata.title, 'Opening');
    assert.strictEqual(d.metadata.description, 'Title screen');
    assert.strictEqual(d.metadata.mechanic, 'menu');
    assert.strictEqual(d.metadata.act, 1);
    assert.deepStrictEqual(d.metadata.characters_present.sort(), ['ace', 'echo']);
    assert.deepStrictEqual(d.metadata.anchor_refs, ['refs/title.png', 'refs/forest.png']);
    assert.deepStrictEqual(d.metadata.canon_sections, ['§3', '§7']);
    assert.deepStrictEqual(d.metadata.skill_rules, ['#1', '#4']);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('qaIsPassing handles every supported flag shape', () => {
  const { qaIsPassing } = sceneDetail._internals;
  assert.strictEqual(qaIsPassing({ pass: true }), true);
  assert.strictEqual(qaIsPassing({ status: 'pass' }), true);
  assert.strictEqual(qaIsPassing({ status: 'PASS' }), true);
  assert.strictEqual(qaIsPassing({ failed: false }), true);
  assert.strictEqual(qaIsPassing({ pass: false }), false);
  assert.strictEqual(qaIsPassing({ failed: true }), false);
  assert.strictEqual(qaIsPassing(null), false);
  assert.strictEqual(qaIsPassing({}), false);
});

test('buildSceneDetail rejects missing local_path', async () => {
  await assert.rejects(
    () => sceneDetail.buildSceneDetail({ local_path: '' }, 'sc01'),
    /local_path missing/
  );
});

test('buildSceneDetail rejects empty sceneId', async () => {
  const root = await mkProject();
  try {
    await assert.rejects(
      () => sceneDetail.buildSceneDetail({ local_path: root }, ''),
      /sceneId required/
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
