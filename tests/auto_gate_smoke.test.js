'use strict';

// Smoke test for sdk_auto_gate.autoSignIfGreen — verifies the rule-driven
// canonical gate signoff with stubbed signals on disk.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-gate-'));
const PROJECT_ID = 'p1';

const projectsStubPath = path.join(__dirname, '..', 'server', 'services', 'projects.js');
require.cache[require.resolve(projectsStubPath)] = {
  id: projectsStubPath, filename: projectsStubPath, loaded: true,
  exports: { getProject: async (id) => id === PROJECT_ID
    ? { id, local_path: tmpRoot } : null }
};

const gates = require('../server/services/gates');
const autoGate = require('../server/services/sdk_auto_gate');

async function writeSignal(rel, data) {
  const fp = path.join(tmpRoot, 'sdk_data', rel);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.writeFile(fp, JSON.stringify(data, null, 2));
}

test('autoSignIfGreen seeds gates and signs none when no signals exist', async () => {
  const r = await autoGate.autoSignIfGreen(PROJECT_ID);
  assert.equal(r.signed.length, 0);
  // 4 default-mode rules skipped (signal_not_green) + 2 fullAuto-only skipped
  assert.ok(r.skipped.length >= 4);
});

test('signs visual_identity when perf clean + validator green', async () => {
  await writeSignal('perf_audit.json', {
    summary: { errors: 0, warnings: 0 },
    fixes: [{ severity: 'warn', item: 'a.lua', recommendation: 'trim imports' }]
  });
  await writeSignal('design_validation.json', {
    ok: true, summary: { passed: 6, warned: 0, failed: 0 },
    checks: [
      { id: 'puzzle_solvable', severity: 'pass' },
      { id: 'endings_reachable', severity: 'pass' }
    ]
  });
  const r = await autoGate.autoSignIfGreen(PROJECT_ID);
  assert.ok(r.signed.includes('visual_identity'),
    'visual_identity should sign with perf clean + validator green');
  // puzzle_sanity also clears because validator has both checks green
  assert.ok(r.signed.includes('puzzle_sanity'));
});

test('signs first_playable when m04 booted + smoketest ok', async () => {
  await writeSignal('milestones/m04_inventory/status.json', {
    milestone: 'm04_inventory', boots: true,
    smoketest: { ok: true, booted: true, errors: [] }
  });
  const r = await autoGate.autoSignIfGreen(PROJECT_ID);
  assert.ok(r.signed.includes('first_playable'));
});

test('signs difficulty when m07 booted', async () => {
  await writeSignal('milestones/m07_full_game/status.json', {
    milestone: 'm07_full_game', boots: true,
    smoketest: { ok: true, booted: true, errors: [] }
  });
  const r = await autoGate.autoSignIfGreen(PROJECT_ID);
  assert.ok(r.signed.includes('difficulty'));
});

test('does NOT sign core_mechanic or vibe_check in default mode', async () => {
  await writeSignal('qa_critic.json', { recommendation: 'ship',
                                        aggregate: { avg_score: 9 } });
  // Reset gates so we can verify a fresh run
  await fsp.rm(path.join(tmpRoot, 'sdk_data', 'gates'), { recursive: true, force: true });
  delete process.env.STUDIO_AUTO_SIGN_GATES;
  const r = await autoGate.autoSignIfGreen(PROJECT_ID);
  assert.ok(!r.signed.includes('core_mechanic'),
    'core_mechanic must not auto-sign in default mode');
  assert.ok(!r.signed.includes('vibe_check'),
    'vibe_check must not auto-sign in default mode');
});

test('signs ALL 6 in full-auto mode when signals green', async () => {
  await fsp.rm(path.join(tmpRoot, 'sdk_data', 'gates'), { recursive: true, force: true });
  process.env.STUDIO_AUTO_SIGN_GATES = '1';
  try {
    const r = await autoGate.autoSignIfGreen(PROJECT_ID);
    for (const id of ['visual_identity', 'first_playable', 'puzzle_sanity',
                      'difficulty', 'core_mechanic', 'vibe_check']) {
      assert.ok(r.signed.includes(id), `${id} should sign in full-auto`);
    }
  } finally {
    delete process.env.STUDIO_AUTO_SIGN_GATES;
  }
});

test('blocking() returns null for every target after full-auto signoff', async () => {
  process.env.STUDIO_AUTO_SIGN_GATES = '1';
  try {
    await autoGate.autoSignIfGreen(PROJECT_ID);
    for (const target of ['milestone_m04', 'milestone_m06',
                          'release_candidate', 'release']) {
      const b = await gates.blocking(PROJECT_ID, target);
      assert.equal(b, null, `${target} should be clear after full-auto signoff`);
    }
  } finally {
    delete process.env.STUDIO_AUTO_SIGN_GATES;
  }
});
