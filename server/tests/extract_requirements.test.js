'use strict';

// extract_requirements.test.js — Phase 6 A2 unit tests.
//
// All tests inject a stub claudeFn so no real Claude subprocess is spawned.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const intakeUpload = require('../services/intake_upload');
const extractor = require('../services/extract_requirements');

async function freshProject() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'extract-test-'));
  await fsp.mkdir(path.join(root, 'sdk_data'), { recursive: true });
  return root;
}

const FAKE_BIBLE_JSON = JSON.stringify({
  scenes: [
    { id: 'SC01', act: 1, title: 'Bedroom', summary: 'Player wakes up.', characters_present: ['K0nsole'], location: 'bedroom', gameplay_type: 'exploration', transitions_to: ['SC02'], notes: '' },
    { id: 'SC02', act: 1, title: 'Phone Line', summary: 'War-dial.', characters_present: ['K0nsole'], location: 'bedroom', gameplay_type: 'minigame', transitions_to: ['SC03'], notes: '' }
  ],
  characters: [
    { name: 'K0nsole', role: 'protagonist', traits: ['curious'], dialog_samples: [], portrait_refs: [] }
  ],
  locations: [{ name: 'bedroom', description: 'Teenager bedroom', anchor_ref: 'bedroom.png', scenes: ['SC01', 'SC02'] }],
  minigames: [{ name: 'war_dial', scene: 'SC02', input: 'crank', win_state: 'connected', loss_state: 'busy', spec_notes: '' }],
  cameos: [],
  style_anchors_implied: [{ subject: 'bedroom', ref_hint: 'bedroom.png' }]
});

const FAKE_CANON_JSON = JSON.stringify({
  sections: [
    { number: 3, title: 'Global Style', kind: 'preamble', prompt_excerpt: '1-bit, 400x240, atkinson', required_tokens: ['1-bit'], forbidden_tokens: [], subject_anchors: [], is_filter_safe_rewrite: false, rewrite_of_section: null }
  ],
  prompt_vocabulary: { dither_types: ['atkinson'], lighting_terms: [], subject_terms: [] },
  filter_safe_alternates: []
});

const FAKE_REF_JSON = JSON.stringify({
  images: [
    { filename: 'bedroom.png', rel_path: 'sdk_data/source/refs/bedroom.png', dimensions: { w: 400, h: 240 }, dither_type: 'atkinson', is_1bit: true, contents_description: 'A teenage bedroom in 1bit.', anchored_subject: 'scene', anchored_to: ['SC01'], ambiguity_flags: [] }
  ]
});

function stubClaude(textByContains) {
  // Returns a fn that picks a response based on substring match in the prompt.
  return async (prompt) => {
    for (const [needle, response] of Object.entries(textByContains)) {
      if (prompt.includes(needle)) return response;
    }
    return '{}';
  };
}

test('extractRequirements runs all 3 workers in parallel + writes files', async () => {
  const root = await freshProject();
  await intakeUpload.ingest(root, {
    bible: { content: '# Bible v1\n\nAct 1: SC01 Bedroom — wake up.' },
    canon: { content: '# Canon §3\n\n1-bit 400x240 atkinson.' },
    reference_images: [{ filename: 'bedroom.png', content: Buffer.from('PNGFAKE') }]
  });

  const claudeFn = stubClaude({
    'STORY BIBLE START': FAKE_BIBLE_JSON,
    'STYLE CANON START': FAKE_CANON_JSON,
    'REFERENCE IMAGE PATHS START': FAKE_REF_JSON
  });

  const result = await extractor.extractRequirements(root, { projectId: 'p-test-1234', claudeFn });

  assert.strictEqual(result.extracted.scenes.length, 2);
  assert.strictEqual(result.extracted.characters.length, 1);
  assert.strictEqual(result.extracted.canon.sections.length, 1);
  assert.strictEqual(result.reference_catalog.images.length, 1);
  assert.strictEqual(result.log.summary.scene_count, 2);
  assert.strictEqual(result.log.workers.bible.status, 'done');
  assert.strictEqual(result.log.workers.canon.status, 'done');
  assert.strictEqual(result.log.workers.references.status, 'done');

  // Files on disk
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/requirements/extracted.json')));
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/requirements/reference_catalog.json')));
  assert.ok(fs.existsSync(path.join(root, 'sdk_data/requirements/extraction_log.json')));
});

test('extractRequirements skips workers when source is missing', async () => {
  const root = await freshProject();
  await intakeUpload.ingest(root, {
    bible: { content: '# Bible only' }
  });
  const claudeFn = stubClaude({ 'STORY BIBLE START': FAKE_BIBLE_JSON });
  const result = await extractor.extractRequirements(root, { projectId: 'p-test-skip', claudeFn });
  assert.strictEqual(result.log.workers.bible.status, 'done');
  assert.strictEqual(result.log.workers.canon.status, 'skipped');
  assert.strictEqual(result.log.workers.references.status, 'skipped');
  assert.strictEqual(result.extracted.canon.sections.length, 0);
  assert.strictEqual(result.reference_catalog.images.length, 0);
});

test('extractRequirements tolerates malformed Claude output', async () => {
  const root = await freshProject();
  await intakeUpload.ingest(root, {
    bible: { content: '# Bible' },
    canon: { content: '# Canon' }
  });
  const claudeFn = stubClaude({
    'STORY BIBLE START': 'not json at all',
    'STYLE CANON START': '```json\n{"sections":[]}\n```'
  });
  const result = await extractor.extractRequirements(root, { projectId: 'p-malformed', claudeFn });
  assert.strictEqual(result.log.workers.bible.status, 'failed');
  assert.strictEqual(result.log.workers.canon.status, 'done');
  assert.strictEqual(result.extracted.scenes.length, 0);
});

test('safeParseJson handles fenced + raw JSON', () => {
  const fenced = '```json\n{"a":1}\n```';
  const raw = '{"b":2}';
  const noisy = 'Sure! Here is the JSON:\n{"c":3}\n\nLet me know if you need more.';
  assert.deepStrictEqual(extractor._internal.safeParseJson(fenced), { a: 1 });
  assert.deepStrictEqual(extractor._internal.safeParseJson(raw), { b: 2 });
  assert.deepStrictEqual(extractor._internal.safeParseJson(noisy), { c: 3 });
  assert.strictEqual(extractor._internal.safeParseJson('hello world'), null);
  assert.strictEqual(extractor._internal.safeParseJson(''), null);
});

test('startJob registers + subscribeJob replays events', async () => {
  const root = await freshProject();
  // No source material -> all 3 workers skip -> no Claude subprocess fires.
  const job = extractor.startJob(root, 'p-job-test');
  assert.ok(job.id.startsWith('extract-'));
  assert.strictEqual(extractor.getJob(job.id), job);

  // Wait for the no-source path to finish (all 3 workers skip; should be ~10ms).
  await new Promise((res) => {
    const t = setInterval(() => {
      if (job.state !== 'running') { clearInterval(t); res(); }
    }, 5);
  });

  assert.strictEqual(job.state, 'done');
  assert.ok(job.events.length >= 2, `expected at least 2 events, got ${job.events.length}`);

  // subscribeJob should replay all existing events.
  const replayed = [];
  const unsubscribe = extractor.subscribeJob(job.id, (e) => replayed.push(e));
  assert.strictEqual(replayed.length, job.events.length);
  if (unsubscribe) unsubscribe();
});
