'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

// Quarantine the projects datastore so this test never touches the
// real server/data directory.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'approvals-test-'));
process.env.PROJECTS_DATA_DIR = TMP;

const projects = require('../services/projects');
const approvals = require('../services/approvals');

(async () => {
  // Set up a fake project + local_path.
  const localPath = path.join(TMP, 'proj-local');
  await fsp.mkdir(path.join(localPath, '.git'), { recursive: true });
  await fsp.mkdir(path.join(localPath, 'sdk_data', 'approvals'), { recursive: true });
  await fsp.mkdir(path.join(localPath, 'sdk_data', 'images'), { recursive: true });

  const projectId = 'approval-smoke';
  await projects.createProject({
    id: projectId,
    name: 'Approval Smoke',
    description: 'tmp',
    repo: 'https://github.com/local/scratch.git',
    local_path: localPath,
    platform: 'playdate',
    publisher: '23',
    developer: '23',
    build_command: '',
    preflight_command: '',
    captures_dir: '',
    status: 'active',
    game_type: 'sdk'
  });

  // Seed queue.json directly (this is what the image-gen pipeline writes).
  const queuePath = path.join(localPath, 'sdk_data', 'approvals', 'queue.json');
  await fsp.writeFile(queuePath, JSON.stringify({
    cost_so_far: 1.23,
    items: [
      {
        id: 'asset-a',
        scene_id: 'scene-01',
        prompt_sent: 'A misty seaside village at dawn, 1-bit pixel art',
        image_path: 'sdk_data/images/scene-01.png',
        anchor_path: 'sdk_data/images/anchor-01.png',
        canon_section_cited: '§4',
        skill_rule_results: [{ rule: 1, pass: true, label: 'load-once import OK' }],
        drift_score: 0.18,
        status: 'pending',
        cost_usd: 0.05
      },
      {
        id: 'asset-b',
        scene_id: 'scene-02',
        prompt_sent: 'Lava cavern',
        image_path: 'sdk_data/images/scene-02.png',
        anchor_path: null,
        canon_section_cited: '§12',
        skill_rule_results: [],
        drift_score: 0.62,
        status: 'pending',
        cost_usd: 0.05
      }
    ]
  }, null, 2));

  // GET queue
  const q = await approvals.getQueue(projectId);
  assert.strictEqual(q.queue.length, 2, 'queue length');
  assert.strictEqual(q.pending_count, 2, 'pending count');
  assert.strictEqual(q.cost_so_far, 1.23, 'cost passes through');
  assert.ok(q.queue[0].image_url.includes('/api/projects/approval-smoke/file/raw'),
    'image_url is file/raw shaped');
  assert.ok(q.queue[0].image_url.includes('sdk_data/images/scene-01.png'),
    'image_url retains the relative path');

  // Reject unknown decision
  let threw = false;
  try { await approvals.decide(projectId, 'asset-a', 'nuke'); } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 400);
  }
  assert.ok(threw, 'unknown decision rejected');

  // Approve asset-a
  const decided = await approvals.decide(projectId, 'asset-a', 'approve');
  assert.strictEqual(decided.status, 'approve');
  assert.ok(decided.decided_at, 'decided_at populated');

  // Re-read; should now show 1 pending, 1 decided
  const q2 = await approvals.getQueue(projectId);
  assert.strictEqual(q2.pending_count, 1, 'one pending after approval');
  assert.strictEqual(q2.decided_count, 1, 'one decided after approval');

  // Defer asset-b should leave it pending (per spec).
  await approvals.decide(projectId, 'asset-b', 'defer');
  const q3 = await approvals.getQueue(projectId);
  assert.strictEqual(q3.pending_count, 1, 'deferred still pending');

  // 404 path
  let nf = false;
  try { await approvals.decide(projectId, 'does-not-exist', 'approve'); }
  catch (e) { nf = true; assert.strictEqual(e.status, 404); }
  assert.ok(nf, '404 on unknown asset id');

  // 404 project
  let np = false;
  try { await approvals.getQueue('nope-no-such'); }
  catch (e) { np = true; assert.strictEqual(e.status, 404); }
  assert.ok(np, '404 on unknown project');

  // Clean up the tmpdir.
  await fsp.rm(TMP, { recursive: true, force: true });
  console.log('approvals smoke OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
