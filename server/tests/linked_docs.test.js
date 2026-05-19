'use strict';

// Phase 6 B12 — linked_docs service tests.
//
// Covers doc aggregation across the three source layouts, section parsing
// for the right-rail section list, note pin/read/delete lifecycle, and
// input validation.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldocs-data-'));
process.env.PROJECTS_DATA_DIR = tmpDataDir;

const projects = require('../services/projects');
const linkedDocs = require('../services/linked_docs');

let projectLocal;
const projectId = 'ldoc-test';

test.before(async () => {
  projectLocal = await fsp.mkdtemp(path.join(os.tmpdir(), 'ldoc-proj-'));
  await fsp.mkdir(path.join(projectLocal, '.git'), { recursive: true });
  await fsp.writeFile(path.join(tmpDataDir, 'projects.json'), JSON.stringify({
    projects: [{
      id: projectId, name: 'LinkedDocs Test', description: '',
      repo: 'https://github.com/example/example.git',
      local_path: projectLocal, platform: 'playdate',
      created_at: new Date().toISOString(),
      status: 'active', game_type: 'sdk'
    }]
  }, null, 2));
});

test.after(async () => {
  await fsp.rm(tmpDataDir, { recursive: true, force: true });
  await fsp.rm(projectLocal, { recursive: true, force: true });
});

async function clearArtifacts() {
  await fsp.rm(path.join(projectLocal, 'sdk_data'), { recursive: true, force: true });
}

async function writeFile(rel, body) {
  const full = path.join(projectLocal, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, body);
}

test('readDocs returns empty docs when nothing uploaded', async () => {
  await clearArtifacts();
  const r = await linkedDocs.readDocs(projectId);
  assert.strictEqual(r.bible.present, false);
  assert.strictEqual(r.canon.present, false);
  assert.strictEqual(r.skill.present, false);
  assert.strictEqual(r.bible.content, '');
  assert.deepStrictEqual(r.bible.sections, []);
});

test('readDocs prefers intake bible.md over rendered story_bible.md', async () => {
  await clearArtifacts();
  await writeFile('sdk_data/source/bible.md',  '# Intake Bible\n\n## Setting\n\nA forest.\n');
  await writeFile('sdk_data/story_bible.md',   '# Rendered Bible\n');
  const r = await linkedDocs.readDocs(projectId);
  assert.strictEqual(r.bible.present, true);
  assert.strictEqual(r.bible.source, 'source/bible.md');
  assert.ok(r.bible.content.includes('Intake Bible'));
  assert.strictEqual(r.bible.sections[0].title, 'Intake Bible');
  assert.strictEqual(r.bible.sections[1].title, 'Setting');
});

test('readDocs falls back to rendered story_bible.md when intake bible absent', async () => {
  await clearArtifacts();
  await writeFile('sdk_data/story_bible.md', '# Rendered\n## §1 Pitch\n\nA pitch.\n');
  const r = await linkedDocs.readDocs(projectId);
  assert.strictEqual(r.bible.source, 'story_bible.md');
  assert.strictEqual(r.bible.sections.find((s) => s.title.startsWith('§1')).section_symbol, '§1');
});

test('readDocs reads canon.md + skill.md', async () => {
  await clearArtifacts();
  await writeFile('sdk_data/canon.md',         '# Canon\n## §3 Palette\n');
  await writeFile('sdk_data/source/skill.md',  '# Skill\n## Rule #1 — 1-bit palette\n');
  const r = await linkedDocs.readDocs(projectId);
  assert.strictEqual(r.canon.present, true);
  assert.strictEqual(r.canon.source, 'canon.md');
  assert.strictEqual(r.skill.present, true);
  assert.strictEqual(r.skill.source, 'source/skill.md');
  assert.ok(r.skill.sections.some((s) => s.title.includes('1-bit palette')));
});

test('pinNote / readNotes / deleteNote round-trip', async () => {
  await clearArtifacts();
  await writeFile('sdk_data/canon.md', '# Canon\n## §3 Palette\nblack + white only\n');
  const created = await linkedDocs.pinNote(projectId, 'sc01', {
    tab: 'canon',
    excerpt: 'black + white only',
    note: 'use 1-bit dither for ambient gradient',
    anchor: '3-palette'
  });
  assert.match(created.id, /^note-/);
  assert.strictEqual(created.scene_id, 'sc01');
  assert.strictEqual(created.tab, 'canon');

  const list = await linkedDocs.readNotes(projectId, 'sc01');
  assert.strictEqual(list.count, 1);
  assert.strictEqual(list.items[0].id, created.id);

  const removed = await linkedDocs.deleteNote(projectId, 'sc01', created.id);
  assert.strictEqual(removed.id, created.id);
  const after = await linkedDocs.readNotes(projectId, 'sc01');
  assert.strictEqual(after.count, 0);
});

test('pinNote rejects invalid tab + missing excerpt', async () => {
  await clearArtifacts();
  await assert.rejects(
    () => linkedDocs.pinNote(projectId, 'sc01', { tab: 'thoughts', excerpt: 'x' }),
    /tab must be one of/
  );
  await assert.rejects(
    () => linkedDocs.pinNote(projectId, 'sc01', { tab: 'bible', excerpt: '   ' }),
    /excerpt required/
  );
  await assert.rejects(
    () => linkedDocs.pinNote(projectId, '',     { tab: 'bible', excerpt: 'x' }),
    /scene_id required/
  );
});

test('deleteNote 404s on unknown id', async () => {
  await clearArtifacts();
  await assert.rejects(
    () => linkedDocs.deleteNote(projectId, 'sc01', 'note-nope'),
    /not found/
  );
});

test('parseSections recognizes §-symbols + nested levels', () => {
  const { parseSections } = linkedDocs._internals;
  const sections = parseSections('# Top\n## §2 Premise\n### §2.1 Setting\n#### Detail\n');
  assert.strictEqual(sections.length, 4);
  assert.strictEqual(sections[1].section_symbol, '§2');
  assert.strictEqual(sections[2].section_symbol, '§2.1');
  assert.strictEqual(sections[3].section_symbol, null);
  assert.strictEqual(sections[3].level, 4);
});

test('pinNote clamps excessively long excerpts + notes', async () => {
  await clearArtifacts();
  const huge = 'x'.repeat(10000);
  const created = await linkedDocs.pinNote(projectId, 'sc02', {
    tab: 'skill', excerpt: huge, note: huge
  });
  assert.ok(created.excerpt.length <= 2048);
  assert.ok(created.note.length <= 4096);
});
