'use strict';

// Phase 6 B1 — storyboard service tests.
//
// Builds a synthetic project tree on disk that mirrors the real layout:
//   <root>/source/scenes/title.lua
//   <root>/source/scenes/pwnglove/panel_wires.lua
//   <root>/sdk_data/project.json
//   <root>/sdk_data/scenes/sc01.json
//   <root>/sdk_data/scenes/sc01.png
//
// Then asserts buildStoryboard merges the three sources into the expected
// card list with the expected status pills and metadata.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const storyboard = require('../services/storyboard');

async function mkProject() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'storyboard-test-'));
  await fsp.mkdir(path.join(root, 'source', 'scenes', 'pwnglove'), { recursive: true });
  await fsp.mkdir(path.join(root, 'sdk_data', 'scenes'), { recursive: true });
  return root;
}

test('buildStoryboard merges Lua + sdk_json + manifest', async () => {
  const root = await mkProject();
  try {
    // Pass 1 — manifest in sdk_data/project.json.
    await fsp.writeFile(path.join(root, 'sdk_data', 'project.json'), JSON.stringify({
      scenes: [
        { id: 'sc01', name: 'Opening', description: 'Title screen', mechanic: 'menu', characters: ['ace'] },
        { id: 'sc02', name: 'Forest', description: 'A dark wood' }
      ]
    }, null, 2));

    // Pass 2 — per-scene json + a thumbnail PNG for sc01.
    await fsp.writeFile(path.join(root, 'sdk_data', 'scenes', 'sc01.json'), JSON.stringify({
      anchor_refs: ['refs/forest.png'],
      characters_present: ['ace', 'echo']
    }));
    await fsp.writeFile(path.join(root, 'sdk_data', 'scenes', 'sc01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic

    // Pass 3 — hand-written Lua scenes.
    await fsp.writeFile(
      path.join(root, 'source', 'scenes', 'title.lua'),
      '-- Title screen with crank intro.\n-- Plays the boot jingle on enter.\nlocal title = "HAKCD Title"\nlocal kit = "menu"\n'
    );
    await fsp.writeFile(
      path.join(root, 'source', 'scenes', 'pwnglove', 'panel_wires.lua'),
      '-- Wire panel: choose three colours.\nnpc.spawn("ace")\ndialog.pick("ace.tutorial")\n'
    );

    const board = await storyboard.buildStoryboard({ local_path: root });

    // 4 scenes: sc01 (manifest+json+png), sc02 (manifest only),
    // title (lua), pwnglove_panel_wires (lua).
    assert.strictEqual(board.scenes.length, 4);
    const byId = Object.fromEntries(board.scenes.map((s) => [s.scene_id, s]));

    // sc01 — has lua=no, png=yes, json=yes, manifest=yes → in_progress.
    assert.ok(byId.sc01);
    assert.strictEqual(byId.sc01.status, 'in_progress');
    assert.strictEqual(byId.sc01.thumbnail_path, path.join('sdk_data', 'scenes', 'sc01.png'));
    assert.deepStrictEqual(byId.sc01.characters_present.sort(), ['ace', 'echo']);
    assert.strictEqual(byId.sc01.mechanic, 'menu');

    // sc02 — manifest only → in_progress (json exists nowhere but manifest counts as hasJson? no — manifest only).
    // Per deriveStatus: hasLua=false, hasPng=false, hasJson=false (sources='manifest'),
    // → status='pending' (manifest alone doesn't trip in_progress).
    assert.ok(byId.sc02);
    assert.strictEqual(byId.sc02.status, 'pending');
    assert.strictEqual(byId.sc02.title, 'Forest');

    // title.lua — hasLua=true, hasPng=false → in_progress, summary from comment.
    assert.ok(byId.title);
    assert.strictEqual(byId.title.status, 'in_progress');
    assert.match(byId.title.summary, /Title screen with crank intro/);
    assert.strictEqual(byId.title.mechanic, 'menu');

    // Nested pwnglove/panel_wires.lua → composite id.
    assert.ok(byId.pwnglove_panel_wires);
    assert.ok(byId.pwnglove_panel_wires.characters_present.includes('ace'));

    // Counts.
    assert.strictEqual(board.counts.total, 4);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('buildStoryboard handles missing project tree', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'storyboard-empty-'));
  try {
    const board = await storyboard.buildStoryboard({ local_path: root });
    assert.deepStrictEqual(board, { scenes: [], counts: { total: 0, by_status: {} } });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('buildStoryboard short-circuits on missing local_path', async () => {
  const board = await storyboard.buildStoryboard({ local_path: '' });
  assert.deepStrictEqual(board.scenes, []);
});

test('sceneIdFromLuaPath uses underscore for nested paths', () => {
  const { sceneIdFromLuaPath } = storyboard._internals;
  assert.strictEqual(
    sceneIdFromLuaPath('/proj/source/scenes/pwnglove/panel_wires.lua', '/proj/source/scenes'),
    'pwnglove_panel_wires'
  );
  assert.strictEqual(
    sceneIdFromLuaPath('/proj/source/scenes/title.lua', '/proj/source/scenes'),
    'title'
  );
});

test('deriveStatus pill matches artifact combinations', () => {
  const { deriveStatus } = storyboard._internals;
  assert.strictEqual(deriveStatus({}), 'pending');
  assert.strictEqual(deriveStatus({ hasLua: true, hasPng: true }), 'done');
  assert.strictEqual(deriveStatus({ hasLua: true }), 'in_progress');
  assert.strictEqual(deriveStatus({ hasPng: true }), 'in_progress');
  assert.strictEqual(deriveStatus({ hasJson: true }), 'in_progress');
  assert.strictEqual(deriveStatus({ qaFailed: true }), 'failed');
  assert.strictEqual(deriveStatus({ autopilotStatus: 'failed' }), 'failed');
});
