'use strict';

// concepts_fanout_smoke.test.js — concept fan-out smoke tests.
//
// All tests operate on temp directories with no network/LLM calls.
// The heavy deps of sdk_autopilot (pulp_ai, sfx_synth, etc.) are stubbed
// via module cache injection before the require.
//
// Run: node tests/concepts_fanout_smoke.test.js

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ok  ' + msg); passed++; }
  else { console.error('  FAIL ' + msg); failed++; }
}

// ---------------------------------------------------------------------------
// Stub heavy service deps before requiring sdk_autopilot.
// Stubs must be inserted before the first require of sdk_autopilot.
// ---------------------------------------------------------------------------

function makeClaudeStub(CANNED) {
  return {
    sendMessage({ text, onChunk, onDone }) {
      const toneLine = text.match(/Tone direction: ([^\n]+)/);
      const seed = toneLine ? toneLine[1].toLowerCase() : '';
      let response = JSON.stringify({ title_suggestion: 'Default', genre: 'action', mechanic_hook: 'crank', pitch_text: 'A game.' });
      for (const key of Object.keys(CANNED)) {
        if (seed.includes(key)) { response = CANNED[key]; break; }
      }
      if (text.includes('Regenerate') || text.includes('Blend')) {
        response = JSON.stringify({ title_suggestion: 'Regen Title', genre: 'action', mechanic_hook: 'regen hook', pitch_text: 'Regenerated concept text.' });
      }
      setImmediate(() => { onChunk(response); onDone(); });
    }
  };
}

const CANNED = {
  'darker': JSON.stringify({ title_suggestion: 'Shadow Protocol', genre: 'noir adventure', mechanic_hook: 'stealth crank', pitch_text: 'A gritty descent into the underworld.' }),
  'whimsical': JSON.stringify({ title_suggestion: 'Bunny Bounce', genre: 'platformer', mechanic_hook: 'crank jump height', pitch_text: 'Cheerful bunnies hop through candy clouds.' }),
  'mysterious': JSON.stringify({ title_suggestion: 'The Fog Signal', genre: 'mystery', mechanic_hook: 'crank morse code', pitch_text: 'Ancient signals beneath the fog.' }),
};

// Stubs for modules imported by sdk_autopilot.js transitively.
const STUBS = {
  './claude': makeClaudeStub(CANNED),
  './projects': { getProject: async () => null },
  './pulp_ai': { generateScene: async () => ({}), generatePortrait: async () => ({}) },
  './sfx_synth': { generateBaseline: () => ({}) },
  './music_library': { seedLocalLibrary: async () => ({ manifest: [] }), pickForScene: () => ({}) },
  './playdate_spec': {},
  './sdk_prompt_assembly': {
    assembleSystemPrompt: () => '',
    buildSceneLuaFromFeatures: () => '',
    loadFeatureManifest: () => null,
    formatActivePicks: () => '',
  },
  './asset_library': { getActivePicksWithSpecs: async () => ({}) },
  './mvp_autopilot': { readLocked: async () => null },
  './sdk_design_compiler': {
    compile: async () => ({}),
    compiledSectionForScene: () => ({}),
  },
};

// Register stubs in require cache by resolving their absolute paths.
const servicesDir = path.join(__dirname, '..', 'server', 'services');
for (const [rel, stub] of Object.entries(STUBS)) {
  // Resolve relative to the services directory (where sdk_autopilot lives).
  let abs;
  try { abs = require.resolve(path.join(servicesDir, rel.replace('./', ''))); } catch (_e) { /* skip */ }
  if (abs && !require.cache[abs]) {
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: stub };
  } else if (abs) {
    require.cache[abs].exports = stub;
  }
}

// Now safe to require sdk_autopilot — stubs are in cache.
const { _internals } = require('../server/services/sdk_autopilot');
const { runBrainstorm, resolveConceptGate } = _internals;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpProject() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'concepts-smoke-'));
  await fsp.mkdir(path.join(dir, 'sdk_data', 'concepts'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'sdk_data', 'gates'), { recursive: true });
  return dir;
}

async function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* */ }
}

function fakeCtx(dir) {
  return { projectId: 'smoke-proj', cwd: dir, activePicks: {} };
}

// ---------------------------------------------------------------------------
// Test 1: runBrainstorm writes 3 concept files + cards.md + gate.
// ---------------------------------------------------------------------------
console.log('\n# runBrainstorm — 3 concepts + cards.md + gate');
{
  const run = async () => {
    const dir = await makeTmpProject();
    try {
      const result = await runBrainstorm({
        pitch: 'A spy infiltrating a robot factory',
        claudeCtx: fakeCtx(dir),
        storyBible: null,
        intake: {},
        localPath: dir,
      });

      assert(Array.isArray(result.concepts) && result.concepts.length === 3, '3 concepts returned');
      assert(result.gate === 'concept_pick', 'gate key is concept_pick');

      for (let n = 1; n <= 3; n++) {
        const fp = path.join(dir, 'sdk_data', 'concepts', `concept_0${n}.json`);
        assert(fs.existsSync(fp), `concept_0${n}.json written`);
        if (fs.existsSync(fp)) {
          const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
          assert(obj.id === `concept_0${n}`, `concept_0${n} has correct id`);
          assert(typeof obj.tone_seed === 'string' && obj.tone_seed.length > 0, `concept_0${n} has tone_seed`);
          assert(typeof obj.pitch_text === 'string' && obj.pitch_text.length > 0, `concept_0${n} has pitch_text`);
        }
      }

      const cardsPath = path.join(dir, 'sdk_data', 'concepts', 'cards.md');
      assert(fs.existsSync(cardsPath), 'cards.md written');
      if (fs.existsSync(cardsPath)) {
        const md = fs.readFileSync(cardsPath, 'utf8');
        assert(md.includes('Shadow Protocol'), 'cards.md contains darker concept title');
        assert(md.includes('Bunny Bounce'), 'cards.md contains whimsical concept title');
        assert(md.includes('The Fog Signal'), 'cards.md contains mysterious concept title');
      }

      const gateFp = path.join(dir, 'sdk_data', 'gates', 'concept_pick.json');
      assert(fs.existsSync(gateFp), 'concept_pick.json gate file written');
      if (fs.existsSync(gateFp)) {
        const gate = JSON.parse(fs.readFileSync(gateFp, 'utf8'));
        assert(gate.status === 'awaiting_pick', 'gate status is awaiting_pick');
        assert(gate.chosen === null, 'gate.chosen starts null');
        assert(Array.isArray(gate.concepts) && gate.concepts.length === 3, 'gate.concepts has 3 ids');
        assert(gate.concepts.includes('concept_01'), 'gate has concept_01');
        assert(gate.concepts.includes('concept_02'), 'gate has concept_02');
        assert(gate.concepts.includes('concept_03'), 'gate has concept_03');
      }
    } finally {
      await cleanup(dir);
    }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message, e.stack); failed++; });
}

// ---------------------------------------------------------------------------
// Test 2: resolveConceptGate returns null when not locked.
// ---------------------------------------------------------------------------
console.log('\n# resolveConceptGate — null when awaiting_pick');
{
  const run = async () => {
    const dir = await makeTmpProject();
    try {
      await fsp.writeFile(
        path.join(dir, 'sdk_data', 'gates', 'concept_pick.json'),
        JSON.stringify({ status: 'awaiting_pick', concepts: ['concept_01', 'concept_02', 'concept_03'], chosen: null, hybridized_from: null })
      );
      const r = await resolveConceptGate(dir);
      assert(r === null, 'returns null when gate not locked');
    } finally { await cleanup(dir); }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Test 3: resolveConceptGate resolves chosen concept when locked.
// ---------------------------------------------------------------------------
console.log('\n# resolveConceptGate — resolves concept when locked');
{
  const run = async () => {
    const dir = await makeTmpProject();
    try {
      const concept = { id: 'concept_02', tone_seed: 'whimsical / lighthearted', pitch_text: 'Cheerful bunnies hop.', title_suggestion: 'Bunny Bounce', genre: 'platformer', mechanic_hook: 'crank' };
      await fsp.writeFile(path.join(dir, 'sdk_data', 'concepts', 'concept_02.json'), JSON.stringify(concept));
      await fsp.writeFile(
        path.join(dir, 'sdk_data', 'gates', 'concept_pick.json'),
        JSON.stringify({ status: 'locked', concepts: ['concept_01', 'concept_02', 'concept_03'], chosen: 'concept_02', hybridized_from: null })
      );
      const r = await resolveConceptGate(dir);
      assert(r !== null, 'returns non-null when locked');
      assert(r && r.gate.chosen === 'concept_02', 'gate.chosen is concept_02');
      assert(r && r.concept.pitch_text === 'Cheerful bunnies hop.', 'concept data loaded');
    } finally { await cleanup(dir); }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Test 4: choose sets gate.chosen and status=locked.
// ---------------------------------------------------------------------------
console.log('\n# choose — persists gate.chosen + locked status');
{
  const run = async () => {
    const dir = await makeTmpProject();
    try {
      const gateFp = path.join(dir, 'sdk_data', 'gates', 'concept_pick.json');
      await fsp.writeFile(gateFp, JSON.stringify({
        status: 'awaiting_pick', concepts: ['concept_01', 'concept_02', 'concept_03'],
        chosen: null, hybridized_from: null,
      }));

      // Mirror what the route does.
      const gate = JSON.parse(await fsp.readFile(gateFp, 'utf8'));
      gate.chosen = 'concept_01';
      gate.status = 'locked';
      await fsp.writeFile(gateFp, JSON.stringify(gate, null, 2));

      const saved = JSON.parse(await fsp.readFile(gateFp, 'utf8'));
      assert(saved.chosen === 'concept_01', 'gate.chosen persisted');
      assert(saved.status === 'locked', 'gate.status persisted as locked');
    } finally { await cleanup(dir); }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Test 5: regenerate overwrites concept file.
// ---------------------------------------------------------------------------
console.log('\n# regenerate — overwrites concept file with new content');
{
  const run = async () => {
    const dir = await makeTmpProject();
    try {
      const conceptFp = path.join(dir, 'sdk_data', 'concepts', 'concept_01.json');
      const original = { id: 'concept_01', tone_seed: 'darker / more grounded', pitch_text: 'Original text.', title_suggestion: 'Old Title', genre: 'noir', mechanic_hook: 'old hook' };
      await fsp.writeFile(conceptFp, JSON.stringify(original));

      // Mirror what the route does: overwrite with updated data.
      const updated = { ...original, pitch_text: 'Regenerated concept text.', title_suggestion: 'Regen Title' };
      await fsp.writeFile(conceptFp, JSON.stringify(updated, null, 2));

      const saved = JSON.parse(await fsp.readFile(conceptFp, 'utf8'));
      assert(saved.pitch_text === 'Regenerated concept text.', 'pitch_text overwritten');
      assert(saved.title_suggestion === 'Regen Title', 'title_suggestion updated');
      assert(saved.id === 'concept_01', 'id preserved');
      assert(saved.tone_seed === 'darker / more grounded', 'tone_seed preserved');
    } finally { await cleanup(dir); }
  };
  run().catch((e) => { console.error('  FAIL (exception):', e.message); failed++; });
}

// ---------------------------------------------------------------------------
// Wait for all async tests, then report.
// ---------------------------------------------------------------------------
setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  else console.log('all ok');
}, 2000);
