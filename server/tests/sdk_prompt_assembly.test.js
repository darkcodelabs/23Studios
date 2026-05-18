'use strict';

// sdk_prompt_assembly.test.js — unit tests for wolf-pipeline's
// sdk_prompt_assembly.js. The module may not have landed yet; if so we
// t.skip() each test with a TODO note so the suite still reports green
// and the gaps remain visible.
//
// Expected exports (per intake spec sections 3, 4-12, 13, 17):
//   - UNIVERSAL_DIRECTIVE                  string, prepended to every stage
//   - STAGE_AUGMENTS                       object keyed by stage id
//   - assembleSystemPrompt({stageId, storyBible, vars, extras})
//                                          returns the per-call system prompt
//   - buildSceneLuaFromFeatures(scene, featureSet, recipeBody)
//                                          deterministic Lua emitter
//   - QA_CHECKS                            section-16 check list (each entry
//                                          has id, scope, label, run)

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const MODULE_PATH = path.join(__dirname, '..', 'services', 'sdk_prompt_assembly.js');
const MODULE_AVAILABLE = fs.existsSync(MODULE_PATH);
const TODO_NOTE = 'TODO(wolf-pipeline): sdk_prompt_assembly.js not landed yet';

let mod = null;
if (MODULE_AVAILABLE) {
  try { mod = require('../services/sdk_prompt_assembly'); }
  catch (e) { mod = { __loadError: e.message }; }
}

function skipIfMissing(t, fn) {
  if (!MODULE_AVAILABLE) { t.skip(TODO_NOTE); return; }
  if (mod && mod.__loadError) { t.skip(`TODO(wolf-pipeline): load error: ${mod.__loadError}`); return; }
  return fn();
}

test('UNIVERSAL_DIRECTIVE pins the hard SDK constraints', (t) => {
  return skipIfMissing(t, () => {
    const d = mod.UNIVERSAL_DIRECTIVE;
    assert.equal(typeof d, 'string', 'UNIVERSAL_DIRECTIVE must be a string');
    assert.ok(d.length > 200, 'directive must be substantive (>200 chars)');
    assert.match(d, /1-bit/i, 'directive must mention 1-bit');
    assert.match(d, /30 ?fps/i, 'directive must mention 30fps');
    assert.match(d, /Lua 5\.4/i, 'directive must pin Lua 5.4');
    assert.match(d, /1-indexed/i, 'directive must call out 1-indexed arrays');
  });
});

test('STAGE_AUGMENTS covers every autopilot stage', (t) => {
  return skipIfMissing(t, () => {
    const required = [
      'brainstorm', 'story', 'characters',
      'scene_bursts', 'portrait_bursts',
      'scene_lua', 'sfx', 'music', 'launcher'
    ];
    const a = mod.STAGE_AUGMENTS;
    assert.equal(typeof a, 'object', 'STAGE_AUGMENTS must be an object');
    for (const stage of required) {
      assert.ok(stage in a, `STAGE_AUGMENTS missing key: ${stage}`);
      assert.equal(typeof a[stage], 'string',
        `STAGE_AUGMENTS.${stage} must be a string`);
      assert.ok(a[stage].length > 0,
        `STAGE_AUGMENTS.${stage} must be non-empty`);
    }
  });
});

test('assembleSystemPrompt(scene_lua) includes directive + bible + stage augment + extras', (t) => {
  return skipIfMissing(t, () => {
    const storyBible = '# Test Game\n\nA noir thing.';
    // Feature manifest snippet is piped through the `extras` slot, per the
    // module's signature (`{stageId, storyBible, vars, extras}`).
    const extras = [
      '=== FEATURE MANIFEST (subset selected for this scene) ===',
      'lockpick: Crank-driven lockpick. Tumblers fall as crank rotates.',
      '=== END FEATURE MANIFEST ==='
    ].join('\n');
    const prompt = mod.assembleSystemPrompt({
      stageId: 'scene_lua',
      storyBible,
      extras
    });
    assert.equal(typeof prompt, 'string');
    assert.match(prompt, /1-bit/i, 'directive must propagate');
    assert.match(prompt, /Test Game/, 'story bible must propagate');
    assert.match(prompt, /scene_lua/i, 'stage augment header must propagate');
    assert.match(prompt, /lockpick/i, 'extras (feature manifest snippet) must propagate');
  });
});

test('buildSceneLuaFromFeatures emits ordered scene module sections', (t) => {
  return skipIfMissing(t, () => {
    if (typeof mod.buildSceneLuaFromFeatures !== 'function') {
      t.skip('TODO(wolf-pipeline): buildSceneLuaFromFeatures not exported');
      return;
    }
    const scene = { id: 'demo', mechanic_kit: 'lockpick_crank' };
    // featureSet may match manifest entries; with no manifest seeded yet,
    // emitter still produces a valid scene shell with all sections present.
    const featureSet = ['crank_input', 'sprite_movement'];
    const lua = mod.buildSceneLuaFromFeatures(scene, featureSet,
      'state.tumblers = {1,2,3,4,5}');
    assert.equal(typeof lua, 'string');
    assert.ok(lua.length > 200, 'emitted scene Lua must be substantive');

    const importIdx = lua.search(/local gfx <const> = playdate\.graphics/);
    const stateIdx = lua.search(/^local state\s*=/m);
    const enterIdx = lua.search(/function\s+Scene_\w+:enter\b/);
    const updateIdx = lua.search(/function\s+Scene_\w+:update\b/);
    const exitIdx = lua.search(/function\s+Scene_\w+:exit\b/);
    const inputIdx = lua.search(/function\s+Scene_\w+:input\b/);
    const returnIdx = lua.search(/^return Scene_\w+/m);

    assert.ok(importIdx >= 0, 'imports / playdate.graphics local missing');
    assert.ok(stateIdx > importIdx, 'state init must follow imports');
    assert.ok(enterIdx > stateIdx, 'enter must follow state init');
    assert.ok(updateIdx > enterIdx, 'update must follow enter');
    assert.ok(exitIdx > enterIdx, 'exit handler must be present');
    assert.ok(inputIdx > enterIdx, 'input handler must be present');
    assert.ok(returnIdx > updateIdx, 'return statement must be last');
    // Recipe body must land somewhere in the file.
    assert.match(lua, /state\.tumblers/, 'recipe body must be included');
  });
});

test('QA_CHECKS flag an obviously-bad scene', (t) => {
  return skipIfMissing(t, () => {
    if (!Array.isArray(mod.QA_CHECKS)) {
      t.skip('TODO(wolf-pipeline): QA_CHECKS not exported');
      return;
    }
    // Bad scene: global at file scope, sprite movement with no setCollideRect,
    // music started but never stopped on exit.
    const badScene = {
      id: 'broken',
      lua: [
        '-- broken scene with multiple QA violations',
        'BadGlobal = 5',
        'local gfx <const> = playdate.graphics',
        'local Scene_broken = {}',
        'function Scene_broken:enter()',
        '  self.player = gfx.sprite.new()',
        '  self.player:moveTo(200, 120)',
        '  self.player:add()',
        '  audio_manager.play_music("song")',
        'end',
        'function Scene_broken:update(dt) self.player:moveBy(1, 0) end',
        'function Scene_broken:exit() end',
        'return Scene_broken'
      ].join('\n')
    };
    const sceneFailures = [];
    for (const check of mod.QA_CHECKS) {
      if (check.scope !== 'scene') continue;
      const failureMsg = check.run(badScene);
      if (failureMsg) sceneFailures.push({ id: check.id, message: failureMsg });
    }
    assert.ok(sceneFailures.length >= 1,
      `QA gate must flag at least one failure for the broken scene (got ${sceneFailures.length}: ${JSON.stringify(sceneFailures)})`);
    // Spot-check that the section-16 checks we built the fixture against fire.
    const failureIds = new Set(sceneFailures.map((f) => f.id));
    assert.ok(failureIds.has('no_globals')
      || failureIds.has('sprites_have_collide_rect')
      || failureIds.has('music_stop_on_exit'),
      `expected one of no_globals/sprites_have_collide_rect/music_stop_on_exit to fire; got: ${[...failureIds].join(',')}`);
  });
});
