'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const bible = require('../server/services/sdk_bible');
const template = require('../server/services/story_bible_template');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-'));

test('seedSections emits 10 canonical sections with NN_ prefix', () => {
  const ss = template.seedSections({ description: 'test pitch' });
  assert.equal(ss.length, 10);
  for (const s of ss) {
    assert.ok(/^\d{2}_/.test(s.filename), s.filename);
    assert.ok(s.content.startsWith('# '));
  }
});

test('writeSeed creates section files on disk + is idempotent', async () => {
  const r1 = await template.writeSeed(tmp, { description: 'phreak adventure' });
  assert.equal(r1.written.length, 10);
  // Edit one section then re-seed; edit must survive
  const editTarget = path.join(tmp, 'sdk_data', 'bible', '00_premise.md');
  await fsp.writeFile(editTarget, '# Premise\n\nUSER EDITED\n');
  const r2 = await template.writeSeed(tmp, { description: 'overwritten?' });
  assert.equal(r2.written.length, 0, 're-seed must not overwrite existing files');
  const after = await fsp.readFile(editTarget, 'utf8');
  assert.ok(after.includes('USER EDITED'));
});

test('list returns all sections sorted by filename', async () => {
  const list = await bible.list(tmp);
  assert.equal(list.length, 10);
  const ids = list.map((s) => s.filename);
  assert.deepEqual([...ids], [...ids].sort());
  // Title parsed from first H1
  assert.ok(list[0].title);
});

test('write rejects bad filenames + over-large content', async () => {
  await assert.rejects(() => bible.write(tmp, '../escape.md', 'x'), /invalid_filename/);
  await assert.rejects(() => bible.write(tmp, 'Has Spaces.md', 'x'), /invalid_filename/);
  await assert.rejects(() => bible.write(tmp, 'ok.md', 'x'.repeat(300 * 1024)),
                       /section_too_large/);
});

test('write + compile produce concatenated story_bible.md', async () => {
  await bible.write(tmp, 'custom_cast_ghost.md', '# Ghost\n\nWails in dial tone.\n');
  const compiled = await bible.compile(tmp);
  assert.ok(compiled.path.endsWith('story_bible.md'));
  assert.ok(compiled.sections >= 11);
  const raw = await fsp.readFile(compiled.path, 'utf8');
  assert.ok(raw.includes('USER EDITED'));
  assert.ok(raw.includes('Ghost'));
  // Section separator present between blocks
  assert.ok(raw.includes('\n\n---\n\n'));
});

test('remove deletes section, recompile drops it from story_bible.md', async () => {
  const ok = await bible.remove(tmp, 'custom_cast_ghost.md');
  assert.equal(ok, true);
  const c = await bible.compile(tmp);
  const raw = await fsp.readFile(c.path, 'utf8');
  assert.ok(!raw.includes('Wails in dial tone'));
});
