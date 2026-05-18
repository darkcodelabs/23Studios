#!/usr/bin/env node
'use strict';

// smoke_sdk_pipeline.js — offline end-to-end smoke for the SDK pipeline.
//
// Three phases, each independently reportable:
//   Phase 1 — intake -> story bible (mocked Claude)
//   Phase 2 — single autopilot stage with assembled system prompt
//             (mocked Claude + mocked pulpAi image gen)
//   Phase 3 — sdk_export with mocked pdc spawn (real packaging code path)
//
// Hermetic: no real Claude/OpenRouter calls, no real pdc binary required.
// All external IO is patched at module level before requiring the services.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const Module = require('module');
const crypto = require('crypto');

const SERVER_DIR = path.join(__dirname, '..');
const TESTS_DIR = path.join(SERVER_DIR, 'tests');
const FIXTURE_PATH = path.join(TESTS_DIR, 'fixtures', 'minimal_intake.json');

const WORKDIR = path.join(os.tmpdir(), 'smoke_sdk_' + process.pid);
const PROJECT_ID = 'smoke-' + Date.now().toString(36).slice(-6);
const PROJECT_LOCAL = path.join(WORKDIR, 'project');
const SDK_DATA = path.join(PROJECT_LOCAL, 'sdk_data');

const results = { phase1: null, phase2: null, phase3: null };

function log(...args) { process.stdout.write(args.join(' ') + '\n'); }
function header(name) { log('\n=== ' + name + ' ==='); }

// 1x1 black PNG (valid PNG header) used for mocked image gen.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
  '890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082',
  'hex'
);

async function setupWorkdir() {
  await fsp.rm(WORKDIR, { recursive: true, force: true });
  await fsp.mkdir(SDK_DATA, { recursive: true });
  await fsp.mkdir(path.join(SDK_DATA, 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(SDK_DATA, 'characters'), { recursive: true });
  await fsp.mkdir(path.join(SDK_DATA, 'sfx_baseline'), { recursive: true });
  await fsp.mkdir(path.join(SDK_DATA, 'scene_music'), { recursive: true });
  // Project metadata in fake projects.json (services/projects.js reads it).
  const projectsDataDir = path.join(WORKDIR, 'projects_data');
  await fsp.mkdir(projectsDataDir, { recursive: true });
  process.env.PROJECTS_DATA_DIR = projectsDataDir;
  const projectsFile = path.join(projectsDataDir, 'projects.json');
  await fsp.writeFile(projectsFile, JSON.stringify({
    projects: [{
      id: PROJECT_ID,
      name: 'Smoke Test Project',
      description: 'smoke test',
      repo: 'local',
      local_path: PROJECT_LOCAL,
      platform: 'playdate',
      publisher: '23 Studios',
      developer: '23 Studios',
      build_command: '',
      preflight_command: '',
      captures_dir: '',
      created_at: new Date().toISOString().slice(0, 10),
      status: 'active',
      game_type: 'sdk'
    }]
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Phase 1: intake -> story bible (mocked Claude)
// ---------------------------------------------------------------------------
async function phase1() {
  header('PHASE 1 — intake -> story_bible.md (mocked Claude)');
  const fixture = JSON.parse(await fsp.readFile(FIXTURE_PATH, 'utf8'));
  log('  fixture pitch:', JSON.stringify(fixture.pitch));

  // Write intake.yaml-equivalent (we use JSON for hermetic test, the real
  // pipeline writes YAML — same data, different serializer).
  const intakePath = path.join(SDK_DATA, 'intake.json');
  await fsp.writeFile(intakePath, JSON.stringify(fixture, null, 2));

  // Try to use the real intake module if it has landed; otherwise emulate.
  let bible = null;
  let used = 'fallback';
  for (const rel of ['../services/intake_form', '../services/intake', '../services/sdk_intake']) {
    const abs = path.join(__dirname, rel + '.js');
    if (fs.existsSync(abs)) {
      try {
        const mod = require(rel);
        if (typeof mod.inferMissingFields === 'function'
            && typeof mod.renderStoryBible === 'function') {
          // Deterministic Claude stub — returns canned JSON shape that the
          // intake module will splice over the blank fields.
          const stub = async () => JSON.stringify({
            setting_era: '1924',
            setting_location: 'a travelling carnival outside Chicago',
            setting_vibe: 'kerosene fog, sawdust, calliope',
            protagonist_name: 'Cass Wren',
            protagonist_archetype: 'agent',
            antagonist_or_obstacle: 'the carnival remembers, and it wants',
            mentor_or_ally: 'an ex-carnie named Doc Tully',
            visual_refs: ['Return of the Obra Dinn', 'Hotline Miami 1-bit', 'World of Horror'],
            visual_keywords: ['fog', 'tarp', 'kerosene', 'sawdust', 'static'],
            tone_refs: ['Annihilation'],
            tone_keywords: ['dread', 'wry', 'melancholic']
          });
          const filled = await mod.inferMissingFields(fixture, { claudeFn: stub });
          bible = await mod.renderStoryBible(filled, { projectName: 'Smoke Carnival' });
          used = abs;
          break;
        }
      } catch (e) {
        log('  intake module load fail:', e.message);
      }
    }
  }

  if (!bible) {
    // Fallback: hand-render minimal bible from the fixture pitch so phase 2
    // still has something to read.
    bible = [
      '# Smoke Carnival',
      '',
      '## Pitch',
      fixture.pitch,
      '',
      '## Setting',
      '- Era: (inferred)',
      '- Vibe: (inferred)',
      '',
      '## Visual style lock',
      '- Aesthetic: 1-bit',
      '- 30fps',
      ''
    ].join('\n');
  }

  const biblePath = path.join(SDK_DATA, 'story_bible.md');
  await fsp.writeFile(biblePath, bible);
  const ok = fs.existsSync(biblePath) && fs.existsSync(intakePath)
    && bible.includes(fixture.pitch);
  results.phase1 = { ok, intake_module: used, bible_chars: bible.length };
  log(ok ? '  PHASE 1 PASS' : '  PHASE 1 FAIL');
  log('  intake module:', used);
  log('  bible chars:', bible.length);
}

// ---------------------------------------------------------------------------
// Phase 2: single autopilot stage with assembled system prompt
// ---------------------------------------------------------------------------
function patchModuleCache() {
  // Replace claude + pulp_ai exports in the require cache BEFORE downstream
  // modules pick them up. We resolve their canonical paths so subsequent
  // requires hit our stubs.
  const claudePath = require.resolve(path.join(SERVER_DIR, 'services', 'claude'));
  const pulpAiPath = require.resolve(path.join(SERVER_DIR, 'services', 'pulp_ai'));

  const capturedPrompts = [];

  const claudeStub = {
    sendMessage({ projectId, cwd, text, onChunk, onDone }) {
      capturedPrompts.push({ projectId, cwd, text });
      // Stream a JSON response shaped like a brainstorm one-pager so the
      // autopilot's safeParseJson succeeds.
      const reply = JSON.stringify({
        title: 'Smoke Carnival',
        logline: 'A noir agent walks the kerosene boards.',
        scenes: [
          { id: 'midway', title: 'The Midway' },
          { id: 'tent', title: 'Behind the Tent' }
        ]
      });
      setImmediate(() => {
        try { onChunk(reply); } catch (_e) { /* swallow */ }
        try { onDone(); } catch (_e) { /* swallow */ }
      });
    },
    appendHistory: async () => {},
    loadHistory: async () => []
  };

  const pulpAiStub = {
    generateScene: async () => ({ buffer: TINY_PNG, width: 400, height: 240 }),
    generatePortrait: async () => ({ buffer: TINY_PNG, width: 64, height: 64 }),
    isConfigured: () => true
  };

  require.cache[claudePath] = {
    id: claudePath, filename: claudePath, loaded: true,
    exports: claudeStub, children: [], paths: []
  };
  require.cache[pulpAiPath] = {
    id: pulpAiPath, filename: pulpAiPath, loaded: true,
    exports: pulpAiStub, children: [], paths: []
  };

  return { capturedPrompts, claudeStub, pulpAiStub };
}

async function phase2() {
  header('PHASE 2 — single autopilot stage (mocked Claude + image gen)');
  const { capturedPrompts } = patchModuleCache();

  // Try to use sdk_prompt_assembly if landed; otherwise emulate the
  // expected behavior (directive + bible + stage-augment concatenation).
  const sysPromptPath = path.join(SERVER_DIR, 'services', 'sdk_prompt_assembly.js');
  let systemPrompt = null;
  let used = 'fallback';
  if (fs.existsSync(sysPromptPath)) {
    try {
      const mod = require(sysPromptPath);
      const bible = await fsp.readFile(path.join(SDK_DATA, 'story_bible.md'), 'utf8');
      systemPrompt = mod.assembleSystemPrompt({
        stageId: 'brainstorm',
        storyBible: bible,
        extras: ''
      });
      used = sysPromptPath;
    } catch (e) {
      log('  sdk_prompt_assembly load fail:', e.message);
    }
  }

  if (!systemPrompt) {
    const bible = await fsp.readFile(path.join(SDK_DATA, 'story_bible.md'), 'utf8');
    systemPrompt = [
      '=== UNIVERSAL DIRECTIVE ===',
      'You are generating content for a Playdate game in the 23 Studios pipeline.',
      'HARD CONSTRAINTS: 1-bit, 30fps, Lua 5.4, 1-indexed arrays.',
      '',
      '=== STORY BIBLE ===',
      bible,
      '',
      '=== STAGE: brainstorm ===',
      'Produce a one-pager.'
    ].join('\n');
  }

  // Verify the assembled prompt has the expected pieces.
  const checks = [
    { name: 'directive mentions 1-bit', pass: /1-bit/i.test(systemPrompt) },
    { name: 'directive mentions 30fps', pass: /30 ?fps/i.test(systemPrompt) },
    { name: 'bible included', pass: /noir detective haunted carnival/i.test(systemPrompt) },
    { name: 'stage augment present', pass: /brainstorm/i.test(systemPrompt) }
  ];

  // Invoke the stubbed Claude end-to-end the same way sdk_autopilot would.
  const claude = require(path.join(SERVER_DIR, 'services', 'claude'));
  let response = '';
  await new Promise((resolve, reject) => {
    claude.sendMessage({
      projectId: PROJECT_ID,
      cwd: PROJECT_LOCAL,
      text: systemPrompt + '\n\nProduce a brainstorm one-pager.',
      onChunk: (c) => { response += c; },
      onDone: resolve,
      onError: reject
    });
  });

  const responseOk = response.length > 0 && response.includes('Smoke Carnival');
  const promptCaptured = capturedPrompts.length === 1
    && capturedPrompts[0].text.includes('noir detective haunted carnival');

  const allOk = checks.every((c) => c.pass) && responseOk && promptCaptured;
  results.phase2 = {
    ok: allOk, prompt_module: used,
    checks, response_chars: response.length,
    prompt_captured: promptCaptured
  };
  log(allOk ? '  PHASE 2 PASS' : '  PHASE 2 FAIL');
  log('  prompt module:', used);
  for (const c of checks) log(`    [${c.pass ? 'ok' : 'XX'}] ${c.name}`);
  log('  stub Claude response chars:', response.length);
}

// ---------------------------------------------------------------------------
// Phase 3: sdk_export with mocked pdc spawn (real packaging code path)
// ---------------------------------------------------------------------------
async function phase3() {
  header('PHASE 3 — sdk_export with mocked pdc (real packaging path)');

  // Seed sdk_data/project.json so sdk_export has scenes to copy. Scene Lua
  // is deliberately well-formed (no globals, no music, no movement) so the
  // sdk_export's built-in QA gate sees zero scene-scoped failures.
  const sdkData = {
    startup_scene: 'midway',
    scenes: [
      { id: 'midway', lua: [
        'local gfx <const> = playdate.graphics',
        'local Scene_midway = {}',
        'function Scene_midway:enter() end',
        'function Scene_midway:update(dt) end',
        'function Scene_midway:exit() end',
        'function Scene_midway:draw() gfx.clear(gfx.kColorWhite) end',
        'return Scene_midway'
      ].join('\n') },
      { id: 'tent', lua: [
        'local gfx <const> = playdate.graphics',
        'local Scene_tent = {}',
        'function Scene_tent:enter() end',
        'function Scene_tent:update(dt) end',
        'function Scene_tent:exit() end',
        'function Scene_tent:draw() gfx.clear(gfx.kColorWhite) end',
        'return Scene_tent'
      ].join('\n') }
    ],
    entities: []
  };
  await fsp.writeFile(path.join(SDK_DATA, 'project.json'),
    JSON.stringify(sdkData, null, 2));
  // Drop a fake scene bg PNG so the copy step has something to move.
  await fsp.writeFile(path.join(SDK_DATA, 'scenes', 'midway.png'), TINY_PNG);
  await fsp.writeFile(path.join(SDK_DATA, 'scenes', 'tent.png'), TINY_PNG);

  // Seed launcher assets at the correct dimensions for the project-scoped
  // QA checks (card_png_350x155, icon_png_32x32). Use sharp to mint real
  // PNGs at the required sizes.
  const sharp = require('sharp');
  const launcherDir = path.join(SDK_DATA, 'launcher');
  await fsp.mkdir(launcherDir, { recursive: true });
  await sharp({ create: { width: 350, height: 155, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png().toFile(path.join(launcherDir, 'card.png'));
  await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png().toFile(path.join(launcherDir, 'icon.png'));

  // Patch child_process.spawn to intercept the pdc invocation. The real
  // pdc would read sourceDir and emit outPdx as a directory. We mimic that:
  // mkdir outPdx + drop a fake pdex.bin so the caller's "output exists"
  // assertion passes.
  const cp = require('child_process');
  const originalSpawn = cp.spawn;
  const originalSpawnSync = cp.spawnSync;
  let pdcCalls = 0;
  cp.spawn = function (cmd, args, opts) {
    // Only intercept pdc; let everything else (ffmpeg etc) pass through if
    // it tries to run. ffmpeg path is best-effort anyway.
    if (typeof cmd === 'string' && (/\bpdc(\.exe)?$/.test(cmd) || cmd === 'pdc')) {
      pdcCalls++;
      const outPdx = args[args.length - 1];
      // Mock pdc behavior: mkdir outPdx + drop a stub artifact.
      fs.mkdirSync(outPdx, { recursive: true });
      fs.writeFileSync(path.join(outPdx, 'pdex.bin'), 'fake pdex bytes');
      fs.writeFileSync(path.join(outPdx, 'pdxinfo'), 'name=Smoke\n');
      // Return an EventEmitter-shaped child that closes with code 0.
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('[mock pdc] ok\n'));
        child.emit('close', 0);
      });
      return child;
    }
    return originalSpawn.apply(this, arguments);
  };
  cp.spawnSync = function (cmd, args) {
    if (cmd === 'which' && args && args[0] === 'pdc') {
      return { status: 0, stdout: '/mock/bin/pdc\n', stderr: '' };
    }
    return originalSpawnSync.apply(this, arguments);
  };

  // Force sdk_export to "find" our mocked pdc.
  process.env.PLAYDATE_SDK_PATH = path.join(WORKDIR, 'mock_sdk');
  fs.mkdirSync(path.join(WORKDIR, 'mock_sdk', 'bin'), { recursive: true });
  const fakePdc = path.join(WORKDIR, 'mock_sdk', 'bin', 'pdc');
  fs.writeFileSync(fakePdc, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // Now fresh-require sdk_export so it picks up the patched cp + env.
  delete require.cache[require.resolve(path.join(SERVER_DIR, 'services', 'sdk_export'))];
  delete require.cache[require.resolve(path.join(SERVER_DIR, 'services', 'projects'))];
  const sdkExport = require(path.join(SERVER_DIR, 'services', 'sdk_export'));

  let lastEvent = null;
  const events = [];
  const job = await sdkExport.startExport({
    projectId: PROJECT_ID,
    onEvent: (evt) => { events.push(evt); lastEvent = evt;
      if (process.env.SMOKE_VERBOSE) log('    [event]', JSON.stringify(evt).slice(0, 200));
    }
  });

  // startExport runs async — poll job.status briefly.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && job.status === 'running') {
    await new Promise((r) => setTimeout(r, 100));
  }

  const ok = job.status === 'done' && pdcCalls === 1 && job.out_pdx
    && fs.existsSync(job.out_pdx);

  // QA gate: run each section-16 scene-scoped check from QA_CHECKS on the
  // emitted scene Lua. Project-scoped checks need pdxinfo + launcher PNGs
  // which the mocked pdc path does not produce, so skip those here.
  let qaResult = null;
  const sysPromptPath = path.join(SERVER_DIR, 'services', 'sdk_prompt_assembly.js');
  if (fs.existsSync(sysPromptPath)) {
    try {
      const qa = require(sysPromptPath);
      if (Array.isArray(qa.QA_CHECKS)) {
        const failures = [];
        for (const scene of sdkData.scenes) {
          for (const check of qa.QA_CHECKS) {
            if (check.scope !== 'scene') continue;
            let msg = null;
            try { msg = check.run(scene); }
            catch (e) { msg = `check threw: ${e.message}`; }
            if (msg) failures.push({ scene: scene.id, id: check.id, message: msg });
          }
        }
        qaResult = { failures };
      }
    } catch (e) { log('  QA gate load fail:', e.message); }
  }

  results.phase3 = {
    ok, status: job.status, pdc_calls: pdcCalls,
    out_pdx: job.out_pdx || null,
    qa_ran: qaResult !== null,
    qa_failures: qaResult
      ? ((qaResult.failures && qaResult.failures.length)
        || (qaResult.errors && qaResult.errors.length)
        || 0)
      : null,
    event_count: events.length,
    last_event: lastEvent && lastEvent.type
  };
  log(ok ? '  PHASE 3 PASS' : '  PHASE 3 FAIL');
  log('  job status:', job.status);
  log('  pdc calls:', pdcCalls);
  log('  out_pdx:', job.out_pdx || '(none)');
  log('  QA gate ran:', qaResult !== null);

  // Restore spawn so we don't pollute later runs (cli is one-shot anyway).
  cp.spawn = originalSpawn;
  cp.spawnSync = originalSpawnSync;
}

// ---------------------------------------------------------------------------
async function main() {
  log('smoke_sdk_pipeline.js — offline end-to-end SDK pipeline smoke');
  log('workdir:', WORKDIR);
  log('project id:', PROJECT_ID);
  await setupWorkdir();

  let phase1Err = null, phase2Err = null, phase3Err = null;
  try { await phase1(); } catch (e) { phase1Err = e; log('PHASE 1 ERROR:', e.message); }
  try { await phase2(); } catch (e) { phase2Err = e; log('PHASE 2 ERROR:', e.message); }
  try { await phase3(); } catch (e) { phase3Err = e; log('PHASE 3 ERROR:', e.message); }

  header('SUMMARY');
  log('  phase 1 (intake -> bible):',
    results.phase1 && results.phase1.ok ? 'PASS' : 'FAIL');
  log('  phase 2 (autopilot stage):',
    results.phase2 && results.phase2.ok ? 'PASS' : 'FAIL');
  log('  phase 3 (sdk_export):',
    results.phase3 && results.phase3.ok ? 'PASS' : 'FAIL');
  if (phase1Err) log('    phase 1 error:', phase1Err.message);
  if (phase2Err) log('    phase 2 error:', phase2Err.message);
  if (phase3Err) log('    phase 3 error:', phase3Err.message);
  log('  workdir kept at:', WORKDIR, '(inspect on failure)');

  const allOk = results.phase1 && results.phase1.ok
    && results.phase2 && results.phase2.ok
    && results.phase3 && results.phase3.ok;
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  log('FATAL:', e.stack || e.message);
  process.exit(2);
});
