'use strict';

// intake_upload.test.js — Phase 6 A1 backend tests.
//
// Covers:
//   - ingest writes bible/canon/skill + refs + urls/notes to the right paths
//   - sha256 manifest persists + re-ingest of unchanged content reports unchanged
//   - changed content reports changed, removed surfaces missing items
//   - listSources reflects what's on disk
//   - unsafe filename rejected
//   - oversized text doc rejected

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const intakeUpload = require('../services/intake_upload');

async function freshProject() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'iu-test-'));
  await fsp.mkdir(path.join(root, 'sdk_data'), { recursive: true });
  return root;
}

test('ingest writes text docs + refs + json sidecars', async () => {
  const root = await freshProject();
  const spec = {
    bible: { content: '# Bible\n\nAct 1: stuff.' },
    canon: { content: '# Canon\n\nstyle rules.' },
    skill_md: { content: '# SKILL\n\n1bit only.' },
    reference_images: [
      { filename: 'bedroom.png', content: Buffer.from('PNGFAKE1'), tag: 'scene', subject_hint: 'SC01' },
      { filename: 'pwnglove.png', content: Buffer.from('PNGFAKE2'), tag: 'prop' }
    ],
    urls: [
      { url: 'https://textfiles.com/aohell/', tag: 'archive', subject_hint: 'AOHell' },
      { url: 'not-a-real-url', tag: 'should drop' }
    ],
    notes: [
      { text: 'Cory K. SC26 cameo: "you taught us"' },
      { text: '' } // dropped
    ]
  };
  const result = await intakeUpload.ingest(root, spec);
  assert.ok(result.manifest);
  assert.ok(result.manifest.items.bible);
  assert.ok(result.manifest.items.canon);
  assert.ok(result.manifest.items.skill_md);
  assert.ok(result.manifest.items['ref:bedroom.png']);
  assert.ok(result.manifest.items['ref:pwnglove.png']);
  assert.ok(result.manifest.items.urls);
  assert.ok(result.manifest.items.notes);

  // Files on disk
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/source/bible.md')));
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/source/canon.md')));
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/source/skill.md')));
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/source/refs/bedroom.png')));
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/source/refs/pwnglove.png')));
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/source/manifest.json')));

  // First ingest -> everything is "added"
  assert.deepStrictEqual(new Set(result.diff.added), new Set([
    'bible', 'canon', 'skill_md', 'ref:bedroom.png', 'ref:pwnglove.png', 'urls', 'notes'
  ]));
  assert.deepStrictEqual(result.diff.changed, []);
  assert.deepStrictEqual(result.diff.removed, []);

  // urls.json + notes.json sanity: bad URL + empty note dropped
  const urls = JSON.parse(await fsp.readFile(path.join(root, 'sdk_data/source/urls.json'), 'utf8'));
  assert.strictEqual(urls.urls.length, 1);
  assert.strictEqual(urls.urls[0].url, 'https://textfiles.com/aohell/');
  const notes = JSON.parse(await fsp.readFile(path.join(root, 'sdk_data/source/notes.json'), 'utf8'));
  assert.strictEqual(notes.notes.length, 1);
});

test('re-ingest reports unchanged + changed + removed', async () => {
  const root = await freshProject();
  await intakeUpload.ingest(root, {
    bible: { content: 'bible v1' },
    canon: { content: 'canon v1' },
    reference_images: [{ filename: 'a.png', content: Buffer.from('AA') }]
  });

  // Second ingest: bible unchanged, canon changed, drop a.png by not re-uploading
  // (the manifest preserves it because it's still on disk; explicit removal
  // requires removeReferenceImage).
  const second = await intakeUpload.ingest(root, {
    bible: { content: 'bible v1' },        // unchanged sha256
    canon: { content: 'canon v2 changed' } // changed sha256
  });
  assert.ok(second.diff.unchanged.includes('bible'));
  assert.ok(second.diff.changed.includes('canon'));
  // a.png should be preserved (no removal happened)
  assert.ok(second.manifest.items['ref:a.png']);

  // Now explicitly remove a.png
  await intakeUpload.removeReferenceImage(root, 'a.png');
  const after = await intakeUpload.readManifest(root);
  assert.strictEqual(after.items['ref:a.png'], undefined);
  assert.ok(!fs.existsSync(path.join(root, 'sdk_data/source/refs/a.png')));
});

test('listSources returns the persisted shape', async () => {
  const root = await freshProject();
  await intakeUpload.ingest(root, {
    bible: { content: 'bible' },
    reference_images: [{ filename: 'x.png', content: Buffer.from('XX'), tag: 'scene' }],
    urls: [{ url: 'https://example.com/foo', tag: 'ref' }],
    notes: [{ text: 'hello world', tag: 'lore' }]
  });
  const summary = await intakeUpload.listSources(root);
  assert.ok(summary.text_docs.bible);
  assert.strictEqual(summary.text_docs.canon, null);
  assert.strictEqual(summary.reference_images.length, 1);
  assert.strictEqual(summary.reference_images[0].filename, 'x.png');
  assert.strictEqual(summary.urls.length, 1);
  assert.strictEqual(summary.notes.length, 1);
});

test('unsafe reference filename rejected', async () => {
  const root = await freshProject();
  await assert.rejects(
    intakeUpload.ingest(root, {
      reference_images: [{ filename: '../etc/passwd', content: Buffer.from('XX') }]
    }),
    (e) => e.code === 'bad_filename'
  );
});

test('oversized text doc rejected', async () => {
  const root = await freshProject();
  const big = Buffer.alloc(intakeUpload._internal.MAX_TEXT_BYTES + 1, 'A');
  await assert.rejects(
    intakeUpload.ingest(root, { bible: { content: big } }),
    (e) => e.code === 'file_too_large'
  );
});

test('diffManifests classifies items correctly', () => {
  const prev = {
    a: { sha256: '111' },
    b: { sha256: '222' },
    c: { sha256: '333' }
  };
  const next = {
    a: { sha256: '111' },         // unchanged
    b: { sha256: '999' },         // changed
    d: { sha256: '444' }          // added
    // c removed
  };
  const diff = intakeUpload.diffManifests(prev, next);
  assert.deepStrictEqual(diff.unchanged, ['a']);
  assert.deepStrictEqual(diff.changed, ['b']);
  assert.deepStrictEqual(diff.added, ['d']);
  assert.deepStrictEqual(diff.removed, ['c']);
});

test('sha256 stable for identical content', () => {
  const a = Buffer.from('hello');
  const b = Buffer.from('hello');
  assert.strictEqual(intakeUpload._internal.sha256(a), intakeUpload._internal.sha256(b));
});
