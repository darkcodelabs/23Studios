'use strict';

// Smoke test for the 6 canonical gate seed + blocking helper.
// Stubs the projects service to point at a temp dir so we can exercise
// the file I/O end-to-end without a real project record.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Inject a stub projects module into require cache BEFORE gates is required.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-smoke-'));
const projectsStubPath = path.join(__dirname, '..', 'server', 'services', 'projects.js');
require.cache[require.resolve(projectsStubPath)] = {
  id: projectsStubPath,
  filename: projectsStubPath,
  loaded: true,
  exports: {
    getProject: async (id) => {
      if (id === 'p1') return { id, local_path: tmpRoot };
      return null;
    }
  }
};

const gates = require('../server/services/gates');

test('CANONICAL_GATES exports the 6 named gates with blocks', () => {
  assert.equal(gates.CANONICAL_GATES.length, 6);
  const ids = gates.CANONICAL_GATES.map((g) => g.id).sort();
  assert.deepEqual(ids, [
    'core_mechanic', 'difficulty', 'first_playable',
    'puzzle_sanity', 'vibe_check', 'visual_identity'
  ]);
  for (const g of gates.CANONICAL_GATES) {
    assert.ok(g.id && g.name && g.phase != null && Array.isArray(g.blocks));
  }
});

test('seedCanonicalGates writes 6 files and is idempotent', async () => {
  await gates.seedCanonicalGates('p1', tmpRoot);
  const dir = path.join(tmpRoot, 'sdk_data', 'gates');
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  assert.equal(files.length, 6);

  // Mutate one to confirm a second seed call doesn't overwrite.
  const fp = path.join(dir, 'core_mechanic.json');
  const before = JSON.parse(await fsp.readFile(fp, 'utf8'));
  before.notes = 'KEEP ME';
  await fsp.writeFile(fp, JSON.stringify(before, null, 2));

  await gates.seedCanonicalGates('p1', tmpRoot);
  const after = JSON.parse(await fsp.readFile(fp, 'utf8'));
  assert.equal(after.notes, 'KEEP ME');
});

test('readCanonicalGates returns 6 records with status=pending after seed', async () => {
  const list = await gates.readCanonicalGates(tmpRoot);
  assert.equal(list.length, 6);
  for (const g of list) assert.equal(g.status, 'pending');
});

test('blocking returns the matching gate for a target when pending', async () => {
  const g = await gates.blocking('p1', 'milestone_m04');
  assert.ok(g, 'expected blocking gate');
  assert.equal(g.id, 'first_playable');
});

test('blocking returns null after sign-off', async () => {
  await gates.signOffCanonical({ projectId: 'p1', gateId: 'first_playable',
    notes: 'looks good', signedOffBy: 'cory' });
  const g = await gates.blocking('p1', 'milestone_m04');
  assert.equal(g, null);
});

test('blocking covers m06/release_candidate/release targets', async () => {
  const m06 = await gates.blocking('p1', 'milestone_m06');
  assert.equal(m06 && m06.id, 'puzzle_sanity');
  const rc = await gates.blocking('p1', 'release_candidate');
  assert.equal(rc && rc.id, 'difficulty');
  const rel = await gates.blocking('p1', 'release');
  assert.equal(rel && rel.id, 'vibe_check');
});
