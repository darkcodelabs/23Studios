'use strict';

// Phase 6 B3 — approvals service tests.
//
// Drives the full queue lifecycle inside an isolated PROJECTS_DATA_DIR so we
// never mutate real project state. Covers:
//   - reading an empty queue
//   - reading + sanitizing a seeded queue, with skill_pass aggregation
//   - applying each decision verb (approve / reject / reroll_* / fallback / defer)
//   - audit-log mirror into the C2 decision log
//   - invalid input rejection

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

// Point projects.js at a throwaway data dir BEFORE requiring it.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approvals-data-'));
process.env.PROJECTS_DATA_DIR = tmpDataDir;

const projects = require('../services/projects');
const approvals = require('../services/approvals');
const decisionLog = require('../services/decision_log');

let projectLocal;
let projectId = 'apv-test';

test.before(async () => {
  // Real git repo for validateLocalPath, but only used by registry sanity.
  projectLocal = await fsp.mkdtemp(path.join(os.tmpdir(), 'apv-proj-'));
  await fsp.mkdir(path.join(projectLocal, '.git'), { recursive: true });

  // Register directly via the JSON store. We bypass createProject so we don't
  // need a real repo URL; the approvals service only consumes local_path.
  const file = path.join(tmpDataDir, 'projects.json');
  await fsp.writeFile(file, JSON.stringify({
    projects: [{
      id: projectId,
      name: 'Approvals Test',
      description: '',
      repo: 'https://github.com/example/example.git',
      local_path: projectLocal,
      platform: 'playdate',
      created_at: new Date().toISOString(),
      status: 'active',
      game_type: 'sdk'
    }]
  }, null, 2));
});

test.after(async () => {
  await fsp.rm(tmpDataDir, { recursive: true, force: true });
  await fsp.rm(projectLocal, { recursive: true, force: true });
});

async function seedQueue(items) {
  await approvals._internals._seedQueue(projectLocal, items);
}

async function readArchive() {
  const p = path.join(projectLocal, 'sdk_data', 'approvals', 'archive.jsonl');
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

async function clearArtifacts() {
  await fsp.rm(path.join(projectLocal, 'sdk_data'), { recursive: true, force: true });
}

test('readQueue returns empty for fresh project', async () => {
  await clearArtifacts();
  const q = await approvals.readQueue(projectId);
  assert.deepStrictEqual(q.items, []);
  assert.strictEqual(q.count, 0);
  assert.strictEqual(q.total_cost_usd, 0);
});

test('readQueue sanitizes items and computes skill_pass + total_cost', async () => {
  await clearArtifacts();
  await seedQueue([
    {
      asset_id: 'scene_sc01_bg',
      kind: 'scene',
      scene_id: 'sc01',
      prompt_text: 'A dark forest, 1-bit dither.',
      generated_path: 'sdk_data/scenes/sc01.png',
      anchor_path: 'refs/forest.png',
      canon_sections: ['§3'],
      skill_rule_checks: [
        { rule: '#1', label: '1-bit palette', pass: true },
        { rule: '#4', label: 'tile >= 16x16', pass: false, note: 'found 12x12' }
      ],
      cost_usd: 0.012,
      queued_at: '2026-05-18T12:00:00Z'
    },
    {
      asset_id: 'scene_sc02_bg',
      kind: 'scene',
      scene_id: 'sc02',
      prompt_text: 'A clearing.',
      generated_path: 'sdk_data/scenes/sc02.png',
      skill_rule_checks: [
        { rule: '#1', label: '1-bit palette', pass: true }
      ],
      cost_usd: 0.008,
      queued_at: '2026-05-18T13:00:00Z'
    }
  ]);
  const q = await approvals.readQueue(projectId);
  assert.strictEqual(q.count, 2);
  assert.strictEqual(q.total_cost_usd, 0.02);
  // Failed skill check floats sc01 to top.
  assert.strictEqual(q.items[0].asset_id, 'scene_sc01_bg');
  assert.strictEqual(q.items[0].skill_pass, false);
  assert.strictEqual(q.items[0].skill_failed_count, 1);
  assert.strictEqual(q.items[1].asset_id, 'scene_sc02_bg');
  assert.strictEqual(q.items[1].skill_pass, true);
  assert.strictEqual(q.items[0].drift_verdict.flagged, false);
});

test('decide approve removes from queue, archives, and logs to C2', async () => {
  await clearArtifacts();
  await seedQueue([
    { asset_id: 'a1', scene_id: 'sc01', prompt_text: 'p1', generated_path: 'sdk_data/scenes/sc01.png',
      canon_sections: ['§3'], skill_rule_checks: [], cost_usd: 0.01, queued_at: '2026-05-18T12:00:00Z' },
    { asset_id: 'a2', scene_id: 'sc02', prompt_text: 'p2', cost_usd: 0.01, queued_at: '2026-05-18T13:00:00Z' }
  ]);
  const r = await approvals.decide(projectId, 'a1', {
    decision: 'approve', decided_by: 'user', reason: 'looks right'
  });
  assert.strictEqual(r.decision, 'approve');
  assert.strictEqual(r.removed_from_queue, true);

  const q = await approvals.readQueue(projectId);
  assert.strictEqual(q.count, 1);
  assert.strictEqual(q.items[0].asset_id, 'a2');

  const arch = await readArchive();
  assert.strictEqual(arch.length, 1);
  assert.strictEqual(arch[0].asset_id, 'a1');
  assert.strictEqual(arch[0].decision, 'approve');
  assert.strictEqual(arch[0].reason, 'looks right');

  // C2 decision log should reflect it.
  const dlog = await decisionLog.readDecisions(projectId, {});
  const match = dlog.items.find((d) => d.choice === 'approve' && d.question.includes('a1'));
  assert.ok(match, 'expected an approve entry for a1 in decision log');
  assert.strictEqual(match.graph_node_id, 'sc01');
  assert.ok(match.source_refs.includes('canon:§3'));
});

test('decide defer leaves item in queue, bumps attempts, moves to tail', async () => {
  await clearArtifacts();
  await seedQueue([
    { asset_id: 'a1', prompt_text: 'p1', queued_at: '2026-05-18T12:00:00Z', attempts: 1 },
    { asset_id: 'a2', prompt_text: 'p2', queued_at: '2026-05-18T13:00:00Z', attempts: 1 }
  ]);
  const r = await approvals.decide(projectId, 'a1', { decision: 'defer', reason: 'come back later' });
  assert.strictEqual(r.removed_from_queue, false);

  // Read raw queue (sanitizer sorts by drift/skill which both items lack, then by queued_at,
  // so we hit disk directly to confirm tail-order).
  const rawPath = path.join(projectLocal, 'sdk_data', 'approvals', 'queue.json');
  const raw = JSON.parse(await fsp.readFile(rawPath, 'utf8'));
  assert.strictEqual(raw.items.length, 2);
  assert.strictEqual(raw.items[0].asset_id, 'a2');
  assert.strictEqual(raw.items[1].asset_id, 'a1');
  assert.strictEqual(raw.items[1].attempts, 2);
  assert.ok(raw.items[1].last_deferred_at);

  // Archive should still be empty (defer doesn't archive).
  const arch = await readArchive();
  assert.strictEqual(arch.length, 0);
});

test('decide reroll_same / reroll_variant / fallback_safe / reject all remove + archive', async () => {
  for (const verb of ['reroll_same', 'reroll_variant', 'fallback_safe', 'reject']) {
    await clearArtifacts();
    await seedQueue([{ asset_id: `a-${verb}`, prompt_text: 'p', queued_at: '2026-05-18T12:00:00Z' }]);
    const r = await approvals.decide(projectId, `a-${verb}`, { decision: verb, reason: `because ${verb}` });
    assert.strictEqual(r.decision, verb, `${verb} not echoed`);
    assert.strictEqual(r.removed_from_queue, true, `${verb} should remove from queue`);
    const q = await approvals.readQueue(projectId);
    assert.strictEqual(q.count, 0, `${verb} queue not empty after decide`);
    const arch = await readArchive();
    const found = arch.find((x) => x.asset_id === `a-${verb}`);
    assert.ok(found, `${verb} not in archive`);
    assert.strictEqual(found.decision, verb);
  }
});

test('decide rejects unknown decision verb', async () => {
  await clearArtifacts();
  await seedQueue([{ asset_id: 'a1', prompt_text: 'p' }]);
  await assert.rejects(
    () => approvals.decide(projectId, 'a1', { decision: 'thumbs_up' }),
    /decision must be one of/
  );
});

test('decide returns 404 for unknown asset_id', async () => {
  await clearArtifacts();
  await seedQueue([{ asset_id: 'a1', prompt_text: 'p' }]);
  await assert.rejects(
    () => approvals.decide(projectId, 'missing', { decision: 'approve' }),
    /asset not in queue/
  );
});

test('sanitizeItem drops items without asset_id', () => {
  const { sanitizeItem } = approvals._internals;
  assert.strictEqual(sanitizeItem(null), null);
  assert.strictEqual(sanitizeItem({}), null);
  assert.strictEqual(sanitizeItem({ asset_id: 'x' }).asset_id, 'x');
});

test('validateDecision returns null for valid verbs', () => {
  const { validateDecision } = approvals._internals;
  for (const v of approvals.DECISIONS) {
    assert.strictEqual(validateDecision(v), null);
  }
  assert.match(validateDecision('nope'), /decision must be one of/);
  assert.match(validateDecision(null),  /decision must be string/);
});
