'use strict';

// decision_log.test.js — Phase 6 C2 backend tests.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Stub the projects service so we don't touch the real registry.
const Module = require('node:module');
const realResolve = Module._resolveFilename;
const fakeProjects = { _store: new Map() };
fakeProjects.getProject = async (id) => fakeProjects._store.get(id) || null;
fakeProjects._set = (id, p) => fakeProjects._store.set(id, p);

require.cache[require.resolve('../services/projects')] = {
  id: require.resolve('../services/projects'),
  filename: require.resolve('../services/projects'),
  loaded: true,
  exports: fakeProjects
};

const decisionLog = require('../services/decision_log');

async function freshProject(idOverride) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dl-test-'));
  await fsp.mkdir(path.join(root, 'sdk_data'), { recursive: true });
  const id = idOverride || `proj-${path.basename(root).slice(-8)}`;
  fakeProjects._set(id, { id, name: id, local_path: root });
  return { id, root };
}

test('logDecision appends a single JSON line with normalized fields', async () => {
  const { id, root } = await freshProject();
  const entry = await decisionLog.logDecision(id, {
    decided_by: 'orchestrator',
    category: 'scope',
    question: 'cut SC18 telco scene?',
    options: ['cut', 'keep', 'defer to v1.1'],
    choice: 'defer to v1.1',
    rationale: 'no anchor + filter-trip risk',
    source_refs: ['canon §10', 'SKILL.md #3']
  });
  assert.strictEqual(entry.decided_by, 'orchestrator');
  assert.strictEqual(entry.category, 'scope');
  assert.strictEqual(entry.choice, 'defer to v1.1');
  assert.deepStrictEqual(entry.options, ['cut', 'keep', 'defer to v1.1']);
  assert.deepStrictEqual(entry.source_refs, ['canon §10', 'SKILL.md #3']);
  assert.strictEqual(entry.graph_node_id, null);
  assert.strictEqual(entry.escalated_from, null);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(entry.ts));

  const file = path.join(root, 'sdk_data', 'decisions.jsonl');
  const contents = await fsp.readFile(file, 'utf8');
  assert.strictEqual(contents.split('\n').filter(Boolean).length, 1);
  const parsed = JSON.parse(contents.trim());
  assert.deepStrictEqual(parsed, entry);
});

test('multiple appends preserve order and produce one line each', async () => {
  const { id, root } = await freshProject();
  for (let i = 0; i < 5; i++) {
    await decisionLog.logDecision(id, {
      decided_by: i % 2 === 0 ? 'orchestrator' : 'agent:bible-reader',
      category: 'prompt-variant',
      question: `q${i}`,
      choice: `c${i}`
    });
  }
  const raw = await fsp.readFile(path.join(root, 'sdk_data', 'decisions.jsonl'), 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 5);
  const parsed = lines.map((l) => JSON.parse(l));
  parsed.forEach((p, i) => {
    assert.strictEqual(p.choice, `c${i}`);
    assert.strictEqual(p.decided_by, i % 2 === 0 ? 'orchestrator' : 'agent:bible-reader');
  });
});

test('readDecisions filters by decided_by + category + time window', async () => {
  const { id } = await freshProject();
  const base = Date.parse('2026-05-01T00:00:00Z');
  await decisionLog.logDecision(id, {
    decided_by: 'orchestrator', category: 'scope',
    question: 'q1', choice: 'c1', ts: new Date(base).toISOString()
  });
  await decisionLog.logDecision(id, {
    decided_by: 'user', category: 'gate-signoff',
    question: 'q2', choice: 'c2', ts: new Date(base + 60_000).toISOString()
  });
  await decisionLog.logDecision(id, {
    decided_by: 'agent:bible-reader', category: 'scope',
    question: 'q3', choice: 'c3', ts: new Date(base + 120_000).toISOString()
  });

  const all = await decisionLog.readDecisions(id);
  assert.strictEqual(all.count, 3);

  const onlyScope = await decisionLog.readDecisions(id, { category: 'scope' });
  assert.strictEqual(onlyScope.count, 2);
  assert.ok(onlyScope.items.every((it) => it.category === 'scope'));

  const onlyUser = await decisionLog.readDecisions(id, { decided_by: 'user' });
  assert.strictEqual(onlyUser.count, 1);
  assert.strictEqual(onlyUser.items[0].question, 'q2');

  const window = await decisionLog.readDecisions(id, {
    from: new Date(base + 30_000).toISOString(),
    to: new Date(base + 90_000).toISOString()
  });
  assert.strictEqual(window.count, 1);
  assert.strictEqual(window.items[0].question, 'q2');
});

test('agent:<name> normalization + validation', async () => {
  const { id } = await freshProject();
  const ok = await decisionLog.logDecision(id, {
    decided_by: 'agent:scene-writer',
    category: 'scene-content',
    question: 'q', choice: 'c'
  });
  assert.strictEqual(ok.decided_by, 'agent:scene-writer');

  await assert.rejects(
    () => decisionLog.logDecision(id, { decided_by: 'agent:', category: 'scope', question: 'q', choice: 'c' }),
    { code: 'bad_decided_by' }
  );
  await assert.rejects(
    () => decisionLog.logDecision(id, { decided_by: 'somebody', category: 'scope', question: 'q', choice: 'c' }),
    { code: 'bad_decided_by' }
  );
  await assert.rejects(
    () => decisionLog.logDecision(id, { decided_by: 'agent:bad name with spaces!', category: 'scope', question: 'q', choice: 'c' }),
    { code: 'bad_decided_by' }
  );
});

test('bad category rejected', async () => {
  const { id } = await freshProject();
  await assert.rejects(
    () => decisionLog.logDecision(id, { decided_by: 'orchestrator', category: 'made-up', question: 'q', choice: 'c' }),
    { code: 'bad_category' }
  );
});

test('missing question or choice rejected', async () => {
  const { id } = await freshProject();
  await assert.rejects(
    () => decisionLog.logDecision(id, { decided_by: 'orchestrator', category: 'scope', choice: 'c' }),
    { code: 'bad_question' }
  );
  await assert.rejects(
    () => decisionLog.logDecision(id, { decided_by: 'orchestrator', category: 'scope', question: 'q' }),
    { code: 'bad_choice' }
  );
});

test('escalated_from validated against decided_by grammar', async () => {
  const { id } = await freshProject();
  const e = await decisionLog.logDecision(id, {
    decided_by: 'user', category: 'gate-signoff',
    question: 'q', choice: 'c',
    escalated_from: 'agent:scene-writer'
  });
  assert.strictEqual(e.escalated_from, 'agent:scene-writer');
  // garbage escalated_from is dropped to null (not a hard reject — non-critical field)
  const e2 = await decisionLog.logDecision(id, {
    decided_by: 'user', category: 'gate-signoff',
    question: 'q', choice: 'c',
    escalated_from: 'garbage value'
  });
  assert.strictEqual(e2.escalated_from, null);
});

test('readDecisions on a missing file returns empty list', async () => {
  const { id } = await freshProject();
  // never logged anything
  const out = await decisionLog.readDecisions(id);
  assert.deepStrictEqual(out, { items: [], count: 0 });
});

test('readDecisions tolerates a corrupt line', async () => {
  const { id, root } = await freshProject();
  await decisionLog.logDecision(id, { decided_by: 'orchestrator', category: 'scope', question: 'q', choice: 'c' });
  await fsp.appendFile(path.join(root, 'sdk_data', 'decisions.jsonl'), '{ this is not valid json\n');
  await decisionLog.logDecision(id, { decided_by: 'user', category: 'scope', question: 'q2', choice: 'c2' });
  const out = await decisionLog.readDecisions(id);
  assert.strictEqual(out.count, 2);
});

test('project without local_path is rejected', async () => {
  const id = 'no-path-proj';
  fakeProjects._set(id, { id, name: id });
  await assert.rejects(
    () => decisionLog.logDecision(id, { decided_by: 'user', category: 'scope', question: 'q', choice: 'c' }),
    { code: 'no_local_path' }
  );
});

test('unknown project is rejected', async () => {
  await assert.rejects(
    () => decisionLog.logDecision('does-not-exist', { decided_by: 'user', category: 'scope', question: 'q', choice: 'c' }),
    { code: 'not_found' }
  );
});
