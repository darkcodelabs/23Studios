'use strict';

// ship_preflight_smoke.test.js — Phase 6 B11
//
// Stands up a tmp project with no scenes/no drift/no approvals so preflight
// returns ok=true with three pass/skip events. Then writes a failing scene
// (setRefreshRate(50)) and asserts preflight ok=false.
//
// Run: node tests/ship_preflight_smoke.test.js

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');

let failed = 0;
function assert(c, m) { if (c) console.log('  ok ' + m); else { console.error('  FAIL ' + m); failed++; } }

async function main() {
  const tmpData = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-b11-data-'));
  const tmpLocal = await fsp.mkdtemp(path.join(os.tmpdir(), '23studios-b11-local-'));
  process.env.PROJECTS_DATA_DIR = tmpData;

  const projectId = 'b11-smoke';
  await fsp.writeFile(path.join(tmpData, 'projects.json'), JSON.stringify({
    projects: [{
      id: projectId, name: 'b11', description: '', repo: '',
      local_path: tmpLocal, platform: 'playdate',
      publisher: '', developer: '',
      build_command: '', preflight_command: '', captures_dir: '',
      created_at: '2026-05-18', status: 'active', game_type: 'sdk'
    }]
  }, null, 2));

  const shipSvc = require('../server/services/ship');

  console.log('# empty project — preflight passes');
  let r = await shipSvc.preflight(projectId);
  assert(r.ok === true, `preflight ok=true (got ${r.ok})`);
  assert(Array.isArray(r.checks), 'checks is an array');
  const lintEvent = r.checks.find((c) => c.step === 'lint' && c.status !== 'running');
  assert(lintEvent && (lintEvent.status === 'pass' || lintEvent.status === 'skip'), 'lint pass/skip');
  const driftEvent = r.checks.find((c) => c.step === 'drift' && c.status !== 'running');
  assert(driftEvent && driftEvent.status === 'pass', 'drift pass');
  const apEvent = r.checks.find((c) => c.step === 'approvals' && c.status !== 'running');
  assert(apEvent && apEvent.status === 'pass', 'approvals pass');

  console.log('# bad scene_lua — preflight fails');
  await fsp.mkdir(path.join(tmpLocal, 'sdk_data'), { recursive: true });
  await fsp.writeFile(path.join(tmpLocal, 'sdk_data', 'project.json'), JSON.stringify({
    scenes: [{ id: 'sc1', name: 'sc1', lua: 'playdate.display.setRefreshRate(50)\nfunction playdate.update() end' }]
  }));
  r = await shipSvc.preflight(projectId);
  assert(r.ok === false, `bad lua makes preflight ok=false (got ${r.ok})`);
  assert(r.lint && r.lint.errors > 0, `lint reports errors (${r.lint.errors})`);

  console.log('# pending approvals — preflight fails');
  await fsp.writeFile(path.join(tmpLocal, 'sdk_data', 'approvals_queue.json'), JSON.stringify({
    items: [{ id: 'a1', status: 'pending' }, { id: 'a2', status: 'approved' }]
  }));
  // First fix lint so approvals failure is the only blocker.
  await fsp.writeFile(path.join(tmpLocal, 'sdk_data', 'project.json'), JSON.stringify({
    scenes: [{ id: 'sc1', name: 'sc1', lua:
      'playdate.display.setRefreshRate(30)\nfunction playdate.update() end\nplaydate.timer.updateTimers()' }]
  }));
  r = await shipSvc.preflight(projectId);
  assert(r.approvals && r.approvals.pending === 1, `1 pending approval (got ${r.approvals.pending})`);
  assert(r.ok === false, 'preflight ok=false when approvals pending');

  await fsp.rm(tmpData, { recursive: true, force: true });
  await fsp.rm(tmpLocal, { recursive: true, force: true });

  if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log('\nall ok');
}

main().catch((e) => { console.error('crash', e); process.exit(1); });
