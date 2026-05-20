'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const bible = require('../server/services/sdk_bible');
const bibleDiff = require('../server/services/sdk_bible_diff');
const template = require('../server/services/story_bible_template');

// ---------------------------------------------------------------------------
// Fixture: fresh project with seeded canonical sections
// ---------------------------------------------------------------------------

let tmp;

// node:test doesn't have a beforeAll — use an immediately-run async IIFE to
// set up the shared tmpdir BEFORE any test runs. Tests themselves are sync
// once the async setup resolves.
const setupDone = (async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-smoke-'));
  await template.writeSeed(tmp, { description: 'diff smoke fixture' });
})();

// Helper: ensure setup completed before each test.
async function setup() {
  await setupDone;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('snapshot creates latest.json with sha256 manifest', async () => {
  await setup();
  const snap = await bibleDiff.snapshot(tmp);
  assert.ok(snap.taken_at, 'taken_at present');
  assert.ok(typeof snap.files === 'object', 'files object present');
  // All 10 canonical sections should be hashed.
  assert.ok(Object.keys(snap.files).length >= 10);
  for (const hash of Object.values(snap.files)) {
    assert.match(hash, /^[a-f0-9]{64}$/, 'sha256 hex');
  }
  // latest.json written on disk
  const latestPath = path.join(tmp, 'sdk_data', 'bible_snapshots', 'latest.json');
  assert.ok(fs.existsSync(latestPath), 'latest.json exists');
});

test('diff returns empty when nothing changed', async () => {
  await setup();
  await bibleDiff.snapshot(tmp);
  const d = await bibleDiff.diff(tmp, 'latest');
  assert.equal(d.added.length, 0);
  assert.equal(d.modified.length, 0);
  assert.equal(d.removed.length, 0);
});

test('modify cast section → modified includes 02_cast.md, impact.characters_changed populated', async () => {
  await setup();
  await bibleDiff.snapshot(tmp);

  // Modify the cast section with named characters.
  const castPath = path.join(tmp, 'sdk_data', 'bible', '02_cast.md');
  await fsp.writeFile(castPath,
    '# Cast\n\n## Witness\n\nThe protagonist.\n\n## **Antagonist Rex**\n\n');

  const d = await bibleDiff.diff(tmp, 'latest');
  assert.ok(d.modified.includes('02_cast.md'), '02_cast.md in modified');
  assert.ok(d.impact.characters_changed.length > 0, 'characters_changed populated');
  // 'witness' should be extracted from H2 heading
  assert.ok(d.impact.characters_changed.includes('witness'), `expected 'witness' in ${JSON.stringify(d.impact.characters_changed)}`);
});

test('add scene_alley.md → diff.added includes it, impact.scenes_changed = ["alley"]', async () => {
  await setup();
  await bibleDiff.snapshot(tmp);

  await bible.write(tmp, 'scene_alley.md', '# Scene: Alley\n\nDark and rainy.\n');

  const d = await bibleDiff.diff(tmp, 'latest');
  assert.ok(d.added.includes('scene_alley.md'), 'scene_alley.md in added');
  assert.ok(d.impact.scenes_changed.includes('alley'), `expected 'alley' in ${JSON.stringify(d.impact.scenes_changed)}`);
});

test('change DO NOT section → impact.do_not_changed = true', async () => {
  await setup();
  await bibleDiff.snapshot(tmp);

  const doNotPath = path.join(tmp, 'sdk_data', 'bible', '09_do_not.md');
  await fsp.writeFile(doNotPath, '# DO NOT\n\nNever add a sequel hook.\n');

  const d = await bibleDiff.diff(tmp, 'latest');
  assert.ok(d.modified.includes('09_do_not.md'), '09_do_not.md in modified');
  assert.equal(d.impact.do_not_changed, true);
});

test('delete custom file → diff.removed includes it', async () => {
  await setup();
  // First write a custom file and snapshot with it present.
  await bible.write(tmp, 'custom_lore_faction.md', '# Faction Lore\n\nDetails.\n');
  await bibleDiff.snapshot(tmp);

  // Now remove it.
  await bible.remove(tmp, 'custom_lore_faction.md');

  const d = await bibleDiff.diff(tmp, 'latest');
  assert.ok(d.removed.includes('custom_lore_faction.md'), 'custom_lore_faction.md in removed');
});

test('tone section change → impact.tone_changed = true', async () => {
  await setup();
  await bibleDiff.snapshot(tmp);

  const tonePath = path.join(tmp, 'sdk_data', 'bible', '05_tone.md');
  await fsp.writeFile(tonePath, '# Tone\n\nNoir, gritty, no jokes.\n');

  const d = await bibleDiff.diff(tmp, 'latest');
  assert.equal(d.impact.tone_changed, true);
});
