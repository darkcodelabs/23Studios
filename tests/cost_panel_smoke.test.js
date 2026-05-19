'use strict';

// cost_panel_smoke.test.js — Phase 6 B8 (Cost Panel)
//
// Exercises openrouter_spend in isolation: project resolution via a
// temp PROJECTS_DATA_DIR, record + summarize + cap behavior.
//
// Run: node tests/cost_panel_smoke.test.js

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok ' + msg);
  else { console.error('  FAIL ' + msg); failed++; }
}

async function main() {
  const tmpData = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-b8-data-'));
  const tmpLocal = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-b8-local-'));
  process.env.PROJECTS_DATA_DIR = tmpData;
  // Wipe any global cap env so we can test project-level caps cleanly.
  delete process.env.OPENROUTER_CAP_USD;

  // Bypass auth/CSRF in the underlying projects service by hand-seeding the
  // projects.json file (the registry format we read).
  const projectId = 'b8-smoke';
  const projectsJson = path.join(tmpData, 'projects.json');
  await fsp.mkdir(tmpData, { recursive: true });
  await fsp.writeFile(projectsJson, JSON.stringify({
    projects: [{
      id: projectId,
      name: 'b8 smoke',
      description: '',
      repo: '',
      local_path: tmpLocal,
      platform: 'playdate',
      publisher: '', developer: '',
      build_command: '', preflight_command: '', captures_dir: '',
      created_at: '2026-05-18', status: 'active', game_type: 'sdk'
    }]
  }, null, 2));

  console.log('# openrouter_spend');
  const spend = require('../server/services/openrouter_spend');

  // 1. baseline summary when nothing recorded yet
  let s = await spend.summarize(projectId);
  assert(s.total_spend_usd === 0, 'baseline total is 0');
  assert(s.call_count === 0, 'baseline count is 0');
  assert(s.cap_usd == null, 'baseline cap is null (no env, no project.json)');

  // 2. record a chat call w/ caller-supplied cost
  await spend.recordCall({
    projectId,
    model: 'anthropic/claude-3.5-sonnet',
    stage: 'chat',
    kind: 'chat',
    prompt_tokens: 100,
    completion_tokens: 50,
    total_cost_usd: 0.012
  });
  s = await spend.summarize(projectId);
  assert(Math.abs(s.total_spend_usd - 0.012) < 1e-9, 'total = 0.012 after first call');
  assert(s.call_count === 1, 'count = 1');
  assert(Math.abs((s.by_stage.chat || 0) - 0.012) < 1e-9, 'by_stage.chat = 0.012');
  assert(s.recent_calls.length === 1, 'recent_calls has 1 row');

  // 3. record an image call w/ no cost -> flat fallback applies
  await spend.recordCall({
    projectId,
    model: 'openai/gpt-image-1',
    stage: 'scene',
    scene_id: 'scene-001',
    kind: 'scene'
  });
  s = await spend.summarize(projectId);
  assert(s.call_count === 2, 'count = 2');
  assert(s.by_stage.scene > 0, 'scene stage has a cost from flat fallback');
  assert(Object.keys(s.by_scene).includes('scene-001'), 'scene-001 attributed');

  // 4. cap set + assertCapNotExceeded
  const cap = await spend.setCap(projectId, 1.0);
  assert(cap === 1.0, 'setCap returns 1.0');
  s = await spend.summarize(projectId);
  assert(s.cap_usd === 1.0, 'cap_usd reads back as 1.0');
  assert(s.cap_remaining < 1.0, 'cap_remaining is reduced after calls');
  // shouldn't throw: well below cap
  let threw = false;
  try { await spend.assertCapNotExceeded(projectId); } catch (_e) { threw = true; }
  assert(!threw, 'assertCapNotExceeded does not throw below cap');

  // 5. push past cap -> assertCapNotExceeded throws
  await spend.recordCall({
    projectId,
    model: 'anthropic/claude-3.5-sonnet',
    stage: 'chat',
    total_cost_usd: 5.0
  });
  let capErr = null;
  try { await spend.assertCapNotExceeded(projectId); } catch (e) { capErr = e; }
  assert(capErr && capErr.code === 'cost_cap_exceeded', 'assertCapNotExceeded throws cost_cap_exceeded above cap');

  // 6. unknown stage clamps to "unknown"
  await spend.recordCall({
    projectId,
    model: 'x',
    stage: 'totally-made-up-stage',
    total_cost_usd: 0.001
  });
  s = await spend.summarize(projectId);
  assert(s.by_stage.unknown > 0, 'unknown stage bucket present');

  // 7. malicious cost is clamped to PER_CALL_CAP_USD
  await spend.recordCall({
    projectId,
    model: 'x',
    stage: 'chat',
    total_cost_usd: 9999
  });
  s = await spend.summarize(projectId);
  // 50 (per-call cap) is the most a single call can add.
  const last = s.recent_calls[0];
  assert(last && last.total_cost_usd <= 50.0001, 'per-call cost clamped to PER_CALL_CAP_USD');

  // Cleanup
  await fsp.rm(tmpData, { recursive: true, force: true });
  await fsp.rm(tmpLocal, { recursive: true, force: true });

  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall ok');
}

main().catch((e) => {
  console.error('crash', e);
  process.exit(1);
});
