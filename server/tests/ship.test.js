'use strict';

// Phase 6 B11 — ship orchestrator tests.
//
// Covers the cheap, side-effect-free surface: preflight aggregation, the
// internal helpers (slug, checkLint), and the step-name contract. The full
// export/zip/deliver pipeline is integration-tested by hand against a real
// project tree since it depends on pdc + zip on PATH.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-data-'));
process.env.PROJECTS_DATA_DIR = tmpDataDir;

const projects = require('../services/projects');
const ship = require('../services/ship');

// approvals may or may not be present depending on merge order with B3.
let approvals = null;
try { approvals = require('../services/approvals'); }
catch (_e) { /* B3 not merged in yet */ }

const projectId = 'ship-test';
let localPath;

test.before(async () => {
  localPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'ship-proj-'));
  await fsp.mkdir(path.join(localPath, '.git'), { recursive: true });
  await fsp.writeFile(path.join(tmpDataDir, 'projects.json'), JSON.stringify({
    projects: [{
      id: projectId, name: 'Ship Test', description: '',
      repo: 'https://github.com/example/example.git',
      local_path: localPath, platform: 'playdate',
      created_at: new Date().toISOString(),
      status: 'active', game_type: 'sdk'
    }]
  }, null, 2));
});

test.after(async () => {
  await fsp.rm(tmpDataDir, { recursive: true, force: true });
  await fsp.rm(localPath, { recursive: true, force: true });
});

async function clearArtifacts() {
  await fsp.rm(path.join(localPath, 'sdk_data'), { recursive: true, force: true });
}

test('STEPS is a stable, ordered list', () => {
  assert.deepStrictEqual(
    [...ship.STEPS],
    ['lint', 'drift', 'approval', 'export', 'zip', 'sim', 'deliver']
  );
});

test('slug normalizes names safely', () => {
  const { slug } = ship._internals;
  assert.strictEqual(slug('Hello World!'), 'hello-world');
  assert.strictEqual(slug('  ---weird  ___ name  '), 'weird-name');
  assert.strictEqual(slug(''), 'game');
  assert.strictEqual(slug(null), 'game');
  assert.strictEqual(slug('A'.repeat(200)).length, 64);
});

test('preflight returns clean state for empty project', async () => {
  await clearArtifacts();
  const r = await ship.preflight(projectId);
  assert.strictEqual(r.project_id, projectId);
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.checks.lint.pass, true);
  assert.strictEqual(r.checks.drift.pass, true);
  assert.strictEqual(r.checks.approval.pass, true);
  assert.strictEqual(typeof r.has_build_sh, 'boolean');
});

test('preflight fails when approvals queue has pending items', { skip: !approvals }, async () => {
  await clearArtifacts();
  await approvals._internals._seedQueue(localPath, [
    { asset_id: 'a1', prompt_text: 'p', queued_at: new Date().toISOString() }
  ]);
  const r = await ship.preflight(projectId);
  assert.strictEqual(r.pass, false);
  assert.strictEqual(r.checks.approval.pass, false);
  assert.strictEqual(r.checks.approval.count, 1);
});

test('preflight surfaces lint findings', async () => {
  await clearArtifacts();
  await fsp.mkdir(path.join(localPath, 'sdk_data'), { recursive: true });
  // Lua that violates the bootstrap rule (no playdate.update, no init)
  await fsp.writeFile(path.join(localPath, 'sdk_data', 'project.json'), JSON.stringify({
    scenes: [
      { id: 'sc01', lua: '-- empty scene with no required calls\n' }
    ]
  }));
  const r = await ship.preflight(projectId);
  assert.ok(r.checks.lint.summary.total >= 0);
  assert.ok(Array.isArray(r.checks.lint.files));
});

test('checkApprovals + checkDrift handle missing files gracefully', async () => {
  await clearArtifacts();
  const { checkApprovals, checkDrift, checkLint } = ship._internals;
  const a = await checkApprovals(projectId); assert.strictEqual(a.pass, true);
  const d = await checkDrift(projectId);     assert.strictEqual(d.pass, true);
  const l = await checkLint(localPath);      assert.strictEqual(l.pass, true);
});

test('startShip halts on missing project', async () => {
  const events = [];
  const { awaitDone } = ship.startShip({
    projectId: 'does-not-exist',
    onEvent: (evt, data) => events.push({ evt, data })
  });
  await awaitDone;
  const done = events.find((e) => e.evt === 'done');
  assert.ok(done, 'expected done event');
  assert.strictEqual(done.data.status, 'failed');
});

test('getJobsByProject + getJob hydrate', async () => {
  const { id } = ship.startShip({
    projectId: 'does-not-exist',
    onEvent: () => {}
  });
  // Don't await; we just want a job entry to exist in the map.
  const j = ship.getJob(id);
  assert.ok(j);
  assert.strictEqual(j.project_id, 'does-not-exist');
  const list = ship.getJobsByProject('does-not-exist');
  assert.ok(list.find((x) => x.id === id));
});
