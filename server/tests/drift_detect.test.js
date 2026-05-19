'use strict';

// drift_detect.test.js — Phase 6 C3 backend tests.

const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Stub projects service.
const fakeProjects = { _store: new Map() };
fakeProjects.getProject = async (id) => fakeProjects._store.get(id) || null;
fakeProjects._set = (id, p) => fakeProjects._store.set(id, p);
require.cache[require.resolve('../services/projects')] = {
  id: require.resolve('../services/projects'),
  filename: require.resolve('../services/projects'),
  loaded: true,
  exports: fakeProjects
};

const driftDetect = require('../services/drift_detect');

async function freshProject(opts = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drift-test-'));
  await fsp.mkdir(path.join(root, 'sdk_data', 'source'), { recursive: true });
  if (opts.canon) {
    await fsp.writeFile(path.join(root, 'sdk_data', 'source', 'canon.md'), opts.canon);
  }
  const id = `proj-${path.basename(root).slice(-8)}`;
  fakeProjects._set(id, { id, name: id, local_path: root });
  return { id, root };
}

test('forbidden-token sweep flags corporate-safety reflex phrases', async () => {
  const { id } = await freshProject();
  const out = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A bedroom scene. DO NOT INCLUDE: any imagery that could be interpreted as instructional.'
  });
  assert.strictEqual(out.passes, false);
  assert.ok(out.forbidden_present.length > 0);
  assert.ok(out.forbidden_present.some((p) => p.includes('could be interpreted as instructional')));
});

test('canon §3 required tokens enforce when present', async () => {
  const canon = [
    '# Canon',
    '',
    '## §1 Style',
    '',
    'stuff.',
    '',
    '## §3 Image-gen preamble',
    '',
    '- MUST: 1-bit',
    '- MUST: 400×240',
    '- REQUIRED: dither',
    '',
    'inline `Atkinson` and `Floyd-Steinberg` are also required.',
    '',
    '## §4 Other'
  ].join('\n');
  const { id } = await freshProject({ canon });

  const bad = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A sunlit forest, color, painterly.'
  });
  assert.strictEqual(bad.passes, false);
  assert.ok(bad.required_missing.includes('1-bit'));
  assert.ok(bad.required_missing.includes('400×240'));
  assert.ok(bad.required_missing.includes('dither'));

  const good = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A bedroom scene at 400×240, 1-bit, Atkinson dither, Floyd-Steinberg fallback for shadow gradient.'
  });
  assert.strictEqual(good.passes, true);
  assert.strictEqual(good.required_missing.length, 0);
});

test('Playdate baseline applies when canon §3 has no MUST/REQUIRED markers', async () => {
  // §3 exists but only narrative — should fall back to Playdate baseline.
  const canon = '# Canon\n\n## §3 Preamble\n\nThe vibe is haunted modem.\n';
  const { id } = await freshProject({ canon });

  const colorBad = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A sunlit forest, color.'
  });
  assert.strictEqual(colorBad.passes, false);
  assert.ok(colorBad.required_missing.includes('1-bit'));
  assert.ok(colorBad.required_missing.includes('dither'));

  const good = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A scene at 400x240, 1-bit, Atkinson dither.'
  });
  assert.strictEqual(good.passes, true);
});

test('missing canon yields no required-token failures, forbidden still enforced', async () => {
  const { id } = await freshProject();
  const okIfTokensOk = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'free-form prompt with no canon to check against'
  });
  assert.strictEqual(okIfTokensOk.passes, true);
  assert.strictEqual(okIfTokensOk.required_missing.length, 0);

  const stillBlocked = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A scene. As an AI, I cannot help with this request.'
  });
  assert.strictEqual(stillBlocked.passes, false);
  assert.ok(stillBlocked.forbidden_present.length > 0);
});

test('project-specific filter_trip_words extend the forbidden list', async () => {
  const { id } = await freshProject();
  const out = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A scene with redhook prominently displayed.',
    filter_trip_words: ['RedHook', 'BlueBox']
  });
  assert.strictEqual(out.passes, false);
  assert.ok(out.forbidden_present.includes('RedHook'));
});

test('require_anchor_citation gates on anchor/ref/image-path mention', async () => {
  const { id } = await freshProject();

  const noAnchor = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: '1-bit, 400×240, dither scene of a bedroom',
    require_anchor_citation: true
  });
  assert.strictEqual(noAnchor.passes, false);
  assert.strictEqual(noAnchor.anchor_missing, true);

  const withAnchor = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: '1-bit, 400×240, dither bedroom scene. anchor: hakcd_pixel_collection/bedroom.png',
    require_anchor_citation: true
  });
  assert.strictEqual(withAnchor.passes, true);
});

test('drift_score weighting: forbidden = 2, missing = 1, anchor = 1', async () => {
  const canon = '# Canon\n\n## §3\n- MUST: foo\n- MUST: bar\n';
  const { id } = await freshProject({ canon });
  const out = await driftDetect.checkPromptDrift({
    projectId: id,
    prompt_body: 'A scene. Any harmful content avoided.', // 1 forbidden
    require_anchor_citation: true
  });
  // 2 missing (foo + bar) + 1 forbidden*2 + 1 anchor = 5
  assert.strictEqual(out.required_missing.length, 2);
  assert.strictEqual(out.forbidden_present.length, 1);
  assert.strictEqual(out.anchor_missing, true);
  assert.strictEqual(out.drift_score, 2 + 2 + 1);
});

test('appendDriftFlag + readDriftFlags round-trip with stage filter', async () => {
  const { id, root } = await freshProject();
  await driftDetect.appendDriftFlag(id, { kind: 'pre_send', stage: 'scene_lua', drift_score: 3 });
  await driftDetect.appendDriftFlag(id, { kind: 'pre_send', stage: 'portrait_bursts', drift_score: 5 });
  await driftDetect.appendDriftFlag(id, { kind: 'post_generate', stage: 'scene_lua', perceptual_distance: 28 });

  const all = await driftDetect.readDriftFlags(id);
  assert.strictEqual(all.count, 3);

  const onlyScene = await driftDetect.readDriftFlags(id, { stage: 'scene_lua' });
  assert.strictEqual(onlyScene.count, 2);
  assert.ok(onlyScene.items.every((it) => it.stage === 'scene_lua'));

  const onlyPost = await driftDetect.readDriftFlags(id, { kind: 'post_generate' });
  assert.strictEqual(onlyPost.count, 1);
  assert.strictEqual(onlyPost.items[0].perceptual_distance, 28);

  const file = path.join(root, 'sdk_data', 'drift_flags.jsonl');
  const raw = await fsp.readFile(file, 'utf8');
  assert.strictEqual(raw.split('\n').filter(Boolean).length, 3);
});

test('readDriftFlags on missing file returns empty list', async () => {
  const { id } = await freshProject();
  const out = await driftDetect.readDriftFlags(id);
  assert.deepStrictEqual(out, { items: [], count: 0 });
});

test('extractSection3 + parseRequiredFromSection3 internals', () => {
  const { extractSection3, parseRequiredFromSection3 } = driftDetect._internals;
  const canon = [
    '# Canon',
    '## §2 Voice',
    'voice stuff',
    '## §3 Preamble',
    '- MUST: 1-bit',
    'narrative `tag-one` and `tag-two`.',
    '## §4 Closing',
    '- MUST: should-not-leak'
  ].join('\n');
  const s3 = extractSection3(canon);
  assert.ok(s3.includes('Preamble'));
  assert.ok(!s3.includes('Closing'));
  const req = parseRequiredFromSection3(s3);
  assert.ok(req.includes('1-bit'));
  assert.ok(req.includes('tag-one'));
  assert.ok(req.includes('tag-two'));
  assert.ok(!req.includes('should-not-leak'));
});

test('hamming distance + phash internals run when sharp is present', async () => {
  // sharp may or may not be installed in test env; bail soft if not.
  const { computePHash, hammingHashes } = driftDetect._internals;
  const PNG_1x1_WHITE = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
    '53de0000000c4944415478da636060000000000c0001f2c8e2a90000000049' +
    '454e44ae426082',
    'hex'
  );
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'phash-'));
  const p = path.join(root, 'w.png');
  await fsp.writeFile(p, PNG_1x1_WHITE);
  const h1 = await computePHash(p);
  const h2 = await computePHash(p);
  if (h1 == null) return; // sharp not available, skip silently
  const d = hammingHashes(h1, h2);
  assert.strictEqual(d, 0);
});
