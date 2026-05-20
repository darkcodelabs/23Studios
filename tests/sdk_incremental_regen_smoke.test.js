'use strict';

// sdk_incremental_regen_smoke.test.js
//
// Tests plan() + apply() for the incremental regen engine.
// Mocks pulp_ai, projects, sdk_prompt_assembly via require cache injection.
//
// Fixtures: 3 scenes + 2 characters; seeded canonical bible sections.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURE_SCENES = [
  { id: 'intro', name: 'Intro', description: 'The beginning.', type: 'dialog', feature_set: [] },
  { id: 'office', name: 'Office', description: 'A dingy office.', type: 'explore', feature_set: [] },
  { id: 'alley', name: 'Alley', description: 'Dark alley.', type: 'explore', feature_set: [] },
];

const FIXTURE_CHARACTERS = [
  { id: 'witness', name: 'Witness', role: 'protagonist',
    portrait_prompt: 'witness anchor. tall detective', visual_anchor: 'witness anchor' },
  { id: 'rex', name: 'Rex', role: 'antagonist',
    portrait_prompt: 'rex anchor. crime boss', visual_anchor: 'rex anchor' },
];

let tmp;

const setupDone = (async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-smoke-'));
  const sdkData = path.join(tmp, 'sdk_data');
  const bibleDir = path.join(sdkData, 'bible');
  const scenesDir = path.join(sdkData, 'scenes');
  const charsDir = path.join(sdkData, 'characters');
  for (const d of [sdkData, bibleDir, scenesDir, charsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  await fsp.writeFile(path.join(sdkData, 'project.json'), JSON.stringify({
    scenes: FIXTURE_SCENES,
    characters: FIXTURE_CHARACTERS,
    startup_scene: 'intro',
  }, null, 2));
  const template = require('../server/services/story_bible_template');
  await template.writeSeed(tmp, { description: 'regen smoke fixture' });
})();

async function setup() { await setupDone; }

// ---------------------------------------------------------------------------
// Require-cache mock helpers
// ---------------------------------------------------------------------------

// Inject a fake module into require.cache so that any subsequent require()
// resolves the fake. Returns a teardown function that removes the fake.
function injectCache(absolutePath, fakeExports) {
  const existing = require.cache[absolutePath];
  require.cache[absolutePath] = {
    id: absolutePath, filename: absolutePath, loaded: true,
    exports: fakeExports, children: [], paths: [],
    parent: null
  };
  return () => {
    if (existing) require.cache[absolutePath] = existing;
    else delete require.cache[absolutePath];
  };
}

const PROJECTS_PATH = require.resolve('../server/services/projects');
const PULP_AI_PATH  = require.resolve('../server/services/pulp_ai');
const ASSEMBLY_PATH = require.resolve('../server/services/sdk_prompt_assembly');
const REGEN_PATH    = require.resolve('../server/services/sdk_incremental_regen');

const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const fakePulpAi = {
  generatePortrait: async () => ({ pngBuffer: fakePngBuffer, sourceBuffer: null }),
  generateScene:    async () => ({ pngBuffer: fakePngBuffer, sourceBuffer: null }),
};

const fakeAssembly = {
  buildSceneLuaFromFeatures: () => '-- stub lua\n',
  assembleSystemPrompt: () => '',
};

// Load regen fresh with mocks in place.
function loadRegenWithMocks(localPath) {
  const fakeProjects = { getProject: async () => ({ id: 'test', local_path: localPath }) };
  const teardowns = [
    injectCache(PROJECTS_PATH, fakeProjects),
    injectCache(PULP_AI_PATH, fakePulpAi),
    injectCache(ASSEMBLY_PATH, fakeAssembly),
  ];
  delete require.cache[REGEN_PATH];
  const regen = require('../server/services/sdk_incremental_regen');
  return {
    regen,
    teardown() {
      teardowns.forEach((fn) => fn());
      delete require.cache[REGEN_PATH];
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('plan with cast section change → regen_characters includes witness', async () => {
  await setup();

  const bibleDiff = require('../server/services/sdk_bible_diff');

  // Fresh snapshot.
  await bibleDiff.snapshot(tmp);

  // Modify cast section with Witness as H2 heading.
  const castPath = path.join(tmp, 'sdk_data', 'bible', '02_cast.md');
  await fsp.writeFile(castPath, '# Cast\n\n## Witness\n\nThe detective protagonist.\n');

  const { regen, teardown } = loadRegenWithMocks(tmp);
  let planResult;
  try {
    planResult = await regen.plan('test');
  } finally {
    teardown();
  }

  assert.ok(!planResult.full_pipeline_required, 'cast change should NOT require full pipeline');
  const charIds = planResult.regen_characters.map((c) => c.id);
  assert.ok(charIds.includes('witness'), `expected witness in ${JSON.stringify(charIds)}`);
  assert.ok(planResult.estimated_cost_usd > 0, 'cost > 0');
});

test('apply with mock pulpAi → witness portrait written, other scenes untouched', async () => {
  await setup();

  const bibleDiff = require('../server/services/sdk_bible_diff');
  await bibleDiff.snapshot(tmp);

  // Fake plan targeting only witness.
  const fakePlan = {
    plan_id: 'test-plan-1',
    full_pipeline_required: false,
    since: 'test',
    regen_characters: [{ id: 'witness', name: 'Witness', reason: 'cast modified', would_call: 'runPortraitForChar' }],
    regen_scenes: [],
    regen_lua: [],
    estimated_cost_usd: 0.04,
  };

  const { regen, teardown } = loadRegenWithMocks(tmp);
  let applyResult;
  try {
    applyResult = await regen.apply('test', fakePlan);
  } finally {
    teardown();
  }

  assert.ok(applyResult.characters.find((c) => c.id === 'witness'), 'witness regenerated');
  assert.ok(!applyResult.characters.find((c) => c.id === 'rex'), 'rex not regenerated');

  const portraitPath = path.join(tmp, 'sdk_data', 'characters', 'witness.png');
  assert.ok(fs.existsSync(portraitPath), 'witness.png written to disk');

  // Office scene PNG should NOT exist (not in plan).
  const officeScene = path.join(tmp, 'sdk_data', 'scenes', 'office.png');
  assert.ok(!fs.existsSync(officeScene), 'office.png not created (not in plan)');
});

test('apply rejects plan with full_pipeline_required = true', async () => {
  await setup();

  const { regen, teardown } = loadRegenWithMocks(tmp);
  let threw = false;
  try {
    await regen.apply('test', {
      full_pipeline_required: true,
      regen_characters: [], regen_scenes: [], regen_lua: []
    });
  } catch (e) {
    threw = true;
    assert.ok(e.message.includes('full_pipeline_required'), `msg: ${e.message}`);
  } finally {
    teardown();
  }
  assert.ok(threw, 'should throw for full_pipeline_required plan');
});

test('tone change → plan returns full_pipeline_required = true, no regen items', async () => {
  await setup();

  const bibleDiff = require('../server/services/sdk_bible_diff');
  await bibleDiff.snapshot(tmp);

  const tonePath = path.join(tmp, 'sdk_data', 'bible', '05_tone.md');
  await fsp.writeFile(tonePath, '# Tone\n\nFull noir, no humor.\n');

  const { regen, teardown } = loadRegenWithMocks(tmp);
  let result;
  try {
    result = await regen.plan('test');
  } finally {
    teardown();
  }

  assert.equal(result.full_pipeline_required, true);
  assert.equal(result.regen_characters.length, 0);
  assert.equal(result.regen_scenes.length, 0);
  assert.equal(result.regen_lua.length, 0);
  assert.ok(result.full_pipeline_reason, 'reason string present');
});
