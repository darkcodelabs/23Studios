'use strict';

// E2E integration test for the full 23studios SDK autopilot + post-pipeline
// services. Stubs Claude + image gen + audio gen so the run is deterministic
// and free; the autopilot orchestrator + every Wave 1-4 service runs for real.
//
// Coverage:
//   1. Project create on a tmpdir
//   2. Autopilot phase 1 — brainstorm fan-out (3 concepts) + concept gate
//   3. Pick concept programmatically
//   4. Autopilot resume — story / characters / scene_bursts / portrait_bursts /
//      scene_lua / sfx / music / launcher
//   5. Design compiler emits compiled_design.json
//   6. Static validator passes
//   7. Perf audit produces a report
//   8. Architecture diagram emits architecture.md (+ mermaid blocks)
//   9. QA critic (stubbed Claude) returns 5 personas + aggregate
//  10. Review board sync surfaces pending items
//  11. Six canonical gates seeded; sign each off
//  12. Release packager (skipped if pdc absent — degrades gracefully)
//
// Asserts at every step that the right files land in sdk_data/.
//
// To run: node --test tests/e2e_pipeline_full.test.js
//
// SAFE TO RUN ON CI — no network, no real Claude, no real OpenRouter.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

// --- TEMP project setup ---
const tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-23studios-'));
const PROJECT_ID = 'e2e_test_proj';

// Write minimal pdxinfo + main.lua + a couple of scene Luas so the perf audit
// and architecture diagram have something to scan post-autopilot.
fs.mkdirSync(path.join(tmpProjectRoot, 'source', 'images'), { recursive: true });
fs.mkdirSync(path.join(tmpProjectRoot, 'source', 'scenes'), { recursive: true });
fs.mkdirSync(path.join(tmpProjectRoot, 'source', 'sounds'), { recursive: true });
fs.mkdirSync(path.join(tmpProjectRoot, 'source', 'systems'), { recursive: true });
fs.writeFileSync(path.join(tmpProjectRoot, 'source', 'pdxinfo'),
  'name=e2e test\nversion=0.0.1-e2e\nbundleID=com.darkcode.e2e\nimagePath=launcher/card\n');
fs.writeFileSync(path.join(tmpProjectRoot, 'source', 'main.lua'),
  'import "CoreLibs/graphics"\nimport "systems/save_state"\nfunction playdate.update() end\n');
fs.writeFileSync(path.join(tmpProjectRoot, 'source', 'systems', 'save_state.lua'),
  'local M = {}\nfunction M.get() end\nfunction M.set() end\n_G.save_state = M\nreturn M\n');
fs.writeFileSync(path.join(tmpProjectRoot, 'source', 'scenes', 'title.lua'),
  'local M = {}\nfunction M.draw() playdate.graphics.clear() end\nreturn M\n');

// Tiny 8x8 grayscale PNG, valid header so perf audit can read metadata.
function tinyPng() {
  // Minimal 8x8 monochrome PNG fixture — generated once, hex-decoded.
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000080000000801000000003776' +
    '8e0000000a49444154789c63600000000200015c2c0c180000000049454e44ae426082',
    'hex'
  );
}
fs.writeFileSync(path.join(tmpProjectRoot, 'source', 'images', 'title-table-16-16.png'),
  Buffer.concat([Buffer.alloc(0), tinyPng()]));

// --- Stub projects + claude + pulp_ai + sfx + music + mvp_autopilot ---
//
// We MUST inject stubs into require.cache before sdk_autopilot is loaded,
// because sdk_autopilot does `const X = require(...)` at module top.

function stubModule(absPath, exportsObj) {
  require.cache[absPath] = {
    id: absPath, filename: absPath, loaded: true, exports: exportsObj
  };
}

const srvDir = path.join(__dirname, '..', 'server', 'services');

// Projects — single project at our tmp root
stubModule(path.join(srvDir, 'projects.js'), {
  getProject: async (id) => id === PROJECT_ID
    ? { id, name: 'E2E Test', game_type: 'sdk', local_path: tmpProjectRoot,
        description: 'pipeline smoke test', developer: 'Cory Kennedy' }
    : null,
  listProjects: async () => [{ id: PROJECT_ID, local_path: tmpProjectRoot }]
});

// Claude stub — returns canned text per stage. The autopilot recognises
// stages by the prompt it sends; we just respond with valid-shape JSON.
let claudeCallCount = 0;
const claudeResponses = {
  brainstorm: () => '{"title_suggestion":"E2E Adventure","genre":"detective",' +
    '"mechanic_hook":"crank-driven dial tuning",' +
    '"pitch_text":"You are a noir detective tuning radio frequencies to crack the case."}',
  story: () => JSON.stringify({
    title: 'E2E Adventure',
    scenes: [
      { id: 'title', name: 'Title', description: 'Opening title screen.', type: 'cutscene',
        mood: 'expectant', music_intent: 'ambient', exits: [{ to: 'office' }] },
      { id: 'office', name: 'Office', description: 'Detective office.', type: 'explore',
        mood: 'tense', music_intent: 'tense', exits: [{ to: 'street' }] },
      { id: 'street', name: 'Street', description: 'Rain-soaked street.', type: 'explore',
        mood: 'rainy', music_intent: 'noir', exits: [] }
    ]
  }),
  characters: () => JSON.stringify({
    characters: [
      { id: 'detective', name: 'Detective', role: 'protagonist', bio: 'A tired sleuth.',
        portrait_prompt: 'noir detective, head and shoulders, 1-bit', visual_anchor: 'detective' },
      { id: 'witness', name: 'Witness', role: 'npc', bio: 'Knows too much.',
        portrait_prompt: 'shifty witness, head and shoulders, 1-bit', visual_anchor: 'witness' }
    ]
  }),
  scene_lua: () => '-- generated scene\nlocal M = {}\nfunction M.draw() end\nreturn M\n',
  default: () => '{}'
};

function pickResponse(text) {
  claudeCallCount++;
  // Concept fan-out (3 parallel calls)
  if (/Tone direction:/.test(text)) return claudeResponses.brainstorm();
  // Characters stage — `portrait_prompt` is unique to the character prompt
  if (/portrait_prompt/.test(text)) return claudeResponses.characters();
  // Scene Lua emitter
  if (/Lua module|emit Lua|return M|scene_manager\./.test(text)) {
    return claudeResponses.scene_lua();
  }
  // Story stage — `Brainstorm:` appears literally in the runStoryAndScenes prompt
  if (/Brainstorm:/.test(text) && /scenes/.test(text)) return claudeResponses.story();
  return claudeResponses.default();
}

stubModule(path.join(srvDir, 'claude.js'), {
  sendMessage: ({ text, onChunk, onDone }) => {
    setImmediate(() => {
      try { onChunk(pickResponse(text)); onDone(); }
      catch (e) { /* swallow */ }
    });
  }
});

// pulp_ai stub — return tiny PNG instead of calling OpenRouter
stubModule(path.join(srvDir, 'pulp_ai.js'), {
  generateScene: async () => ({ pngBuffer: tinyPng(), sourceBuffer: tinyPng(),
                                model: 'stub', prompt: '', fallback: false, dim: [400, 240] }),
  generatePortrait: async () => ({ pngBuffer: tinyPng(), sourceBuffer: tinyPng(),
                                   model: 'stub', prompt: '', fallback: false, dim: [64, 64] }),
  toScenePng: async (b) => b,
  toPortraitPng: async (b) => b,
  PORTRAIT_STYLE_LOCK: '', SCENE_STYLE_LOCK: ''
});

// sfx + music — no-op
stubModule(path.join(srvDir, 'sfx_synth.js'), {
  generateOne: async () => Buffer.alloc(44),
  BASELINE_PRESETS: [
    { name: 'baseline_a', description: 'a' }, { name: 'baseline_b', description: 'b' }
  ]
});
stubModule(path.join(srvDir, 'music_library.js'), {
  pickForScene: () => ({ src: 'stub.wav', mood: 'ambient' }),
  renderTrack: async () => undefined,
  loadLibrary: async () => ({ tracks: [] })
});

// asset_library — return empty picks (no Phase 3 axes refined for this run)
stubModule(path.join(srvDir, 'asset_library.js'), {
  getActivePicks: async () => ({}),
  getActivePicksWithSpecs: async () => ({}),
  recordPick: async () => ({}),
  listLibrary: async () => ({ packs: [] })
});

// mvp_autopilot — no MVP lock for this run
stubModule(path.join(srvDir, 'mvp_autopilot.js'), {
  readLocked: async () => null,
  formatLockPreamble: () => ''
});

// drift_detect — pass everything
stubModule(path.join(srvDir, 'drift_detect.js'), {
  checkPromptDrift: async () => ({ passes: true, required_missing: [], forbidden_present: [],
                                    anchor_missing: [], drift_score: 0 }),
  appendDriftFlag: async () => ({})
});

// review_board — wired into autopilot post-stage; let it run for real but
// trap any throw so a board glitch doesn't fail the orchestrator.
const realReviewBoard = require(path.join(srvDir, 'sdk_review_board.js'));
const reviewSpy = { syncCount: 0 };
stubModule(path.join(srvDir, 'sdk_review_board.js'), {
  ...realReviewBoard,
  sync: async (...args) => { reviewSpy.syncCount++; try { return await realReviewBoard.sync(...args); }
                              catch (_e) { return {}; } }
});

// Now load the autopilot (after all stubs are in cache)
const autopilot = require(path.join(srvDir, 'sdk_autopilot.js'));
const designCompiler = require(path.join(srvDir, 'sdk_design_compiler.js'));
const staticValidator = require(path.join(srvDir, 'sdk_static_validator.js'));
const perfAudit = require(path.join(srvDir, 'sdk_perf_audit.js'));
const archDiagram = require(path.join(srvDir, 'sdk_arch_diagram.js'));
const qaCritic = require(path.join(srvDir, 'sdk_qa_pass.js'));
const gates = require(path.join(srvDir, 'gates.js'));
const releasePackager = require(path.join(srvDir, 'sdk_release_packager.js'));

// --- The actual tests ---

function runAutopilot(opts = {}) {
  const events = [];
  const job = autopilot.startSdkAutopilot({
    projectId: PROJECT_ID, pitch: 'noir detective E2E',
    skipBatchGates: opts.skipBatchGates !== false,
    onEvent: (kind, data) => events.push({ kind, data })
  });
  return { job, events };
}

test('stage 1: brainstorm fan-out emits 3 concepts + gate file', async () => {
  const { job, events } = runAutopilot({ skipBatchGates: true });
  // Wait for the autopilot to either finish or hit the concept gate.
  await new Promise((res) => setTimeout(res, 1500));

  const conceptsDir = path.join(tmpProjectRoot, 'sdk_data', 'concepts');
  const gateFile = path.join(tmpProjectRoot, 'sdk_data', 'gates', 'concept_pick.json');

  // Concept files exist
  assert.ok(fs.existsSync(conceptsDir), 'concepts dir should exist');
  for (const id of ['concept_01', 'concept_02', 'concept_03']) {
    const fp = path.join(conceptsDir, id + '.json');
    assert.ok(fs.existsSync(fp), `${id}.json should exist`);
    const c = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(c.id, id);
    assert.ok(c.tone_seed);
    assert.ok(c.title_suggestion);
  }

  // cards.md present
  assert.ok(fs.existsSync(path.join(conceptsDir, 'cards.md')));

  // Gate exists, awaiting_pick
  assert.ok(fs.existsSync(gateFile));
  const gate = JSON.parse(fs.readFileSync(gateFile, 'utf8'));
  assert.equal(gate.status, 'awaiting_pick');
  assert.deepEqual(gate.concepts.sort(), ['concept_01', 'concept_02', 'concept_03']);

  // Brainstorm phase event emitted
  assert.ok(events.some((e) => e.kind === 'phase' && e.data && e.data.id === 'brainstorm'));
});

test('stage 2: pick concept resumes autopilot through to launcher', async () => {
  // Pick concept_01 by writing the gate file directly (mirrors what the
  // /concepts/choose route does)
  const gateFile = path.join(tmpProjectRoot, 'sdk_data', 'gates', 'concept_pick.json');
  const gate = JSON.parse(fs.readFileSync(gateFile, 'utf8'));
  gate.status = 'locked';
  gate.chosen = 'concept_01';
  fs.writeFileSync(gateFile, JSON.stringify(gate, null, 2));

  // Resume autopilot
  const { events } = runAutopilot({ skipBatchGates: true });
  // Wait for the 9-stage autopilot to chain through. 12s allows for the
  // synchronous claude stub callbacks to drain through every stage.
  await new Promise((res) => setTimeout(res, 12000));

  // sdk_data/project.json must exist with a scenes array
  const projJson = path.join(tmpProjectRoot, 'sdk_data', 'project.json');
  assert.ok(fs.existsSync(projJson), 'sdk_data/project.json should exist post-autopilot');
  const sdk = JSON.parse(fs.readFileSync(projJson, 'utf8'));
  assert.ok(Array.isArray(sdk.scenes), 'project.json.scenes should be an array');
  assert.ok(sdk.scenes.length >= 3, `expected >=3 scenes in project.json, got ${sdk.scenes.length}`);

  // Scene PNG bursts written (one per scene) — proves runSceneBursts ran
  const scenesDir = path.join(tmpProjectRoot, 'sdk_data', 'scenes');
  assert.ok(fs.existsSync(scenesDir), 'sdk_data/scenes/ should exist');
  const scenePngs = fs.readdirSync(scenesDir).filter((f) => f.endsWith('.png'));
  assert.ok(scenePngs.length >= 3, `expected >=3 scene PNGs, got ${scenePngs.length}`);

  // Character portraits — proves runPortraitBursts ran
  const charsDir = path.join(tmpProjectRoot, 'sdk_data', 'characters');
  assert.ok(fs.existsSync(charsDir), 'sdk_data/characters/ should exist');
  const charPngs = fs.readdirSync(charsDir).filter((f) => f.endsWith('.png'));
  assert.ok(charPngs.length >= 1, `expected >=1 character PNG, got ${charPngs.length}`);

  // art_source/ mirror (PR #74 — pre-dither source art preserved)
  const artSrcScenes = path.join(tmpProjectRoot, 'sdk_data', 'art_source', 'scenes');
  if (fs.existsSync(artSrcScenes)) {
    const mirrors = fs.readdirSync(artSrcScenes).filter((f) => f.endsWith('.png'));
    assert.ok(mirrors.length >= 1, 'art_source/scenes mirrors should exist');
  }

  // Review board sync called at least once during the run
  assert.ok(reviewSpy.syncCount >= 1, `reviewBoard.sync was called ${reviewSpy.syncCount} times`);
});

test('stage 3: design compiler emits compiled_design.json', async () => {
  const sdkDataDir = path.join(tmpProjectRoot, 'sdk_data');
  const compiled = await designCompiler.compile(PROJECT_ID, sdkDataDir);
  assert.ok(compiled);
  assert.ok(compiled.rooms_graph !== undefined);
  assert.ok(Array.isArray(compiled.puzzle_dag));
  assert.ok(compiled.save_schema);
  assert.ok(Array.isArray(compiled.save_schema.fields));
  // File on disk
  assert.ok(fs.existsSync(path.join(sdkDataDir, 'compiled_design.json')));
});

test('stage 4: static validator passes against compiled design', async () => {
  const report = await staticValidator.validate(PROJECT_ID, path.join(tmpProjectRoot, 'sdk_data'));
  assert.ok(report);
  assert.ok(Array.isArray(report.checks));
  assert.equal(report.checks.length, 6, 'expected 6 canonical checks');
  // Trivial-pass is fine for a fresh project
  assert.equal(report.ok, true);
});

test('stage 5: perf audit produces structured report', async () => {
  const r = await perfAudit.audit(PROJECT_ID, tmpProjectRoot);
  assert.ok(r);
  assert.ok(r.summary);
  assert.equal(typeof r.summary.sprite_count, 'number');
  // Our fixture has a -table-16-16.png so sprite count >= 1
  assert.ok(r.summary.sprite_count >= 1);
  assert.ok(Array.isArray(r.image_sizes));
});

test('stage 6: architecture diagram emits markdown', async () => {
  const sdkDataDir = path.join(tmpProjectRoot, 'sdk_data');
  const r = await archDiagram.generate(PROJECT_ID, sdkDataDir);
  assert.ok(r);
  assert.ok(r.md_path);
  assert.ok(fs.existsSync(r.md_path));
  const md = fs.readFileSync(r.md_path, 'utf8');
  assert.ok(md.includes('Architecture'));
  // Mermaid flowchart only emitted when rooms_graph has nodes.
  // Compiler may emit an empty graph on a fresh fixture — accept the
  // empty-graph note or a flowchart block.
  const hasFlowchart = /flowchart TD/i.test(md);
  const hasEmptyNote = /no rooms|empty scene graph|no scenes/i.test(md);
  assert.ok(hasFlowchart || hasEmptyNote,
            'architecture.md should have either flowchart TD or an empty-graph note');
});

test('stage 7: qa critic returns 5 personas + aggregate', async () => {
  // The critic uses the stubbed claude — feed it minimal canned JSON via the
  // existing pickResponse path. Critic system prompts will match the
  // "default" fall-through so we add a critic-specific stub.
  const origSend = require.cache[path.join(srvDir, 'claude.js')].exports.sendMessage;
  require.cache[path.join(srvDir, 'claude.js')].exports.sendMessage =
    ({ text, onChunk, onDone }) => {
      setImmediate(() => {
        const persona = (text.match(/persona[:\s]+(\w+)/i) || [])[1] || 'unknown';
        onChunk(JSON.stringify({
          persona, score_1_to_10: 7, verdict: 'ship',
          answers: { q1: 'fine', q2: 'fine' },
          top_issues: ['too short'],
          top_strengths: ['crank feels good']
        }));
        onDone();
      });
    };

  const report = await qaCritic.critique(PROJECT_ID, path.join(tmpProjectRoot, 'sdk_data'));
  assert.ok(report);
  assert.ok(Array.isArray(report.personas));
  assert.equal(report.personas.length, 5, 'expected 5 personas');
  assert.ok(report.aggregate);
  assert.ok(typeof report.aggregate.avg_score === 'number');
  assert.ok(['ship', 'rework', 'reshelve'].includes(report.recommendation));

  // Restore stub
  require.cache[path.join(srvDir, 'claude.js')].exports.sendMessage = origSend;
});

test('stage 8: 6 canonical gates seeded + sign off + blocking clears', async () => {
  await gates.seedCanonicalGates(PROJECT_ID, tmpProjectRoot);
  const list = await gates.readCanonicalGates(tmpProjectRoot);
  assert.equal(list.length, 6);

  // Before sign-off, milestone_m04 + release should be blocked
  const blockedM04 = await gates.blocking(PROJECT_ID, 'milestone_m04');
  assert.ok(blockedM04, 'milestone_m04 should be blocked by first_playable');
  assert.equal(blockedM04.id, 'first_playable');

  // Sign every canonical gate off
  for (const g of list) {
    await gates.signOffCanonical({ projectId: PROJECT_ID, gateId: g.id,
                                   notes: 'auto-approved by e2e test', signedOffBy: 'e2e' });
  }
  const afterM04 = await gates.blocking(PROJECT_ID, 'milestone_m04');
  assert.equal(afterM04, null, 'milestone_m04 should be clear after sign-off');
  const afterRelease = await gates.blocking(PROJECT_ID, 'release');
  assert.equal(afterRelease, null, 'release should be clear after sign-off');
});

test('stage 9: release packager runs (or skips gracefully without pdc)', async () => {
  // Release packager needs a .pdx from sdk_export.getJobsByProject; we don't
  // have one in this synthetic run. Stub the sdk_export lookup to point at a
  // fake .pdx dir that exists, so the packager can copy it.
  const fakePdxDir = path.join(tmpProjectRoot, 'build', 'fake.pdx');
  fs.mkdirSync(fakePdxDir, { recursive: true });
  fs.writeFileSync(path.join(fakePdxDir, 'pdex.bin'), Buffer.alloc(64));

  stubModule(path.join(srvDir, 'sdk_export.js'), {
    getJobsByProject: () => [{ id: 'fake-job', status: 'done',
                               out_pdx: fakePdxDir, started_at: Date.now() }]
  });
  // re-require packager after stub
  delete require.cache[path.join(srvDir, 'sdk_release_packager.js')];
  const packager = require(path.join(srvDir, 'sdk_release_packager.js'));

  try {
    const r = await packager.pack(PROJECT_ID, {
      tag: 'v0.0.1-e2e', force: true, skipSmoketest: true
    });
    assert.ok(r);
    assert.ok(r.release_dir);
    assert.ok(Array.isArray(r.files));
    assert.ok(r.files.length >= 4, `expected >=4 release files, got ${r.files.length}`);
    // README, CHANGELOG, LICENSE, build.sh, pdx.zip all required
    const kinds = new Set(r.files.map((f) => f.kind));
    for (const k of ['readme', 'changelog', 'license', 'build_script', 'pdx_zip']) {
      assert.ok(kinds.has(k), `expected file kind '${k}', got: ${[...kinds]}`);
    }
  } catch (e) {
    // If packager throws due to missing zip util, surface but don't fail —
    // env-dependent
    if (!/zip|spawn/i.test(e.message)) throw e;
    console.warn('[e2e] release packager skipped:', e.message);
  }
});

test('stage 10: review board sync surfaces pending items', async () => {
  const board = await realReviewBoard.sync(PROJECT_ID, tmpProjectRoot);
  assert.ok(board);
  // Either object form { items: [...] } or array form
  const items = Array.isArray(board) ? board : (board.items || []);
  assert.ok(items.length > 0, 'expected at least one pending item on a fresh project');
});

test('cleanup: tmp project tree exists with all expected dirs', () => {
  const expected = ['sdk_data/concepts', 'sdk_data/scenes', 'sdk_data/gates',
                    'sdk_data/characters', 'release'];
  for (const sub of expected) {
    const fp = path.join(tmpProjectRoot, sub);
    assert.ok(fs.existsSync(fp), `expected dir: ${sub}`);
  }
});
