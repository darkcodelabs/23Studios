'use strict';

// Phase 6 A7 — work graph unit tests.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a7-graph-'));
process.env.PROJECTS_DATA_DIR = tmpRoot;

const projects = require('../services/projects');
const workGraph = require('../services/work_graph');

const PROJECT_DIR = path.join(tmpRoot, 'hakcd_test');
fs.mkdirSync(path.join(PROJECT_DIR, 'sdk_data', 'requirements'), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(PROJECT_DIR, 'sdk_data', 'scope'), { recursive: true, mode: 0o700 });

async function seedProject() {
  await projects.createProject({
    id: 'hakcd-test', name: 'fixture', description: 'A7 test',
    repo: 'https://example.invalid/r.git', local_path: PROJECT_DIR,
    platform: 'playdate', game_type: 'sdk'
  });
}

async function writeScope() {
  // v0.1: 4 in-scope, 1 deferred. Includes both scene_bg + scene_lua for SC01
  // so the dependency edge gets created.
  const snap = {
    version: 1, file_version: 'v0.1.json',
    project_id: 'hakcd-test',
    locked_at: new Date().toISOString(),
    based_on_candidate_generated_at: new Date().toISOString(),
    in_scope: [
      'req-SC01-scene_bg',
      'req-SC01-scene_lua',
      'req-SC02-scene_bg',
      'req-SC02-npc_dialog'
    ],
    deferred: [
      { requirement_id: 'req-SC99-scene_bg', reason: 'deferred', est_cost_usd: 0.08 }
    ],
    totals: { in_scope_count: 4, deferred_count: 1, est_cost_in_scope_usd: 0.32, est_cost_deferred_usd: 0.08 },
    budget_usd: 1.00, notes: 'test'
  };
  await fsp.writeFile(path.join(PROJECT_DIR, 'sdk_data', 'scope', 'v0.1.json'), JSON.stringify(snap, null, 2));
  await fsp.writeFile(path.join(PROJECT_DIR, 'sdk_data', 'scope', 'latest.json'), JSON.stringify({
    version: 1, file_version: 'v0.1.json', locked_at: snap.locked_at
  }));
}

async function writeFixtures() {
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'extracted.json'),
    JSON.stringify({
      scenes: [
        { id: 'SC01', title: 'Bedroom Hub', summary: 'opens here' },
        { id: 'SC02', title: 'AOL Lobby', summary: 'first jump' }
      ]
    })
  );
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'derived.json'),
    JSON.stringify({
      requirements: [
        { id: 'req-SC01-scene_bg', kind: 'scene_bg', est_cost_usd: 0.12 },
        { id: 'req-SC01-scene_lua', kind: 'scene_lua' },
        { id: 'req-SC02-scene_bg', kind: 'scene_bg' },
        { id: 'req-SC02-npc_dialog', kind: 'npc_dialog' }
      ]
    })
  );
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'reference_catalog.json'),
    JSON.stringify({
      images: [
        { anchor_scene: 'SC01', path: 'pixel_collection/bedroom.png' }
      ]
    })
  );
}

test('generateGraph fails without a locked scope', async () => {
  await seedProject();
  await assert.rejects(workGraph.generateGraph('hakcd-test'), (e) => e.code === 'no_scope');
});

test('generateGraph emits one node per included requirement w/ correct defaults', async () => {
  await writeScope();
  await writeFixtures();
  const g = await workGraph.generateGraph('hakcd-test');
  assert.equal(g.nodes.length, 4);
  assert.equal(g.totals.node_count, 4);
  // 0.12 (explicit) + 0.04 (default scene_lua) + 0.08 (default scene_bg) + 0.02 (default npc_dialog) = 0.26
  assert.equal(g.totals.est_cost_total_usd, 0.26);
  const bg = g.nodes.find((n) => n.id === 'task-SC01-scene_bg');
  assert.ok(bg);
  assert.equal(bg.kind, 'scene_bg');
  assert.equal(bg.agent_assignment, 'openrouter:openai/gpt-5-image-mini');
  assert.deepEqual(bg.skill_rules, ['1bit', '400x240']);
  assert.deepEqual(bg.anchor_inputs, ['pixel_collection/bedroom.png']);
  assert.equal(bg.prompt_source, 'canon:SC01');
});

test('generateGraph wires scene_lua depends_on scene_bg + reverse blocks', async () => {
  const g = await workGraph.getGraph('hakcd-test');
  const lua = g.nodes.find((n) => n.id === 'task-SC01-scene_lua');
  assert.deepEqual(lua.depends_on, ['task-SC01-scene_bg']);
  const bg = g.nodes.find((n) => n.id === 'task-SC01-scene_bg');
  assert.ok(bg.blocks.includes('task-SC01-scene_lua'));
});

test('updateNode flips status + stamps timestamps', async () => {
  const r1 = await workGraph.updateNode('hakcd-test', 'task-SC01-scene_bg', { status: 'in_progress' });
  assert.equal(r1.status, 'in_progress');
  assert.ok(r1.started_at, 'started_at stamped');
  const r2 = await workGraph.updateNode('hakcd-test', 'task-SC01-scene_bg', {
    status: 'done', output_paths: ['out/SC01_bg.png'],
    attempt: { ok: true, cost_usd: 0.11, note: 'first try' }
  });
  assert.equal(r2.status, 'done');
  assert.ok(r2.finished_at);
  assert.deepEqual(r2.output_paths, ['out/SC01_bg.png']);
  assert.equal(r2.attempt_log.length, 1);
  assert.equal(r2.attempt_log[0].cost_usd, 0.11);
});

test('updateNode rejects bogus status', async () => {
  await assert.rejects(
    workGraph.updateNode('hakcd-test', 'task-SC01-scene_bg', { status: 'banana' }),
    (e) => e.code === 'bad_status'
  );
});

test('updateNode 404s on unknown node', async () => {
  await assert.rejects(
    workGraph.updateNode('hakcd-test', 'task-NOPE-scene_bg', { status: 'done' }),
    (e) => e.code === 'not_found'
  );
});

test('regenerating the graph preserves prior node status', async () => {
  // task-SC01-scene_bg is currently done — regen must keep that, not reset.
  const g = await workGraph.generateGraph('hakcd-test');
  const bg = g.nodes.find((n) => n.id === 'task-SC01-scene_bg');
  assert.equal(bg.status, 'done');
  assert.deepEqual(bg.output_paths, ['out/SC01_bg.png']);
  assert.equal(bg.attempt_log.length, 1);
});

test('rollup totals reflect status mix after updates', async () => {
  const g = await workGraph.getGraph('hakcd-test');
  assert.equal(g.totals.done_count, 1);
  assert.equal(g.totals.pending_count, 3);
});

test.after(async () => {
  try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});
