'use strict';

// Phase 3 smoke test — verifies all services load + key contracts hold.
// Does NOT call out to LLMs; pure in-process check.
//
// Run: node tests/phase3_smoke.test.js

const path = require('path');
const fs = require('fs');
const os = require('os');

let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok ' + msg); }
  else { console.error('  FAIL ' + msg); failed++; }
}

async function main() {
  console.log('# style_axis');
  const styleAxis = require('../server/services/style_axis');
  const axes = await styleAxis.listAxes();
  assert(axes.length === 14, `14 axes load (got ${axes.length})`);
  const validStages = new Set(['brainstorm', 'story', 'characters', 'scene_bursts',
    'portrait_bursts', 'scene_lua', 'sfx', 'music', 'launcher', 'npc_dialog_tool']);
  let badStageRefs = 0;
  for (const a of axes) {
    for (const s of (a.consumed_by_stages || [])) {
      if (!validStages.has(s)) { badStageRefs++; console.error('  BAD stage ref:', a.id, '→', s); }
    }
  }
  assert(badStageRefs === 0, 'all consumed_by_stages refs valid');

  console.log('# preset_packs');
  const packs = require('../server/services/preset_packs');
  const packList = await packs.listPacks();
  assert(packList.length === 8, `8 packs load (got ${packList.length})`);
  for (const p of packList) {
    const full = await packs.loadPack(p.id);
    assert(Object.keys(full.axis_picks || {}).length === 14, `pack ${p.id}: 14 axis defaults`);
  }

  console.log('# intake mapping');
  const intake = require('../server/services/intake_form');
  const seeds = intake.mapIntakeToAxisDefaults({
    pitch: 'test', genre: 'narrative', format: 'scene_based',
    protagonist_archetype: 'drifter', audio_direction: 'samples',
    save_state: 'slots', playtime_target_min: 30, scene_count: 8, minigame_count: 2
  });
  assert(seeds.pacing_style != null, 'intake seeds pacing_style');
  assert(seeds.gameplay_style != null, 'intake seeds gameplay_style');
  assert(seeds.character_style != null, 'intake seeds character_style');
  assert(seeds.audio_style.spec.music_palette === 'sample_only', 'audio mapping samples → sample_only');
  assert(seeds.save_style.spec.trigger === 'manual_save_points', 'save mapping slots → manual_save_points');

  console.log('# prompt assembly');
  const assembly = require('../server/services/sdk_prompt_assembly');
  const block = assembly.formatActivePicks({
    gameplay_style: { id: 'opt_x', name: 'X', spec: { camera: 'top_down' } }
  }, 'scene_lua');
  assert(block.includes('ACTIVE STYLE PICKS'), 'formatActivePicks emits picks block');
  assert(block.includes('top_down'), 'pick fields included');

  // scene_lua augment must describe the stack-based scene_manager API
  const augText = assembly.STAGE_AUGMENTS.scene_lua;
  assert(/scene_manager\.push/.test(augText), 'scene_lua augment documents .push');
  assert(/scene_manager\.replace/.test(augText), 'scene_lua augment documents .replace');
  assert(/scene_manager\.pop/.test(augText), 'scene_lua augment documents .pop');
  assert(/exit\(\)[\s\S]*BEFORE[\s\S]*init/i.test(augText), 'scene_lua augment documents exit-before-init');
  assert(/NO dt parameter/i.test(augText), 'scene_lua augment forbids dt param');

  // buildSceneLuaFromFeatures must emit stack-compatible Lua
  const luaSrc = assembly.buildSceneLuaFromFeatures({
    id: 'warehouse_01', mechanic_kit: 'crank_lockpick',
    exits: [{ to_scene: 'warehouse_02', label: 'next', spawn_target: 'door_north' }]
  }, [], '');
  assert(/function Scene_warehouse_01:update\(\)/.test(luaSrc), 'emitter: update() takes NO dt');
  assert(!/function Scene_warehouse_01:update\(dt\)/.test(luaSrc), 'emitter: no :update(dt) anywhere');
  assert(/scene_manager\.replace\(next_scene/.test(luaSrc), 'emitter: transition uses scene_manager.replace');
  assert(/local exits = \{\s*\["next"\]/.test(luaSrc), 'emitter: exits table populated from scene.exits');
  assert(/chrome_theme\.draw_overlay/.test(luaSrc), 'emitter: draw() calls chrome_theme.draw_overlay');
  assert(/Phase 3 stack-based scene_manager/.test(luaSrc), 'emitter: header documents contract');

  const luaEmpty = assembly.buildSceneLuaFromFeatures({ id: 'simple_room' }, [], '');
  assert(/no static exits declared/.test(luaEmpty), 'emitter: empty exits handled');

  console.log('# late_add module');
  const lateAdd = require('../server/services/late_add');
  assert(typeof lateAdd.addScene === 'function', 'addScene exported');
  assert(typeof lateAdd.swapStylePick === 'function', 'swapStylePick exported');
  assert(Object.keys(lateAdd.RETROFIT_HANDLERS).length === 6, '6 retrofit handlers');

  console.log('# npc_dialog_tool validation');
  const npc = require('../server/services/npc_dialog_tool');
  let threw = false;
  try {
    npc._internals.validateTree({
      npc_id: 'merchant_01', name: 'X',
      nodes: [{ id: 'n_a', type: 'say', text: 'hi', next: 'n_missing' }]
    });
  } catch (e) { threw = true; assert(/dangling/i.test(e.message), 'dangling ref detected'); }
  assert(threw, 'validateTree rejects dangling ref');

  const ok = npc._internals.validateTree({
    npc_id: 'merchant_01', name: 'X',
    nodes: [
      { id: 'n_a', type: 'say', text: 'hi', next: 'n_b' },
      { id: 'n_b', type: 'end' }
    ]
  });
  assert(ok.entry_node === 'n_a', 'validateTree auto-sets entry_node');

  console.log('# level_editor validation');
  const lvl = require('../server/services/level_editor');
  const blank = lvl.newBlankLevel({ levelId: 'test_level', imagetablePath: 'assets/tiles/x' });
  assert(blank.tiles.length === 25 * 15, 'newBlankLevel tile array sized correctly');
  let lvErr = false;
  try { lvl._internals.validateLevel({ level_id: 'BadID', imagetable_path: 'x',
    tile_width: 16, tile_height: 16, grid_width: 4, grid_height: 4, tiles: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] }); }
  catch (_e) { lvErr = true; }
  assert(lvErr, 'validateLevel rejects bad level_id (uppercase)');

  console.log('# minigame_editor');
  const mg = require('../server/services/minigame_editor');
  assert(mg.listSupportedKits().length === 4, '4 configurable kits');
  assert(mg.defaultConfigForKit('crank_lockpick').pins.length === 5, 'crank_lockpick default has 5 pins');
  let mgErr = false;
  try { mg._internals.VALIDATORS.crank_lockpick({ pins: [] }); }
  catch (_e) { mgErr = true; }
  assert(mgErr, 'minigame validator rejects empty pins');

  console.log('# asset_import');
  const ai = require('../server/services/asset_import');
  assert(ai.sniffKind('foo.png') === 'image', 'sniff png → image');
  assert(ai.sniffKind('beat.wav') === 'audio', 'sniff wav → audio');
  assert(ai.sniffKind('mystery.xyz') === null, 'sniff unknown → null');

  console.log('# routes load (without start)');
  const routes = [
    '../server/routes/styles',
    '../server/routes/asset_library',
    '../server/routes/late_add',
    '../server/routes/npc',
    '../server/routes/levels',
    '../server/routes/minigames'
  ];
  for (const r of routes) {
    require(r);
    assert(true, 'route loads: ' + r);
  }

  console.log('# runtime lua files exist');
  const lua = [
    'server/services/sdk_runtime_lua/scene_manager.lua',
    'server/services/sdk_runtime_lua/concepts/dialog_tree.lua',
    'server/services/sdk_runtime_lua/concepts/chrome_theme.lua',
    'server/services/sdk_runtime_lua/concepts/nfo_renderer.lua',
    'server/services/sdk_runtime_lua/concepts/text_effects.lua',
    'server/services/sdk_runtime_lua/concepts/static_terminal_menu.lua',
    'server/services/sdk_runtime_lua/concepts/terminal_renderer.lua'
  ];
  for (const f of lua) {
    assert(fs.existsSync(path.join(__dirname, '..', f)), 'lua file exists: ' + f);
  }
  // verify scene_manager is the stack-based HAKCD port (looks for "stack" + "push" + "replace")
  const sm = fs.readFileSync(path.join(__dirname, '..', 'server/services/sdk_runtime_lua/scene_manager.lua'), 'utf8');
  assert(/local stack = \{\}/.test(sm), 'scene_manager.lua is stack-based');
  assert(/function M\.push/.test(sm) && /function M\.replace/.test(sm), 'scene_manager.lua exports push + replace');

  console.log('\n' + (failed === 0 ? '✅ all phase 3 smoke checks passed' : `❌ ${failed} check(s) failed`));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('UNCAUGHT:', e); process.exit(1); });
