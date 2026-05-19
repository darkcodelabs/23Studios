'use strict';

// Phase 6 A6 — scope lock unit tests.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a6-scope-'));
process.env.PROJECTS_DATA_DIR = tmpRoot;

const projects = require('../services/projects');
const scopeLock = require('../services/scope_lock');

const PROJECT_DIR = path.join(tmpRoot, 'hakcd_test');
fs.mkdirSync(path.join(PROJECT_DIR, 'sdk_data', 'requirements'), { recursive: true, mode: 0o700 });

async function seedProject() {
  await projects.createProject({
    id: 'hakcd-test', name: 'fixture', description: 'A6 test',
    repo: 'https://example.invalid/r.git', local_path: PROJECT_DIR,
    platform: 'playdate', game_type: 'sdk'
  });
}

async function writeCandidate() {
  // 3 reqs in scope, 2 deferred (from A5).
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'scope_lock_candidate.json'),
    JSON.stringify({
      version: 1, project_id: 'hakcd-test',
      generated_at: new Date().toISOString(),
      based_on_queue_generated_at: new Date().toISOString(),
      proposed_in_scope: ['req-SC01-scene_bg', 'req-SC01-scene_lua', 'req-SC02-scene_bg'],
      proposed_deferred: ['req-SC99-scene_bg', 'req-SC99-scene_lua'],
      notes: 'A5 candidate'
    })
  );
}

async function writeDerived() {
  // Two reqs carry explicit cost; the rest fall back to DEFAULT_REQ_COST_USD.
  await fsp.writeFile(
    path.join(PROJECT_DIR, 'sdk_data', 'requirements', 'derived.json'),
    JSON.stringify({
      requirements: [
        { id: 'req-SC01-scene_bg', kind: 'scene_bg', est_cost_usd: 0.12 },
        { id: 'req-SC01-scene_lua', kind: 'scene_lua' /* no est */ },
        { id: 'req-SC02-scene_bg', kind: 'scene_bg', est_cost_usd: 0.20 },
        { id: 'req-SC99-scene_bg', kind: 'scene_bg' },
        { id: 'req-SC99-scene_lua', kind: 'scene_lua' }
      ]
    })
  );
}

test('proposeScope requires a candidate', async () => {
  await seedProject();
  await assert.rejects(scopeLock.proposeScope('hakcd-test'), (e) => e.code === 'no_candidate');
});

test('proposeScope merges costs from derived.json', async () => {
  await writeCandidate();
  await writeDerived();
  const p = await scopeLock.proposeScope('hakcd-test');
  assert.equal(p.in_scope.length, 3);
  assert.equal(p.deferred.length, 2);
  // 0.12 + 0.08 (fallback) + 0.20 = 0.40
  assert.equal(p.totals.est_cost_in_scope_usd, 0.40);
  // 0.08 + 0.08 = 0.16
  assert.equal(p.totals.est_cost_deferred_usd, 0.16);
});

test('lockScope rejects when not every candidate id is assigned', async () => {
  await assert.rejects(
    scopeLock.lockScope('hakcd-test', {
      include_ids: ['req-SC01-scene_bg'],
      defer_ids: ['req-SC99-scene_bg']
    }),
    (e) => e.code === 'unassigned_ids'
  );
});

test('lockScope rejects unknown id', async () => {
  await assert.rejects(
    scopeLock.lockScope('hakcd-test', {
      include_ids: ['req-NEW-fabricated'],
      defer_ids: ['req-SC01-scene_bg', 'req-SC01-scene_lua', 'req-SC02-scene_bg',
                  'req-SC99-scene_bg', 'req-SC99-scene_lua']
    }),
    (e) => e.code === 'unknown_id'
  );
});

test('lockScope enforces budget_usd', async () => {
  await assert.rejects(
    scopeLock.lockScope('hakcd-test', {
      include_ids: ['req-SC01-scene_bg', 'req-SC01-scene_lua', 'req-SC02-scene_bg'],
      defer_ids: ['req-SC99-scene_bg', 'req-SC99-scene_lua'],
      budget_usd: 0.10  // ceiling below the 0.40 in-scope cost
    }),
    (e) => e.code === 'over_budget'
  );
});

test('lockScope writes v0.1.json and updates latest pointer', async () => {
  const snap = await scopeLock.lockScope('hakcd-test', {
    include_ids: ['req-SC01-scene_bg', 'req-SC01-scene_lua', 'req-SC02-scene_bg'],
    defer_ids: ['req-SC99-scene_bg', 'req-SC99-scene_lua'],
    budget_usd: 1.00,
    notes: 'cut to act 1'
  });
  assert.equal(snap.version, 1);
  assert.equal(snap.file_version, 'v0.1.json');
  assert.equal(snap.totals.in_scope_count, 3);
  assert.equal(snap.totals.deferred_count, 2);
  assert.equal(snap.totals.est_cost_in_scope_usd, 0.40);
  // File on disk + latest pointer
  const fileExists = fs.existsSync(path.join(PROJECT_DIR, 'sdk_data', 'scope', 'v0.1.json'));
  assert.ok(fileExists, 'v0.1.json written');
  const ptr = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'sdk_data', 'scope', 'latest.json'), 'utf8'));
  assert.equal(ptr.version, 1);
});

test('lockScope is immutable — a second lock writes v0.2.json without touching v0.1.json', async () => {
  const before = fs.readFileSync(path.join(PROJECT_DIR, 'sdk_data', 'scope', 'v0.1.json'), 'utf8');
  const snap2 = await scopeLock.lockScope('hakcd-test', {
    include_ids: ['req-SC01-scene_bg'],
    defer_ids: ['req-SC01-scene_lua', 'req-SC02-scene_bg', 'req-SC99-scene_bg', 'req-SC99-scene_lua'],
    budget_usd: 1.00,
    notes: 'narrow to SC01 bg only'
  });
  assert.equal(snap2.version, 2);
  assert.equal(snap2.file_version, 'v0.2.json');
  const after = fs.readFileSync(path.join(PROJECT_DIR, 'sdk_data', 'scope', 'v0.1.json'), 'utf8');
  assert.equal(before, after, 'v0.1.json untouched');
  // latest pointer now points to v0.2
  const ptr = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'sdk_data', 'scope', 'latest.json'), 'utf8'));
  assert.equal(ptr.version, 2);
});

test('getScope(null) returns latest; getScope(N) returns version N', async () => {
  const latest = await scopeLock.getScope('hakcd-test', null);
  assert.equal(latest.version, 2);
  const v1 = await scopeLock.getScope('hakcd-test', 1);
  assert.equal(v1.version, 1);
});

test('listScopes returns history sorted by version', async () => {
  const list = await scopeLock.listScopes('hakcd-test');
  assert.equal(list.length, 2);
  assert.equal(list[0].version, 1);
  assert.equal(list[1].version, 2);
});

test.after(async () => {
  try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
});
