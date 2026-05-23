'use strict';

// sdk_autopilot.js — autopilot driver for game_type='sdk' projects.
//
// Stages (each writes into <project>/sdk_data/):
//   1. brainstorm       — Claude one-pager
//   2. story            — short outline + scene list (5-10 scenes)
//   3. characters       — 3-6 NPCs with name/role/bio/portrait_prompt
//   4. world            — scene_meta per scene (theme, mood, props)
//   5. scene_bursts     — generate each scene's 400x240 background PNG via
//                         pulp_ai.generateScene (already 1-bit + sanitized)
//   6. portrait_bursts  — generate character portrait PNGs (64x64)
//   7. scene_lua        — emit per-scene Lua module that draws the bg +
//                         spawns the entities the scene mentions
//   8. sfx              — sfx_synth baseline 6 procedural WAVs
//   9. music            — seed library + assign per-scene WAV
//
// Output: <project>/sdk_data/project.json with full scene + entity tree.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projects = require('./projects');
const pulpAi = require('./pulp_ai');
const sfxSynth = require('./sfx_synth');
const musicLib = require('./music_library');
const claude = require('./claude');
const spec = require('./playdate_spec');
const assembly = require('./sdk_prompt_assembly');
const assetLibrary = require('./asset_library');
const mvpAutopilot = require('./mvp_autopilot');
const designCompiler = require('./sdk_design_compiler');
const sdkReviewBoard = require('./sdk_review_board');
const assetBatches = require('./sdk_asset_batches');
const bibleParser = require('./story_bible_parser');

const SDK_DATA_REL = 'sdk_data';

// Canonical Playdate-side runtime modules. Staged into <project>/source/runtime/
// by wireSourceTree so every emitted scene can `import "runtime/scene_manager"`
// etc. Mirrors sdk_export.js:32.
const RUNTIME_DIR = path.join(__dirname, 'sdk_runtime_lua');

function emit(onEvent, evt, data) {
  if (typeof onEvent === 'function') {
    try { onEvent(evt, data); } catch (_e) { /* ignore */ }
  }
}

// Instrumented asset write. Wraps fsp.writeFile so a permission/space/path
// failure produces:
//   1. an SSE log line ('asset_write_FAILED ...')
//   2. an SSE 'error' event with kind='asset_write'
//   3. a JSONL post-mortem at <localPath>/asset_write_errors.jsonl
//   4. a re-thrown error — the stage halts instead of silently continuing
//
// The post-write 'asset' event MUST be emitted by callers AFTER this resolves,
// so 'asset' on the wire becomes proof of disk persistence (not just of LLM
// response). Returns true on success, throws on failure.
async function writeAssetBuffer(destPath, buffer, ev, ctx = {}) {
  const { stage, kind, assetId, sdkRoot } = ctx;
  const localPath = sdkRoot ? path.dirname(sdkRoot) : null;
  try {
    await fsp.writeFile(destPath, buffer);
    ev('log', { text: `asset_write_ok ${kind || ''}:${assetId || ''} bytes=${buffer.length} path=${destPath}` });
    return true;
  } catch (err) {
    ev('log', { text: `asset_write_FAILED ${kind || ''}:${assetId || ''} bytes=${buffer.length} code=${err.code} msg=${err.message}` });
    ev('error', { kind: 'asset_write', stage, assetKind: kind, assetId,
                  path: destPath, message: err.message, code: err.code });
    if (localPath) {
      try {
        await fsp.appendFile(
          path.join(localPath, 'asset_write_errors.jsonl'),
          JSON.stringify({
            ts: Date.now(), stage, kind, assetId,
            path: destPath, bytes: buffer.length,
            error: err.message, code: err.code, stack: err.stack
          }) + '\n'
        );
      } catch (_e) { /* secondary log failure — let the primary throw bubble */ }
    }
    throw err;
  }
}

// Fire-and-forget review board sync after each stage. Never fails the stage.
function syncReviewBoard(projectId, sdkRoot) {
  sdkReviewBoard.sync(projectId, sdkRoot).catch((_e) => { /* non-fatal */ });
}

// Fire-and-forget bible snapshot after each autopilot stage. Gives the diff
// service a baseline to compare against so incremental regen knows what changed.
const bibleDiff = require('./sdk_bible_diff');
function snapshotBible(localPath) {
  bibleDiff.snapshot(localPath).catch((_e) => { /* non-fatal */ });
}

function ensureDirs(localPath) {
  const root = path.join(localPath, SDK_DATA_REL);
  for (const sub of ['', 'scenes', 'characters', 'sfx_baseline', 'scene_music', 'concepts', 'gates']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

// Load the project's story bible (sdk_data/story_bible.md) if present. The
// bible is prepended to EVERY Claude prompt so generated content stays in
// world. Truncated to 16k chars to keep prompts under context cap.
function readStoryBible(localPath) {
  const fp = path.join(localPath, SDK_DATA_REL, 'story_bible.md');
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, 'utf8');
  // Cap aggressively so each Claude call has room for stage-specific prompt
  // + accumulated prior-stage outputs. The bible itself rarely exceeds 20k.
  return raw.length > 16000 ? raw.slice(0, 16000) + '\n\n[... bible truncated to 16k chars ...]' : raw;
}

// Phase 4.7: parse the FULL (not truncated) bible into typed sections so
// individual stages can pluck cast/scenes/acts directly instead of asking
// Claude to re-parse markdown. Read the untruncated version off disk; the
// parser doesn't care about size and per-stage prompts can pick the slices
// they need. Returns null if no bible on disk.
//
// Per-stage adopters: future refactors should drop the storyBible string
// concat where structured data suffices (e.g. characters stage can hand
// Claude `parsedBible.cast` as JSON rather than the full markdown bible).
// Until that lands the parsed object travels ALONGSIDE the markdown — no
// behavior change for stages that haven't opted in yet.
function readParsedBible(localPath) {
  const fp = path.join(localPath, SDK_DATA_REL, 'story_bible.md');
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    return bibleParser.parseBible(raw);
  } catch (_e) {
    return null;
  }
}

// Extract a small vars bag from the bible markdown so {bible.primary_dither}
// + similar placeholders in stage augments resolve. Tolerant of missing
// fields — returns whatever it can parse.
function parseBibleVars(bible) {
  const out = {};
  if (!bible) return out;
  const pairs = [
    ['primary_dither',   /Primary dither:\s*([^\n(]+)/i],
    ['secondary_dither', /Secondary dither:\s*([^\n(]+)/i],
    ['tertiary_dither',  /Tertiary:\s*([^\n(]+)/i],
    ['era',              /Era:\s*([^\n]+)/i],
    ['location',         /Location:\s*([^\n]+)/i],
    ['vibe',             /Vibe:\s*([^\n]+)/i],
  ];
  for (const [k, re] of pairs) {
    const m = bible.match(re);
    if (m) out[k] = m[1].trim();
  }
  return out;
}

function bibleSystem(storyBible) {
  if (!storyBible) return '';
  return [
    '=== STORY BIBLE (authoritative game world — every response MUST stay in-world) ===',
    storyBible,
    '=== END STORY BIBLE ===',
    '',
    'You are generating content for the game described in the bible above.',
    'Names, setting, characters, factions, antagonists, year, geography —',
    'all of it must match. Do NOT invent new years, new mentors, new',
    'antagonists, new factions. Bible is canon.'
  ].join('\n');
}

async function readSdk(localPath) {
  const fp = path.join(localPath, SDK_DATA_REL, 'project.json');
  if (!fs.existsSync(fp)) return { scenes: [], characters: [], startup_scene: null };
  return JSON.parse(await fsp.readFile(fp, 'utf8'));
}

async function writeSdk(localPath, data) {
  const fp = path.join(localPath, SDK_DATA_REL, 'project.json');
  await fsp.writeFile(fp, JSON.stringify(data, null, 2));
}

// Promise wrapper around claude.sendMessage (callback-based).
// Requires a valid project + cwd (the project's local_path).
function askClaude({ projectId, cwd }, prompt, system = '') {
  return new Promise((resolve, reject) => {
    let acc = '';
    const text = (system ? system + '\n\n' : '') + prompt;
    claude.sendMessage({
      projectId, cwd, text,
      onChunk: (c) => { acc += c; },
      onDone: () => resolve(acc),
      onError: reject
    });
  });
}

function safeParseJson(text) {
  // Claude often wraps JSON in ```json fences. Extract first {...} block.
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = m ? m[1] : text;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  // Try to find first balanced { ... }.
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++;
    else if (candidate[i] === '}') {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try { return JSON.parse(slice); } catch (_e) { return null; }
      }
    }
  }
  return null;
}

const TONE_SEEDS = [
  'darker / more grounded',
  'whimsical / lighthearted',
  'mysterious / atmospheric',
];

// runBrainstorm — fan-out to 3 parallel Claude calls, one per tone seed.
// Writes concept_01/02/03.json + cards.md + concept_pick gate file.
// Returns { concepts: [...], gate: 'concept_pick' }.
async function runBrainstorm({ pitch, claudeCtx, storyBible, intake, localPath }) {
  const sys = assembly.assembleSystemPrompt({
    stageId: 'brainstorm',
    activePicks: claudeCtx.activePicks,
    storyBible,
    vars: { intake: intake || {} },
    extras: 'You are a Playdate game design consultant. Keep it punchy and concrete. ' +
            'Respond ONLY with a JSON object matching: ' +
            '{ "title_suggestion": string, "genre": string, "mechanic_hook": string, "pitch_text": string }'
  });

  const conceptsDir = path.join(localPath, SDK_DATA_REL, 'concepts');
  const gatesDir = path.join(localPath, SDK_DATA_REL, 'gates');

  const results = await Promise.all(TONE_SEEDS.map(async (seed, i) => {
    const n = i + 1;
    const id = `concept_0${n}`;
    const text = await askClaude(claudeCtx,
      `Pitch: ${pitch}\n\nTone direction: ${seed}\n\n` +
      'Flesh out a one-page concept tied to this tone. Output STRICT JSON only, no prose outside the JSON block.',
      sys
    );
    const parsed = safeParseJson(text) || {};
    const concept = {
      id,
      tone_seed: seed,
      pitch_text: parsed.pitch_text || text.slice(0, 1000),
      title_suggestion: parsed.title_suggestion || '',
      genre: parsed.genre || '',
      mechanic_hook: parsed.mechanic_hook || '',
    };
    await fsp.writeFile(path.join(conceptsDir, id + '.json'), JSON.stringify(concept, null, 2));
    return concept;
  }));

  // Human-readable cards.md for all 3 concepts.
  const cardsLines = results.map((c) => [
    `## ${c.id}: ${c.title_suggestion || '(untitled)'}`,
    `**Tone:** ${c.tone_seed}  |  **Genre:** ${c.genre}  |  **Mechanic:** ${c.mechanic_hook}`,
    '',
    c.pitch_text,
    '',
  ].join('\n'));
  await fsp.writeFile(
    path.join(conceptsDir, 'cards.md'),
    '# Concept Cards\n\n' + cardsLines.join('\n---\n\n')
  );

  // Gate file — blocks downstream until user picks.
  const gate = {
    status: 'awaiting_pick',
    concepts: results.map((c) => c.id),
    chosen: null,
    hybridized_from: null,
  };
  await fsp.writeFile(path.join(gatesDir, 'concept_pick.json'), JSON.stringify(gate, null, 2));

  return { concepts: results, gate: 'concept_pick' };
}

// Read concept gate + resolve chosen concept text. Returns null if gate
// is not yet locked (caller should halt the run).
async function resolveConceptGate(localPath) {
  const gatePath = path.join(localPath, SDK_DATA_REL, 'gates', 'concept_pick.json');
  if (!fs.existsSync(gatePath)) return null;
  const gate = JSON.parse(await fsp.readFile(gatePath, 'utf8'));
  if (!gate.chosen) return null;
  const conceptPath = path.join(localPath, SDK_DATA_REL, 'concepts', gate.chosen + '.json');
  if (!fs.existsSync(conceptPath)) return null;
  const concept = JSON.parse(await fsp.readFile(conceptPath, 'utf8'));
  return { gate, concept };
}

// Backfill story scene fields added in section 5 (type/mood/music_intent/
// mechanic_kit/custom_spec/exits) when an older or terse Claude response
// omits them. Default sensibly so downstream stages do not break.
function backfillStoryScene(scene, idx, total) {
  if (!scene || typeof scene !== 'object') return scene;
  const isTitle = idx === 0;
  if (!scene.type) scene.type = isTitle ? 'cutscene' : 'explore';
  if (!scene.mood) scene.mood = isTitle ? 'expectant' : 'neutral';
  if (!scene.music_intent) scene.music_intent = 'ambient bed, low presence';
  if (scene.mechanic_kit === undefined) scene.mechanic_kit = null;
  if (scene.custom_spec === undefined) scene.custom_spec = null;
  if (!Array.isArray(scene.exits)) scene.exits = [];
  if (scene.style_reference === undefined) scene.style_reference = null;
  return scene;
}

async function runStoryAndScenes({ pitch, brainstorm, claudeCtx, storyBible, intake }) {
  const sys = assembly.assembleSystemPrompt({
    stageId: 'story',
    activePicks: claudeCtx.activePicks,
    storyBible,
    vars: { intake: intake || { scene_count: 8, minigame_count: 2 } },
    extras: 'You output STRICT JSON only. No prose outside the JSON block.'
  });
  const sceneCount = (intake && intake.scene_count) || 8;
  const text = await askClaude(claudeCtx,
`Pitch: ${pitch}

Brainstorm: ${brainstorm.text}

Output JSON matching the schema in the stage augment above. Generate
${sceneCount} scenes total. Include a title scene first. Scene ids +
names + descriptions MUST come from the story bible's act breakdown.

No markdown fences in your response.`,
    sys
  );
  const parsed = safeParseJson(text);
  if (!parsed) throw new Error('story stage: JSON parse failed');
  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  parsed.scenes = scenes.map((s, i) => backfillStoryScene(s, i, scenes.length));
  return parsed;
}

async function runCharacters({ pitch, story, claudeCtx, storyBible, intake }) {
  const baseExtras = 'You output STRICT JSON only.';
  const retryExtras = baseExtras +
    ' Your previous reply was NOT parseable JSON. Output ONLY a single JSON object ' +
    '{ "characters": [...] } with no prose, no commentary, no markdown fences. ' +
    'Begin the response with `{` and end with `}`.';
  const userPrompt =
`Pitch: ${pitch}
Story outline: ${story.outline}
Scenes: ${(story.scenes || []).map((s) => s.name).join(', ')}

Output JSON matching the schema in the stage augment above. Generate
3-6 characters. The protagonist + antagonist + mentor MUST match the
bible's named cast. Every character.portrait_prompt MUST contain the
character's visual_anchor string verbatim.`;

  // 3-attempt retry — Claude variance on JSON output is the leading cause
  // of pipeline crashes. Each retry uses a sterner system extras.
  let parsed = null;
  let lastText = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    const sys = assembly.assembleSystemPrompt({
      stageId: 'characters',
      activePicks: claudeCtx.activePicks,
      storyBible,
      vars: { intake: intake || {} },
      extras: attempt === 0 ? baseExtras : retryExtras
    });
    lastText = await askClaude(claudeCtx, userPrompt, sys);
    parsed = safeParseJson(lastText);
  }
  if (!parsed) {
    const preview = (lastText || '').slice(0, 300).replace(/\s+/g, ' ');
    throw new Error('characters stage: JSON parse failed after 3 attempts — preview: ' + preview);
  }
  // Backfill visual_anchor if Claude forgot — derive a stable placeholder
  // from the role so downstream regen + QA pass.
  for (const c of (parsed.characters || [])) {
    if (c && !c.visual_anchor) {
      c.visual_anchor = `${c.role || 'character'} silhouette anchor`;
    }
    if (c && c.portrait_prompt && c.visual_anchor
        && !c.portrait_prompt.includes(c.visual_anchor)) {
      c.portrait_prompt = `${c.visual_anchor}. ${c.portrait_prompt}`;
    }
  }
  return parsed;
}

// Build the image prompt for one scene using section 7's visual lock. The
// stage augment text + bible + universal directive are concatenated for
// pulp_ai.generateScene; the JS layer adds the specific scene's vars.
//
// If `locked` is supplied (MVP vibe-lock manifest), the locked anchors and
// directive are prepended to the brief so every scene inherits the
// approved-MVP style.
function buildSceneBurstPrompt({ scene, storyBible, intake, bibleVars, activePicks, locked }) {
  const styleRefHint = scene.style_reference
    ? ` Match the silhouette + dither density of HAKCD's ${scene.style_reference} reference scene.`
    : '';
  const sys = assembly.assembleSystemPrompt({
    stageId: 'scene_bursts',
    activePicks,
    storyBible,
    vars: { intake: intake || {}, bible: bibleVars || {}, scene }
  });
  // pulp_ai.generateScene takes a single prompt string; we collapse the
  // system block into a leading style brief, then end with the concrete
  // scene line. The image model gets the visual lock + the scene subject.
  const lockPreamble = formatLockPreamble(locked);
  const brief = `${lockPreamble}${scene.name}. ${scene.description || ''} ` +
    `EMPTY scene background — NO human figure, NO player, NO NPC, ` +
    `NO character visible anywhere in the frame. Architecture, props, ` +
    `lighting, dither textures only. The sprite layer is composited on ` +
    `top by the runtime — leave the focal area empty.${styleRefHint}`;
  return { sys, brief };
}

// Render the MVP lock directive + anchor list as a prompt preamble. Empty
// string when no lock exists. Anchor labels are listed so the image model
// understands what it is matching against; output_paths are NOT readable by
// the model but provided for human inspection in the prompt logs.
function formatLockPreamble(locked) {
  if (!locked || !Array.isArray(locked.anchors) || locked.anchors.length === 0) return '';
  const lines = locked.anchors.map((a) =>
    `  - ${a.kind} '${a.target_label || a.target_id}' (ref: ${a.output_path})`);
  return [
    '[MVP-LOCKED ANCHORS]',
    locked.directive || 'Style locked to MVP — match anchors.',
    ...lines,
    '',
    ''
  ].join('\n');
}

// Generate each scene's 400x240 background PNG via pulp_ai.generateScene.
// When opts.skipBatchGates is false (default), splits scenes into 3 batches,
// emits a gate event after each batch, and halts if the gate is not approved.
// Set SKIP_BATCH_GATES=1 env or opts.skipBatchGates=true to use the legacy
// all-at-once behaviour (useful for tests and power users).
async function runSceneBursts({ projectId, sdkRoot, sdk, ctx, emit: ev, job,
                                storyBible, intake, bibleVars, activePicks, locked,
                                skipBatchGates }) {
  const scenes = sdk.scenes || [];
  const useBatches = !skipBatchGates && !process.env.SKIP_BATCH_GATES;

  if (!useBatches) {
    // Legacy path: generate all scenes in one pass.
    for (let i = 0; i < scenes.length; i++) {
      if (job && job.cancelled) break;
      const s = scenes[i];
      if (!s || !s.id) continue;
      const destPng = path.join(sdkRoot, 'scenes', s.id + '.png');
      if (fs.existsSync(destPng)) {
        ev('asset', { kind: 'scene', id: s.id, skipped: 'exists' });
        continue;
      }
      try {
        const { brief } = buildSceneBurstPrompt({
          scene: s, storyBible, intake, bibleVars, activePicks, locked
        });
        const r = await pulpAi.generateScene({
          prompt: brief, dim: [400, 240],
          projectId, sceneId: s.id, stage: 'scene_bursts'
        });
        if (!r.pngBuffer) throw new Error('no png returned');
        await writeAssetBuffer(destPng, r.pngBuffer, ev,
          { stage: 'scene_bursts', kind: 'scene', assetId: s.id, sdkRoot });
        // Sidecar for Phase 4.5 gallery. Best-effort — never block autopilot.
        try {
          await fsp.writeFile(
            destPng.replace(/\.png$/i, '.prompt.json'),
            JSON.stringify({
              prompt: brief,
              model: r.model || null,
              dim: [400, 240],
              createdAt: new Date().toISOString(),
              stage: 'scene_bursts'
            }, null, 2)
          );
        } catch (sidecarErr) {
          ev('log', { text: `scene ${s.id} sidecar write failed: ${sidecarErr.message}` });
        }
        if (r.sourceBuffer) {
          const srcDir = path.join(sdkRoot, 'art_source', 'scenes');
          await fsp.mkdir(srcDir, { recursive: true });
          try {
            await writeAssetBuffer(path.join(srcDir, s.id + '.png'), r.sourceBuffer, ev,
              { stage: 'scene_bursts', kind: 'scene_source', assetId: s.id, sdkRoot });
          } catch (_srcErr) { /* primary already on disk; instrumentation captured details */ }
        }
        // Asset event AFTER disk write confirmed — proof of persistence.
        ev('asset', { kind: 'scene', id: s.id, bytes: r.pngBuffer.length });
      } catch (e) {
        ev('log', { text: `scene ${s.id} failed: ${e.message}` });
        if (s.style_reference) {
          await tryReferenceFallback(s, destPng, ev, sdkRoot);
        }
      }
    }
    return;
  }

  // Batch path: 3 batches with per-batch contact sheets and gate files.
  const batches = assetBatches.planBatches(scenes);

  for (const batch of batches) {
    if (job && job.cancelled) break;

    // Check if this batch gate is already approved (re-entry after a prior run).
    const existingGate = await assetBatches.readBatchGate(sdkRoot, batch.batch_id);
    if (existingGate && existingGate.chosen === 'approved') {
      ev('log', { text: `scene batch ${batch.batch_id}: gate already approved — continuing` });
    } else if (existingGate && existingGate.chosen === 'revise') {
      ev('log', { text: `scene batch ${batch.batch_id}: gate says revise — re-generating` });
    } else if (existingGate && existingGate.chosen === null && existingGate.status === 'awaiting_review') {
      // Gate was written but not yet acted on — halt here and wait.
      ev('gate', { gate: `batch_${batch.batch_id}`, kind: 'scene', status: 'awaiting_review',
                   awaiting_batch: batch.batch_id });
      ev('log', { text: `scene batch ${batch.batch_id}: awaiting review — halting autopilot` });
      return;
    }

    // Build the prompt function for this scene kind.
    const promptFn = (scene) => {
      const { brief } = buildSceneBurstPrompt({
        scene, storyBible, intake, bibleVars, activePicks, locked
      });
      return brief;
    };

    // Attach dim hint so runBatch uses the right size.
    const batchItems = batch.items.map((s) => ({ ...s, _dim: [400, 240] }));

    const manifestInfo = await assetBatches.runBatch(
      projectId, sdkRoot, 'scene',
      { ...batch, items: batchItems },
      { emit: ev, job, promptFn }
    );

    // Write gate file (preserves prior approval if set).
    const gate = await assetBatches.gateForBatch(projectId, sdkRoot, batch.batch_id, manifestInfo);

    // If the gate is already approved (this run re-generated an
    // approved batch), CONTINUE to the next batch — do not halt for
    // re-review of work the human already signed off on.
    if (gate && gate.chosen === 'approved') {
      ev('log', { text: `scene batch ${batch.batch_id}: re-generated under prior approval — continuing` });
      continue;
    }

    ev('gate', {
      gate: `batch_${batch.batch_id}`,
      kind: 'scene',
      batch_id: batch.batch_id,
      status: 'awaiting_review',
      contact_sheet_path: gate.contact_sheet_path,
      manifest_path: gate.manifest_path
    });

    ev('log', { text: `scene batch ${batch.batch_id}: contact sheet ready — awaiting review` });

    // Halt; next run() invocation will find the gate and either continue or revise.
    return;
  }
}

const REFERENCE_DIR = '/home/hakcer/projects/personal/hakcd/hakcd_pixel_collection';

async function tryReferenceFallback(scene, destPng, ev, sdkRoot) {
  try {
    const sharp = require('sharp');
    const refName = scene.style_reference;
    if (!refName) return;
    const candidates = [
      path.join(REFERENCE_DIR, refName + '.png'),
      path.join(REFERENCE_DIR, refName.replace(/[^a-z0-9_]/gi, '') + '.png')
    ];
    const src = candidates.find((p) => fs.existsSync(p));
    if (!src) { ev('log', { text: `reference fallback: ${refName} not found` }); return; }
    // Crop UPPER portion (where backgrounds usually live; characters tend to
    // be lower-center). Cover-fit to 400x240, prefer 'north' gravity so we
    // keep architecture / skyline + lose the character at the bottom of the
    // frame where they typically stand.
    const buf = await sharp(src)
      .resize(400, 240, { fit: 'cover', position: 'north', kernel: 'lanczos3' })
      .greyscale()
      .threshold(128)
      .toColourspace('b-w')
      .png()
      .toBuffer();
    await writeAssetBuffer(destPng, buf, ev,
      { stage: 'scene_bursts_fallback', kind: 'scene_ref_fallback', assetId: scene.id, sdkRoot });
    // Asset event AFTER disk write confirmed.
    ev('asset', { kind: 'scene_ref_fallback', id: scene.id, ref: refName, bytes: buf.length });
  } catch (e) {
    ev('log', { text: `reference fallback failed for ${scene.id}: ${e.message}` });
  }
}

async function runPortraitBursts({ projectId, sdkRoot, characters, emit: ev, job, activePicks,
                                   storyBible, intake, bibleVars, skipBatchGates }) {
  const useBatches = !skipBatchGates && !process.env.SKIP_BATCH_GATES;

  if (!useBatches) {
    // Legacy path.
    for (let i = 0; i < characters.length; i++) {
      if (job && job.cancelled) break;
      const c = characters[i];
      if (!c || !c.id) continue;
      const destPng = path.join(sdkRoot, 'characters', c.id + '.png');
      if (fs.existsSync(destPng)) {
        ev('asset', { kind: 'portrait', id: c.id, skipped: 'exists' });
        continue;
      }
      try {
        const anchor = c.visual_anchor || `${c.role || 'character'} anchor`;
        let promptText = (c.portrait_prompt && c.portrait_prompt.includes(anchor))
          ? c.portrait_prompt
          : `${anchor}. ${c.portrait_prompt || (c.name + ' - ' + c.role)}`;

        // Phase 4.7.4: per-character portrait overrides for real-person anchors.
        // cory_k is the project owner (real human, SecKC organizer) — the
        // generic generator keeps producing wrong faces. Override prepends
        // a specific-person prompt + signals pulp_ai to attach the cory_k
        // photo references at max weight via the manifest's per-character
        // entry (sdk_data/asset_library/references_manifest.json
        // portrait_references.cory_k).
        const PORTRAIT_OVERRIDES = {
          cory_k: {
            prepend: 'CRITICAL: Subject is a STYLIZED PORTRAIT of a specific stocky broad-shouldered white man 35-45. THE DEFINING FEATURE IS A FULL THICK BUSHY MUSTACHE that curves down past the corners of the mouth — never a goatee, never a thin moustache, never clean-shaven. Black flat-brim ball cap (Hurley-style) pulled low. Light beard scruff on chin and jaw only. Strong serious brow, direct intense gaze. Render in 1-bit Playdate aesthetic like a Mars After Midnight character card. The mustache is non-negotiable and must be the dominant facial feature.'
          }
        };
        const override = PORTRAIT_OVERRIDES[c.id];
        if (override) {
          promptText = override.prepend + '\n\n' + promptText;
        }

        const r = await pulpAi.generatePortrait({
          prompt: promptText, dim: 64,
          projectId, sceneId: c.id, stage: 'portrait_bursts',
          tags: [c.id]   // hint pulp_ai to look up portrait_references[c.id] before falling back to .default
        });
        if (!r.pngBuffer) throw new Error('no png returned');
        await writeAssetBuffer(destPng, r.pngBuffer, ev,
          { stage: 'portrait_bursts', kind: 'portrait', assetId: c.id, sdkRoot });
        // Sidecar for Phase 4.5 gallery. Best-effort — never block autopilot.
        try {
          await fsp.writeFile(
            destPng.replace(/\.png$/i, '.prompt.json'),
            JSON.stringify({
              prompt: promptText,
              model: r.model || null,
              dim: [64, 64],
              createdAt: new Date().toISOString(),
              stage: 'portrait_bursts'
            }, null, 2)
          );
        } catch (sidecarErr) {
          ev('log', { text: `portrait ${c.id} sidecar write failed: ${sidecarErr.message}` });
        }
        if (r.sourceBuffer) {
          const srcDir = path.join(sdkRoot, 'art_source', 'characters');
          await fsp.mkdir(srcDir, { recursive: true });
          try {
            await writeAssetBuffer(path.join(srcDir, c.id + '.png'), r.sourceBuffer, ev,
              { stage: 'portrait_bursts', kind: 'portrait_source', assetId: c.id, sdkRoot });
          } catch (_srcErr) { /* primary already on disk; instrumentation captured details */ }
        }
        // Asset event AFTER disk write confirmed — proof of persistence.
        ev('asset', { kind: 'portrait', id: c.id, bytes: r.pngBuffer.length });
      } catch (e) {
        ev('log', { text: `portrait ${c.id} failed: ${e.message}` });
      }
    }
    return;
  }

  // Batch path: 3 batches with contact sheets + gate files.
  // Portrait batch gates use 'pb1'/'pb2'/'pb3' to avoid colliding with scene batches.
  const batches = assetBatches.planBatches(characters).map((b) => ({
    ...b,
    batch_id: 'p' + b.batch_id   // pb1, pb2, pb3
  }));

  const promptFn = (c) => {
    const anchor = c.visual_anchor || `${c.role || 'character'} anchor`;
    return (c.portrait_prompt && c.portrait_prompt.includes(anchor))
      ? c.portrait_prompt
      : `${anchor}. ${c.portrait_prompt || (c.name + ' - ' + c.role)}`;
  };

  for (const batch of batches) {
    if (job && job.cancelled) break;

    const existingGate = await assetBatches.readBatchGate(sdkRoot, batch.batch_id);
    if (existingGate && existingGate.chosen === 'approved') {
      ev('log', { text: `portrait batch ${batch.batch_id}: gate already approved — continuing` });
    } else if (existingGate && existingGate.chosen === null && existingGate.status === 'awaiting_review') {
      ev('gate', { gate: `batch_${batch.batch_id}`, kind: 'portrait', status: 'awaiting_review',
                   awaiting_batch: batch.batch_id });
      ev('log', { text: `portrait batch ${batch.batch_id}: awaiting review — halting autopilot` });
      return;
    }

    const manifestInfo = await assetBatches.runBatch(
      projectId, sdkRoot, 'portrait', batch,
      { emit: ev, job, promptFn }
    );

    const gate = await assetBatches.gateForBatch(projectId, sdkRoot, batch.batch_id, manifestInfo);

    if (gate && gate.chosen === 'approved') {
      ev('log', { text: `portrait batch ${batch.batch_id}: re-generated under prior approval — continuing` });
      continue;
    }

    ev('gate', {
      gate: `batch_${batch.batch_id}`,
      kind: 'portrait',
      batch_id: batch.batch_id,
      status: 'awaiting_review',
      contact_sheet_path: gate.contact_sheet_path,
      manifest_path: gate.manifest_path
    });

    ev('log', { text: `portrait batch ${batch.batch_id}: contact sheet ready — awaiting review` });
    return;
  }
}

// Heuristic: 3-7 feature ids picked from the manifest, weighted by the
// scene's description + type. Used when Claude is unavailable or returns
// an unparseable response. Always returns a stable, runnable set.
function pickFeaturesHeuristic(scene, manifest) {
  const desc = String((scene && scene.description) || '').toLowerCase();
  const type = String((scene && scene.type) || 'explore').toLowerCase();
  const features = (manifest && manifest.features) || {};
  const ids = Object.keys(features);
  if (!ids.length) return [];

  const score = (fid) => {
    const entry = features[fid] || {};
    const tags = (entry.tags || []).map((t) => String(t).toLowerCase());
    let s = 0;
    if (tags.includes(type)) s += 4;
    for (const tag of tags) if (desc.includes(tag)) s += 2;
    if (type === 'dialog' && /dialog|input_button_a|text_box/.test(fid)) s += 3;
    if (type === 'minigame' && /score|fail|timer|crank|accel/.test(fid)) s += 3;
    if (type === 'explore' && /sprite|collide|movement/.test(fid)) s += 2;
    if (/^music_/.test(fid)) s += 1;
    return s;
  };
  ids.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  // 3-7 features, biased toward 4-5 for typical scenes.
  const n = Math.max(3, Math.min(7, Math.round(3 + ids.length / 20)));
  return ids.slice(0, n);
}

async function runSceneLua({ sdkRoot, sdk, claudeCtx, storyBible, intake,
                             bibleVars, emit: ev, job }) {
  const manifest = assembly.loadFeatureManifest();
  const featureIds = manifest && manifest.features
    ? Object.keys(manifest.features) : [];
  if (!featureIds.length) {
    ev('log', { text: 'scene_lua: no feature_manifest.seed.json — using basic template' });
  }

  // Run the design compiler once before iterating scenes.  The compiled
  // design gives each scene's Lua emitter a validated game model: room exits,
  // the puzzle DAG it participates in, and the state flags it can read/write.
  // This is the "magic layer" (Step 3 of canonical workflow) that prevents
  // runSceneLua from freestyling into broken code.
  let compiled = null;
  try {
    compiled = await designCompiler.compile(claudeCtx.projectId, sdkRoot);
    const warnCount = (compiled.compiler_warnings || []).length;
    ev('log', {
      text: `design_compiler: rooms=${Object.keys(compiled.rooms_graph || {}).length} ` +
            `puzzles=${(compiled.puzzle_dag || []).length} ` +
            `flags=${(compiled.state_flags || []).length} ` +
            `warnings=${warnCount}`
    });
  } catch (e) {
    ev('log', { text: 'design_compiler failed (scene_lua will proceed without compiled context): ' + e.message });
  }

  for (const s of sdk.scenes || []) {
    if (job && job.cancelled) break;
    if (!s || !s.id) continue;
    let featureSet = [];

    if (featureIds.length) {
      // Build the compiled_design context slice for this scene.  Includes the
      // room graph entry (exits + objects), any puzzles the scene participates
      // in, the full state flags list, and save schema so the Lua emitter can
      // write correct save_state.get/set calls.
      const sceneDesign = compiled
        ? designCompiler.compiledSectionForScene(compiled, s.id)
        : {};

      const sys = assembly.assembleSystemPrompt({
        stageId: 'scene_lua',
    activePicks: claudeCtx.activePicks,
        storyBible,
        vars: {
          intake: intake || {},
          bible: bibleVars || {},
          scene: s,
          feature_manifest_ids: featureIds.join(', '),
          compiled_design: sceneDesign
        },
        extras: 'You output STRICT JSON only.'
      });
      try {
        const text = await askClaude(claudeCtx,
          `Pick features for scene "${s.id}" (type=${s.type}). Output STRICT JSON per the schema in the augment.`,
          sys
        );
        const parsed = safeParseJson(text);
        if (parsed && Array.isArray(parsed.feature_set)) {
          featureSet = parsed.feature_set.filter((id) => featureIds.includes(id));
        }
      } catch (e) {
        ev('log', { text: `scene_lua ${s.id} claude failed: ${e.message}` });
      }
      if (!featureSet.length) featureSet = pickFeaturesHeuristic(s, manifest);
      // Clamp to 3-7.
      featureSet = featureSet.slice(0, 7);
      while (featureSet.length < 3 && featureIds.length) {
        for (const fid of featureIds) {
          if (!featureSet.includes(fid)) { featureSet.push(fid); break; }
        }
        if (featureSet.length >= featureIds.length) break;
      }
    }

    // Recipe body from mechanic_kit, if set + ships in manifest.recipes.
    const kit = s.mechanic_kit;
    const recipeBody = (kit && manifest && manifest.recipes
                        && manifest.recipes[kit] && manifest.recipes[kit].body) || '';

    s.feature_set = featureSet;
    s.lua = assembly.buildSceneLuaFromFeatures(s, featureSet, recipeBody);

    // Write to disk so milestone builds (sdk_milestones path) + pdc see it.
    // sdk_export already does this during its own build flow, but milestones
    // is a separate path and must not depend on sdk_export running first.
    try {
      const scenesDir = path.join(claudeCtx.cwd, 'source', 'scenes');
      await fsp.mkdir(scenesDir, { recursive: true });
      await fsp.writeFile(path.join(scenesDir, s.id + '.lua'), s.lua);
    } catch (e) {
      ev('log', { text: `scene_lua write ${s.id}.lua failed: ` + e.message });
    }

    ev('asset', { kind: 'scene_lua', id: s.id,
                  bytes: s.lua.length, features: featureSet });
  }

  // After all scenes emit, regen source/main.lua + wire assets into source/
  // so pdc has a complete tree. Idempotent — safe to re-run.
  try {
    await wireSourceTree(claudeCtx.cwd, sdk, ev);
  } catch (e) {
    ev('log', { text: 'wireSourceTree failed: ' + e.message });
  }
}

// wireSourceTree(localPath, sdk, ev)
// - Regenerates <localPath>/source/main.lua importing all scenes
// - Copies sdk_data/scenes/*.png  -> source/images/scenes/
// - Copies sdk_data/characters/*.png -> source/images/portraits/
// - Copies sdk_data/launcher/*    -> source/launcher/
// - Copies sdk_data/sfx_baseline/*.wav -> source/sounds/sfx/
// - Copies sdk_data/scene_music/<scene_id>.wav -> source/sounds/music/
//   (only files matching a scene id, per sdk_export's bloat-guard policy)
async function wireSourceTree(localPath, sdk, ev) {
  const srcDir = path.join(localPath, 'source');
  await fsp.mkdir(srcDir, { recursive: true });
  await fsp.mkdir(path.join(srcDir, 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(srcDir, 'images', 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(srcDir, 'images', 'portraits'), { recursive: true });
  await fsp.mkdir(path.join(srcDir, 'launcher'), { recursive: true });
  await fsp.mkdir(path.join(srcDir, 'sounds', 'sfx'), { recursive: true });
  await fsp.mkdir(path.join(srcDir, 'sounds', 'music'), { recursive: true });

  // Stage the canonical runtime into source/runtime/ + source/runtime/concepts/.
  // Mirrors sdk_export.js:227. Without this every reference to scene_manager,
  // audio_manager, save_state, etc. resolves to nil on device.
  const runtimeDir = path.join(srcDir, 'runtime');
  await fsp.mkdir(runtimeDir, { recursive: true });
  await fsp.mkdir(path.join(runtimeDir, 'concepts'), { recursive: true });

  // Recursive copy of every .lua under sdk_runtime_lua/ into source/runtime/.
  async function copyRuntimeRecursive(srcRoot, destRoot) {
    const entries = await fsp.readdir(srcRoot, { withFileTypes: true });
    for (const entry of entries) {
      const s = path.join(srcRoot, entry.name);
      const d = path.join(destRoot, entry.name);
      if (entry.isDirectory()) {
        await fsp.mkdir(d, { recursive: true });
        await copyRuntimeRecursive(s, d);
      } else if (entry.isFile() && entry.name.endsWith('.lua')) {
        await fsp.copyFile(s, d);
      }
    }
  }
  await copyRuntimeRecursive(RUNTIME_DIR, runtimeDir);

  // sdk_runtime_lua/main.lua is the canonical bootstrap. Move it to source/main.lua
  // so the autopilot's emitted main.lua (below) can decide whether to replace it.
  const canonicalMainSrc = path.join(runtimeDir, 'main.lua');
  if (fs.existsSync(canonicalMainSrc)) {
    await fsp.rename(canonicalMainSrc, path.join(srcDir, 'main.lua.canonical'));
  }

  // Strip docs that aren't pdc-friendly. Matches sdk_export.js:235.
  const conceptReadme = path.join(runtimeDir, 'concepts', 'README.md');
  if (fs.existsSync(conceptReadme)) {
    await fsp.unlink(conceptReadme).catch(() => {});
  }

  // main.lua — import every scene + boot the startup scene
  const startup = sdk.startup_scene || (sdk.scenes && sdk.scenes[0] && sdk.scenes[0].id) || 'title';
  const sceneIds = (sdk.scenes || []).map((s) => s && s.id).filter(Boolean);
  const mainLua = [
    'import "CoreLibs/object"',
    'import "CoreLibs/graphics"',
    'import "CoreLibs/sprites"',
    'import "CoreLibs/timer"',
    'import "CoreLibs/crank"',
    'import "CoreLibs/animation"',
    '',
    '-- 23studios autopilot-emitted main.lua',
    '-- Regenerated each scene_lua run. Do not hand-edit.',
    '',
    '-- Runtime: self-binds every module to _G via load-once pattern.',
    '-- Order matters: scene_manager must load before any scene that calls it.',
    'import "runtime/save_state"',
    'import "runtime/audio_manager"',
    'import "runtime/animation"',
    'import "runtime/input"',
    'import "runtime/sprite_base"',
    'import "runtime/scene_manager"',
    'import "runtime/scene_transition"',
    '',
    '-- Concepts: load every module that scenes might reference.',
    'import "runtime/concepts/inventory"',
    'import "runtime/concepts/collision"',
    'import "runtime/concepts/interaction"',
    'import "runtime/concepts/debug_overlay"',
    '',
    '-- Scenes: each module self-binds Scene_<id> to _G.',
    ...sceneIds.map((id) => `import "scenes/${id}"`),
    '',
    'local gfx <const> = playdate.graphics',
    'local pd  <const> = playdate',
    '',
    '-- Boot the startup scene through scene_manager.',
    '-- Every frame looks the scene up via scene_manager.current() instead of',
    '-- caching a local. transition_to(...) inside a scene calls scene_manager.replace()',
    '-- which updates the stack the dispatcher reads from.',
    'local startup_scene = _G[' + JSON.stringify('Scene_' + startup) + ']',
    'if not startup_scene then',
    '  error("startup scene Scene_' + startup + ' not loaded -- check imports above")',
    'end',
    'scene_manager.push(startup_scene)',
    '',
    'function pd.update()',
    '  gfx.clear()',
    '  local s = scene_manager.current()',
    '  if s and s.update then s:update() end',
    '  if s and s.draw   then s:draw()   end',
    '  pd.timer.updateTimers()',
    '  gfx.sprite.update()',
    'end',
    '',
    '-- Input translation layer. The scene emitter (sdk_prompt_assembly.js)',
    '-- currently emits switch-style `function Scene_<id>:input(evt)` handlers',
    '-- taking strings like "a", "b", "up". Future emitter revisions may emit',
    '-- named methods (s:AButtonDown). Dispatcher prefers named, falls back to',
    '-- :input(evt).',
    'local INPUT_MAP = {',
    '  AButtonDown = "a",  AButtonUp = "a_up",',
    '  BButtonDown = "b",  BButtonUp = "b_up",',
    '  upButtonDown = "up", downButtonDown = "down",',
    '  leftButtonDown = "left", rightButtonDown = "right",',
    '}',
    '',
    'local function dispatch(name, ...)',
    '  local s = scene_manager.current()',
    '  if not s then return end',
    '  -- Prefer named method (s:AButtonDown) if scene provides it.',
    '  if s[name] then s[name](s, ...); return end',
    '  -- Fallback: legacy switch-style :input(evt) the existing emitter produces.',
    '  local evt = INPUT_MAP[name]',
    '  if evt and s.input then s:input(evt, ...) end',
    'end',
    '',
    'function pd.AButtonDown()     dispatch("AButtonDown")     end',
    'function pd.AButtonUp()       dispatch("AButtonUp")       end',
    'function pd.BButtonDown()     dispatch("BButtonDown")     end',
    'function pd.BButtonUp()       dispatch("BButtonUp")       end',
    'function pd.upButtonDown()    dispatch("upButtonDown")    end',
    'function pd.downButtonDown()  dispatch("downButtonDown")  end',
    'function pd.leftButtonDown()  dispatch("leftButtonDown")  end',
    'function pd.rightButtonDown() dispatch("rightButtonDown") end',
    'function pd.cranked(change, accel) dispatch("cranked", change, accel) end',
    ''
  ].join('\n');
  await fsp.writeFile(path.join(srcDir, 'main.lua'), mainLua);
  ev('asset', { kind: 'main_lua', bytes: mainLua.length });

  // Copy assets
  async function copyDir(srcRel, dstRel, extRe) {
    const src = path.join(localPath, srcRel);
    if (!fs.existsSync(src)) return 0;
    const dst = path.join(srcDir, dstRel);
    await fsp.mkdir(dst, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(src)) {
      if (extRe && !extRe.test(f)) continue;
      const sp = path.join(src, f);
      const stat = fs.statSync(sp);
      if (!stat.isFile()) continue;
      await fsp.copyFile(sp, path.join(dst, f));
      n++;
    }
    return n;
  }
  const sceneCopied  = await copyDir('sdk_data/scenes',       'images/scenes',    /\.(png|gif)$/i);
  const portraitCopied = await copyDir('sdk_data/characters', 'images/portraits', /\.(png|gif)$/i);
  const launcherCopied = await copyDir('sdk_data/launcher',   'launcher',         /\.(png|gif|txt)$/i);
  const sfxCopied    = await copyDir('sdk_data/sfx_baseline', 'sounds/sfx',       /\.(wav|mp3|aiff?)$/i);

  // Music — only copy wavs whose stem matches a scene id, COMPRESS via ffmpeg
  // to mono 96kbps MP3 (~85% size drop). Without this the .pdx balloons to
  // 80MB+ from tracker WAVs (one 21MB drake_basement.wav alone). Mirrors the
  // bloat-guard policy in sdk_export.js.
  const musicSrc = path.join(localPath, 'sdk_data', 'scene_music');
  let musicCopied = 0;
  if (fs.existsSync(musicSrc)) {
    const referenced = new Set(sceneIds);
    const { spawn } = require('child_process');
    const which = (bin) => {
      try { return require('child_process').execFileSync('which', [bin], { encoding: 'utf8' }).trim() || null; }
      catch (_e) { return null; }
    };
    const ffmpegBin = which('ffmpeg');
    for (const f of fs.readdirSync(musicSrc)) {
      if (!/\.wav$/i.test(f)) continue;
      const stem = f.replace(/\.wav$/i, '');
      if (!referenced.has(stem)) continue;
      const src = path.join(musicSrc, f);
      // Skip if source larger than 1MB AND ffmpeg available — compress to MP3
      const stat = fs.statSync(src);
      if (ffmpegBin && stat.size > 1024 * 1024) {
        const destMp3 = path.join(srcDir, 'sounds', 'music', stem + '.mp3');
        try {
          await new Promise((resolve, reject) => {
            const ff = spawn(ffmpegBin, ['-y', '-loglevel', 'error',
              '-i', src, '-ac', '1', '-ar', '44100', '-b:a', '96k', destMp3], { shell: false });
            let err = '';
            ff.stderr.on('data', (b) => { err += b.toString(); });
            ff.on('close', (code) => code === 0 ? resolve()
              : reject(new Error('ffmpeg ' + code + ': ' + err.slice(0, 200))));
          });
          musicCopied++;
          continue;
        } catch (e) {
          ev('log', { text: `music compress ${stem} failed (${e.message}); falling back to wav copy` });
        }
      }
      // Small file OR no ffmpeg — copy wav as-is
      await fsp.copyFile(src, path.join(srcDir, 'sounds', 'music', f));
      musicCopied++;
    }
  }

  // pdxinfo: ensure exists. If missing, write a minimal one — pdc requires it.
  const pdxinfo = path.join(srcDir, 'pdxinfo');
  if (!fs.existsSync(pdxinfo)) {
    const minimal = `name=${path.basename(localPath)}\nauthor=23 Studios\nversion=0.1.0\nbundleID=com.darkcode.${path.basename(localPath)}\nimagePath=launcher/card\n`;
    await fsp.writeFile(pdxinfo, minimal);
  }

  ev('log', { text: `wire_source: scenes=${sceneCopied} portraits=${portraitCopied} ` +
                    `launcher=${launcherCopied} sfx=${sfxCopied} music=${musicCopied}` });
}

// Legacy export kept for tests / external callers — wraps the new path.
function buildSceneLua(scene) {
  return assembly.buildSceneLuaFromFeatures(scene, scene.feature_set || [], '');
}

// Phase 4.7.2 Patch B: per-(scene, NPC) dialogue generation. Walks every
// scene in sdk.scenes, infers the NPC roster either from
// scene.key_npcs (when populated) or by mapping bible CAST entries to
// their act. For each (scene, npc) pair, calls dialogue_generator which
// writes JSON to <local_path>/sdk_data/dialogue/<sid>__<nid>.json plus a
// cache mirror at sdk_data/dialogue_cache/<key>.json. Cached entries
// skip the LLM round-trip — same scene + cast + tone = reuse.
async function runDialogue({ project, sdk, parsedBible, emit: ev }) {
  let dialogueGen;
  try { dialogueGen = require('./dialogue_generator'); }
  catch (e) { ev('log', { text: 'dialogue: generator import failed — skipping: ' + e.message }); return; }

  const localPath = project.local_path;
  const projectId = project.id;
  const scenes = Array.isArray(sdk.scenes) ? sdk.scenes : [];
  const characters = Array.isArray(sdk.characters) ? sdk.characters : [];
  if (scenes.length === 0 || characters.length === 0) {
    ev('log', { text: 'dialogue: no scenes or characters — skipping' });
    return;
  }
  const castById = new Map(characters.map((c) => [c.id, c]));

  // Pull tone-per-act from parsedBible.tone_map if present, else empty
  const toneMap = (parsedBible && parsedBible.tone_map) || {};

  // For each scene, infer NPCs: use scene.key_npcs if present, else
  // distribute the cast across scenes so every character gets at least
  // one dialogue file. Protagonist (newb) gets dialogue in every scene
  // since they're always present. Each other NPC gets at least 1-2 scenes.
  const npcRotation = characters.filter((c) => c.role !== 'protagonist');
  function npcIdsForScene(scene, sceneIdx) {
    if (Array.isArray(scene.key_npcs) && scene.key_npcs.length > 0) {
      return scene.key_npcs.map((x) => x.id || x).filter((id) => castById.has(id));
    }
    const protagonist = characters.find((c) => c.role === 'protagonist');
    const out = [];
    if (protagonist) out.push(protagonist.id);
    // Pick 1-2 NPCs for this scene by rotating through the cast — every
    // NPC eventually appears, distribution stays even across scenes.
    if (npcRotation.length > 0) {
      out.push(npcRotation[sceneIdx % npcRotation.length].id);
      // Second NPC every 3rd scene to fill richer beats
      if (sceneIdx % 3 === 0 && npcRotation.length > 1) {
        out.push(npcRotation[(sceneIdx + 1) % npcRotation.length].id);
      }
    }
    return [...new Set(out)];
  }

  let ok = 0, fail = 0, skipped = 0;
  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const npcIds = npcIdsForScene(scene, si);
    for (const npcId of npcIds) {
      const cast = castById.get(npcId);
      if (!cast) { skipped++; continue; }
      try {
        await dialogueGen.generateDialogue({
          projectId, localPath,
          sceneEntry: scene, castEntry: cast,
          actToneEntry: toneMap[scene.act] || toneMap.default || {},
          ev
        });
        ok++;
      } catch (e) {
        fail++;
        ev('log', { text: `dialogue fail ${scene.id}__${npcId}: ${(e.message || '').slice(0, 120)}` });
      }
    }
  }
  ev('log', { text: `dialogue: ok=${ok} fail=${fail} skipped=${skipped}` });
}

async function runSfxBaseline({ sdkRoot, sdk, claudeCtx, storyBible, intake,
                                bibleVars, emit: ev }) {
  // Always emit the 6 procedural baselines first — they're deterministic
  // and the rest of the runtime expects them.
  try {
    const r = sfxSynth.generateBaseline({ destDir: path.join(sdkRoot, 'sfx_baseline') });
    for (const n of Object.keys(r)) ev('asset', { kind: 'sfx', id: n, ms: r[n].ms });
  } catch (e) { ev('log', { text: 'sfx_baseline failed: ' + e.message }); }

  // Ask Claude for the event_map + extra_oneshots per section 10. We
  // persist the result to sdk.sfx so the export stage can act on it
  // (synth of extras is wolf-recipes' lane; we just collect the recipes).
  try {
    const sys = assembly.assembleSystemPrompt({
      stageId: 'sfx',
    activePicks: claudeCtx.activePicks,
      storyBible,
      vars: { intake: intake || {}, bible: bibleVars || {} },
      extras: 'You output STRICT JSON only.'
    });
    const text = await askClaude(claudeCtx,
      'Pick event_map + extra_oneshots per the schema in the augment above. STRICT JSON.',
      sys
    );
    const parsed = safeParseJson(text);
    if (parsed) {
      sdk.sfx = parsed;
      ev('log', { text: `sfx: event_map ${Object.keys(parsed.event_map || {}).length} + ${(parsed.extra_oneshots || []).length} extras` });
    }
  } catch (e) {
    ev('log', { text: 'sfx claude pass failed (baseline still emitted): ' + e.message });
  }
}

async function runMusicAssign({ sdkRoot, sdk, claudeCtx, storyBible, intake,
                                bibleVars, emit: ev }) {
  let sourceDir = process.env.MUSIC_SOURCE_DIR
    || '/home/hakcer/projects/personal/hakcd/tools/keygenmusic_scraper/downloads/keygenmusic';

  // Phase 4.7.2 Patch C — auto-fetch keygen tracks via the vendored
  // scraper when MUSIC_SOURCE_DIR is missing or empty. Falls through to
  // the existing library matcher; the scraper writes IMA-ADPCM-converted
  // .wav files into <scratchDir>, which seedLocalLibrary then indexes.
  const hasTracks = fs.existsSync(sourceDir) &&
    fs.readdirSync(sourceDir).some((f) => /\.(wav|mp3|mod|s3m|xm|it)$/i.test(f));
  if (!hasTracks && process.env.STUDIO_NO_KEYGEN_MUSIC !== '1') {
    try {
      const kg = require('./music_keygen');
      const tools = kg.toolsAvailable();
      if (!tools.scraper || !tools.python || !tools.openmpt123 || !tools.ffmpeg) {
        ev('log', { text: 'music: keygen tools incomplete (' +
          JSON.stringify(tools) + ') — skipping' });
        return;
      }
      const scratch = path.join('/tmp', 'keygen_work_' + Date.now());
      const destForFetch = path.join(scratch, 'converted');
      ev('log', { text: 'music: fetching keygen tracks → ' + destForFetch });
      const results = await kg.fetchAndConvert({
        destDir: destForFetch,
        scratchDir: scratch,
        limit: Math.max((sdk.scenes || []).length + 5, 8)
      });
      const ok = results.filter((r) => r.output);
      ev('log', { text: `music: keygen fetched ${ok.length}/${results.length} (errors=${results.length - ok.length})` });
      // Build a manifest in the seedLocalLibrary-expected shape: a flat dir
      // of .wav files. Point sourceDir at destForFetch.
      sourceDir = destForFetch;
    } catch (e) {
      ev('log', { text: 'music: keygen fetch failed — ' + (e.message || '').slice(0, 200) });
      return;
    }
  }
  if (!fs.existsSync(sourceDir)) {
    ev('log', { text: 'music: source dir still missing after fetch attempt; skipping' });
    return;
  }
  const destDir = path.join(sdkRoot, 'scene_music');
  const scenes = sdk.scenes || [];
  const limit = Math.max(scenes.length + 5, 6);
  const r = await musicLib.seedLocalLibrary({ destDir, sourceDir, limit });
  ev('log', { text: `music library: ${r.manifest.length} tracks` });

  // Ask Claude for per-scene preferred_keywords (section 11). We then feed
  // those to musicLib.pickForScene to bias selection. If the claude pass
  // fails we fall straight back to scene description matching.
  let assignmentMap = {};
  try {
    const sys = assembly.assembleSystemPrompt({
      stageId: 'music',
    activePicks: claudeCtx.activePicks,
      storyBible,
      vars: { intake: intake || {}, bible: bibleVars || {} },
      extras: 'You output STRICT JSON only.'
    });
    const sceneSummary = scenes.map((s) =>
      `- ${s.id} (${s.type}, mood=${s.mood}, intent=${s.music_intent})`).join('\n');
    const text = await askClaude(claudeCtx,
      `Scenes:\n${sceneSummary}\n\nOutput JSON per the schema in the augment.`,
      sys
    );
    const parsed = safeParseJson(text);
    if (parsed && Array.isArray(parsed.assignments)) {
      for (const a of parsed.assignments) {
        if (a && a.scene_id) assignmentMap[a.scene_id] = a;
      }
      ev('log', { text: `music: claude assignments for ${parsed.assignments.length} scenes` });
    }
  } catch (e) {
    ev('log', { text: 'music claude pass failed; using description-only matching: ' + e.message });
  }

  const used = new Set();
  for (const s of scenes) {
    const hint = assignmentMap[s.id];
    const sceneForPick = hint && hint.preferred_keywords
      ? Object.assign({}, s, { music_keywords: hint.preferred_keywords })
      : s;
    const pick = musicLib.pickForScene({ library: r.manifest, scene: sceneForPick, used });
    if (!pick.trackId) continue;
    used.add(pick.trackId);
    const track = r.manifest.find((t) => t.id === pick.trackId);
    s.bgm_track_id = track.id;
    s.bgm_file = 'sounds/' + path.basename(track.wav);
    const tgt = path.join(destDir, s.id + '.wav');
    try { fs.copyFileSync(track.wav, tgt); } catch (_e) { /* ignore */ }
    ev('asset', { kind: 'bgm', scene_id: s.id, track_id: track.id });
  }
}

// Section 12 — launcher stage. Asks Claude for card/icon/launchImage image
// prompts + optional animation.txt, then generates the 3 PNGs at correct
// dims via pulp_ai.generateScene. Writes them under sdk_data/launcher/.
async function runLauncher({ projectId, sdkRoot, sdk, claudeCtx, storyBible, intake,
                             bibleVars, emit: ev, job }) {
  const dest = path.join(sdkRoot, 'launcher');
  fs.mkdirSync(dest, { recursive: true });

  const sys = assembly.assembleSystemPrompt({
    stageId: 'launcher',
    activePicks: claudeCtx.activePicks,
    storyBible,
    vars: { intake: intake || {}, bible: bibleVars || {} },
    extras: 'You output STRICT JSON only.'
  });
  let prompts = null;
  try {
    const text = await askClaude(claudeCtx,
      'Output card/icon/launchImage prompts + optional animation_txt per the schema in the augment. STRICT JSON.',
      sys
    );
    prompts = safeParseJson(text);
  } catch (e) {
    ev('log', { text: 'launcher claude pass failed: ' + e.message });
  }
  if (!prompts) {
    // Minimal fallback: derive from title scene description.
    const title = (sdk.scenes || []).find((s) => s && s.id) || {};
    prompts = {
      card_prompt: `${title.name || 'Title'}: ${title.description || ''} 350x155, 1-bit pixel art, pure black and pure white only, launcher card, no anti-aliasing.`,
      icon_prompt: 'central game glyph silhouette, 32x32, 1-bit, pure black silhouette on pure white, no anti-aliasing.',
      launch_image_prompt: `${title.name || 'Title'} splash: ${title.description || ''} 400x240, 1-bit pixel art, pure black and pure white only, splash screen, no anti-aliasing.`,
      animation_txt: null,
    };
  }

  const targets = [
    { name: 'card.png',         prompt: prompts.card_prompt,         dim: [350, 155] },
    { name: 'icon.png',         prompt: prompts.icon_prompt,         dim: [32, 32] },
    { name: 'launchImage.png',  prompt: prompts.launch_image_prompt, dim: [400, 240] },
  ];
  for (const t of targets) {
    if (job && job.cancelled) break;
    const out = path.join(dest, t.name);
    if (fs.existsSync(out)) {
      ev('asset', { kind: 'launcher', id: t.name, skipped: 'exists' });
      continue;
    }
    try {
      const r = await pulpAi.generateScene({
        prompt: t.prompt, dim: t.dim,
        projectId, sceneId: t.name, stage: 'launcher'
      });
      if (!r.pngBuffer) throw new Error('no png returned');
      await writeAssetBuffer(out, r.pngBuffer, ev,
        { stage: 'launcher', kind: 'launcher', assetId: t.name, sdkRoot });
      // Sidecar for Phase 4.5 gallery. Best-effort — never block autopilot.
      // Launcher path has no `kind` var in scope; stage is always 'launcher'.
      try {
        await fsp.writeFile(
          out.replace(/\.png$/i, '.prompt.json'),
          JSON.stringify({
            prompt: t.prompt,
            model: r.model || null,
            dim: t.dim,
            createdAt: new Date().toISOString(),
            stage: 'launcher'
          }, null, 2)
        );
      } catch (sidecarErr) {
        ev('log', { text: `launcher ${t.name} sidecar write failed: ${sidecarErr.message}` });
      }
      if (r.sourceBuffer) {
        const srcDir = path.join(sdkRoot, 'art_source', 'launcher');
        await fsp.mkdir(srcDir, { recursive: true });
        try {
          await writeAssetBuffer(path.join(srcDir, t.name), r.sourceBuffer, ev,
            { stage: 'launcher', kind: 'launcher_source', assetId: t.name, sdkRoot });
        } catch (_srcErr) { /* primary already on disk; instrumentation captured details */ }
      }
      // Asset event AFTER disk write confirmed — proof of persistence.
      ev('asset', { kind: 'launcher', id: t.name, bytes: r.pngBuffer.length });
    } catch (e) {
      ev('log', { text: `launcher ${t.name} failed: ${e.message}` });
    }
  }
  if (prompts.animation_txt && typeof prompts.animation_txt === 'string') {
    try {
      await fsp.writeFile(path.join(dest, 'animation.txt'), prompts.animation_txt);
      ev('asset', { kind: 'launcher', id: 'animation.txt',
                    bytes: prompts.animation_txt.length });
    } catch (e) {
      ev('log', { text: 'launcher animation.txt failed: ' + e.message });
    }
  }
  sdk.launcher = { prompts, has_animation: !!prompts.animation_txt };
}

// --- Public ---

const _jobs = new Map();
function isRunning(pid) { return _jobs.has(pid) && _jobs.get(pid).running; }

function startSdkAutopilot({ projectId, pitch, onEvent, skipBatchGates = false, forceRegen = false }) {
  if (isRunning(projectId)) {
    const e = new Error('sdk_autopilot_already_running');
    e.status = 409; e.code = 'autopilot_already_running'; throw e;
  }
  const job = { projectId, pitch, running: true, cancelled: false,
                skipBatchGates: skipBatchGates || !!process.env.SKIP_BATCH_GATES,
                started_at: Date.now(), summary: { stages_complete: 0, stages_failed: 0 } };
  _jobs.set(projectId, job);

  // Wrap emit so we can intercept phase + gate events and store them on the
  // job object — dashboard cards poll getJobSnapshot to render live progress.
  const ev = (kind, data) => {
    if (kind === 'phase' && data && data.id) job.phase = data.id;
    if (kind === 'gate' && data && data.gate) job.awaitingGate = data.gate;
    if (kind === 'done') { job.running = false; job.phase = null; job.awaitingGate = data && data.awaiting_gate || null; }
    if (kind === 'error') { job.running = false; }
    emit(onEvent, kind, data);
  };

  const awaitDone = (async () => {
    try {
      const project = await projects.getProject(projectId);
      if (!project) { ev('error', { message: 'project not found' }); return; }
      if (project.game_type !== 'sdk') {
        ev('error', { message: 'not an sdk project (game_type=' + project.game_type + ')' });
        return;
      }
      const sdkRoot = ensureDirs(project.local_path);
      // Stash localPath on the job so getJobSnapshot can verify gates on disk.
      job.localPath = project.local_path;
      const sdk = await readSdk(project.local_path);
      const storyBible = readStoryBible(project.local_path);
      // Phase 4.7: also parse the bible into typed sections. parsedBible
      // travels alongside the storyBible string and is forwarded to every
      // stage runner. Stages opt in to the typed data as their prompts get
      // refactored — see TODO markers below.
      const parsedBible = readParsedBible(project.local_path);
      if (storyBible) {
        ev('log', { text: `story_bible.md loaded (${storyBible.length} chars) — every stage will receive it as system context` });
      } else {
        ev('log', { text: 'no story_bible.md; running in open-prompt mode' });
      }
      if (parsedBible) {
        const counts = bibleParser.countsFor(parsedBible);
        ev('log', { text: `parsed bible: ${counts.cast} cast · ${counts.scenes} scenes · ${counts.acts} acts · ${counts.beats} beats` });
      }

      // Bake static project context for prompts.
      const ctx = { project_name: project.name, theme: '', description: pitch };
      const claudeCtx = { projectId: project.id, cwd: project.local_path };

      // Phase 3: load active style picks from the asset library and attach to
      // claudeCtx so every run* below can inject them into the system prompt.
      // Empty {} if no picks yet (project hasn't been through the picker).
      try {
        claudeCtx.activePicks = await assetLibrary.getActivePicksWithSpecs(project.id);
        const pickCount = Object.keys(claudeCtx.activePicks || {}).length;
        if (pickCount > 0) {
          ev('log', { text: 'asset_library: ' + pickCount + ' active style picks loaded' });
        }
      } catch (e) {
        ev('log', { text: 'asset_library: load failed (' + e.message + '); proceeding without picks' });
        claudeCtx.activePicks = {};
      }

      // Pull intake + bible vars out of sdk.json / story_bible.md so the
      // assembleSystemPrompt() {placeholders} resolve. sdk.intake is set
      // by the intake form route; if missing, defaults are sane.
      const intake = (sdk && sdk.intake) || {};
      const bibleVars = parseBibleVars(storyBible);

      // MVP vibe-lock: if Cory ran /project/:id/mvp and clicked "Lock vibe",
      // load the locked anchors so every scene_burst inherits the approved
      // style. No lock = full autopilot proceeds without anchors.
      const locked = await mvpAutopilot.readLocked(project.local_path);
      if (locked) {
        ev('log', { text: `mvp_lock: ${locked.anchors.length} anchors will be prepended to every scene prompt (locked_at=${locked.locked_at})` });
      }

      ev('phase', { id: 'brainstorm' });
      // Check if concepts gate is already locked from a prior run. If so, skip
      // re-running the fan-out and go straight to story with the chosen concept.
      let brainstormText;
      const priorGate = await resolveConceptGate(project.local_path);
      if (priorGate) {
        brainstormText = priorGate.concept.pitch_text;
        ev('log', { text: `concept_pick gate locked: using ${priorGate.gate.chosen}` });
        job.summary.stages_complete++;
      } else {
        const brainstorm = await runBrainstorm({
          // TODO(phase4.7): brainstorm could pluck parsedBible.logline as the
          // pitch seed instead of relying on the open-text `pitch` param.
          pitch, claudeCtx, storyBible, parsedBible, intake, localPath: project.local_path
        });
        sdk.concepts_gate = 'concept_pick';
        await writeSdk(project.local_path, sdk);
        ev('gate', { gate: 'concept_pick', concepts: brainstorm.concepts.map((c) => c.id) });
        ev('log', { text: `brainstorm: ${brainstorm.concepts.length} concepts generated — awaiting pick` });
        job.summary.stages_complete++;
        // Gate not yet resolved — halt here. Next run() call re-enters after
        // the user picks and will find the locked gate above.
        ev('done', { summary: job.summary, awaiting_gate: 'concept_pick' });
        return;
      }
      const brainstorm = { text: brainstormText };

      ev('phase', { id: 'story' });
      // Idempotency: if sdk.scenes already populated from a prior run,
      // SKIP the Claude story call. Re-running story stage regenerates
      // scene IDs every time, leaking unused PNGs across runs.
      let story;
      if (Array.isArray(sdk.scenes) && sdk.scenes.length > 0) {
        story = { outline: sdk.outline || '', scenes: sdk.scenes,
                  startup_scene: sdk.startup_scene };
        ev('log', { text: 'story: skipped — ' + sdk.scenes.length + ' scenes already in project.json' });
      } else {
        // TODO(phase4.7): runStoryAndScenes can seed scenes from
        // parsedBible.scenes (already typed: id/code/name/primary_mechanic/
        // exit) and only call Claude to fill gaps + write the outline.
        story = await runStoryAndScenes({ pitch, brainstorm, claudeCtx, storyBible, parsedBible, intake });
        sdk.outline = story.outline;
        sdk.startup_scene = story.startup_scene || (story.scenes && story.scenes[0] && story.scenes[0].id);
        sdk.scenes = story.scenes || [];
        await writeSdk(project.local_path, sdk);
        ev('log', { text: 'story: ' + sdk.scenes.length + ' scenes; startup=' + sdk.startup_scene });
      }
      job.summary.stages_complete++;
      syncReviewBoard(projectId, sdkRoot);
      snapshotBible(project.local_path);

      ev('phase', { id: 'characters' });
      // Same idempotency for characters.
      let chars;
      if (Array.isArray(sdk.characters) && sdk.characters.length > 0) {
        chars = { characters: sdk.characters };
        ev('log', { text: 'characters: skipped — ' + sdk.characters.length + ' already in project.json' });
      } else {
        // TODO(phase4.7): runCharacters can read parsedBible.cast directly
        // (15-entry typed array with name/role/bio/act for HAKCD) and skip
        // the Claude round-trip whenever the bible already enumerates NPCs.
        chars = await runCharacters({ pitch, story, claudeCtx, storyBible, parsedBible, intake });
        sdk.characters = chars.characters || [];
        await writeSdk(project.local_path, sdk);
      }
      ev('log', { text: 'characters: ' + sdk.characters.length });
      job.summary.stages_complete++;
      syncReviewBoard(projectId, sdkRoot);
      snapshotBible(project.local_path);

      ev('phase', { id: 'scene_bursts' });
      // TODO(phase4.7): scene_bursts can pull per-scene visual_anchor from
      // parsedBible.scenes[i] (raw + primary_mechanic + interactables) to
      // build a richer per-scene prompt instead of relying on Claude's
      // story-stage scene summaries.
      await runSceneBursts({ projectId, sdkRoot, sdk, ctx, emit: ev, job,
                             storyBible, parsedBible, intake, bibleVars,
                             activePicks: claudeCtx.activePicks,
                             locked, skipBatchGates: job.skipBatchGates });
      job.summary.stages_complete++;
      syncReviewBoard(projectId, sdkRoot);
      snapshotBible(project.local_path);

      ev('phase', { id: 'portrait_bursts' });
      // TODO(phase4.7): portrait_bursts can use parsedBible.cast bios as
      // visual_anchor seeds — every named NPC already has a one-line
      // description in the source bible.
      await runPortraitBursts({ projectId, sdkRoot, characters: sdk.characters,
                                 emit: ev, job, storyBible, parsedBible,
                                 intake, bibleVars,
                                 activePicks: claudeCtx.activePicks,
                                 skipBatchGates: job.skipBatchGates });
      job.summary.stages_complete++;
      syncReviewBoard(projectId, sdkRoot);
      snapshotBible(project.local_path);

      ev('phase', { id: 'scene_lua' });
      // TODO(phase4.7): scene_lua can read parsedBible.scenes[i].
      // primary_mechanic + exit verbatim instead of asking Claude to invent
      // them — the bible IS the spec for those fields.
      await runSceneLua({ sdkRoot, sdk, claudeCtx, storyBible, parsedBible,
                          intake, bibleVars, emit: ev, job });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;
      syncReviewBoard(projectId, sdkRoot);
      snapshotBible(project.local_path);

      // Phase 4.7.2 Patch B: dialogue stage. For every scene that lists
      // key_npcs (or every NPC inferred from bible CAST entries when the
      // scene field is missing), generate per-(scene, npc) dialogue JSON.
      // Output lands at <local_path>/sdk_data/dialogue/<sid>__<nid>.json
      // and is loaded at runtime by concepts/dialog_tree.lua.
      ev('phase', { id: 'dialogue' });
      await runDialogue({ project, sdk, parsedBible, emit: ev });
      job.summary.stages_complete++;

      ev('phase', { id: 'sfx' });
      // TODO(phase4.7): sfx + music can read parsedBible.tone_map to pick
      // mood per act (Acts 1-2 Larry energy / Act 3 paranoia / Act 4 stakes).
      await runSfxBaseline({ sdkRoot, sdk, claudeCtx, storyBible, parsedBible,
                              intake, bibleVars, emit: ev });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;
      snapshotBible(project.local_path);

      ev('phase', { id: 'music' });
      await runMusicAssign({ sdkRoot, sdk, claudeCtx, storyBible, parsedBible,
                             intake, bibleVars, emit: ev });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;
      snapshotBible(project.local_path);

      ev('phase', { id: 'launcher' });
      await runLauncher({ projectId, sdkRoot, sdk, claudeCtx, storyBible,
                          parsedBible, intake, bibleVars,
                          emit: ev, job });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;
      snapshotBible(project.local_path);

      syncReviewBoard(projectId, sdkRoot);
      ev('done', { summary: job.summary });
    } catch (e) {
      ev('error', { message: e && e.message || String(e), code: e && e.code });
    } finally {
      job.running = false;
      job.ended_at = Date.now();
    }
  })();

  return { job, awaitDone };
}

// CANONICAL stage order — used by dashboard cards + project page to derive
// percent-complete. Mirrors the runX functions in this file.
const STAGES = [
  'brainstorm', 'story', 'characters', 'scene_bursts', 'portrait_bursts',
  'scene_lua', 'sfx', 'music', 'launcher'
];

// Return current job snapshot for a project, or last known state if no
// active job. Reads from in-memory _jobs first, falls back to persisted
// data (project.json + concept gate) so cards still show progress after
// a server restart.
//
// IMPORTANT: awaiting_gate is the LIVE state, not the cached one. We
// always verify against the gate file on disk so that a user clicking
// approve / choose immediately clears the dashboard pill — even though
// the autopilot orchestrator that set awaitingGate has long since
// returned and won't see the approval until next run.
function isGateAwaiting(localPath, gateName) {
  if (!localPath || !gateName) return false;
  try {
    const fp = require('path').join(localPath, 'sdk_data', 'gates', gateName + '.json');
    if (!fs.existsSync(fp)) return false;
    const g = JSON.parse(fs.readFileSync(fp, 'utf8'));
    // Concept gate uses status='locked' once chosen; batch gates use
    // chosen='approved' OR status='approved'. Any non-awaiting state
    // means the human resolved it.
    if (g.status === 'locked' || g.status === 'approved') return false;
    if (g.chosen === 'approved' || g.chosen) return false;
    return true;
  } catch (_e) { return false; }
}

function getJobSnapshot(projectId) {
  const live = _jobs.get(projectId);
  let localPath = null;
  if (live && live.localPath) localPath = live.localPath;
  if (live) {
    const stagesComplete = (live.summary && live.summary.stages_complete) || 0;
    // Check disk before trusting cached awaitingGate.
    let awaitingGate = live.awaitingGate || null;
    if (awaitingGate && !isGateAwaiting(localPath, awaitingGate)) {
      awaitingGate = null;
      live.awaitingGate = null; // cache the cleared state
    }
    return {
      project_id: projectId,
      running: !!live.running,
      phase: live.phase || null,
      stages_complete: stagesComplete,
      stages_total: STAGES.length,
      stages_failed: (live.summary && live.summary.stages_failed) || 0,
      percent: Math.round((stagesComplete / STAGES.length) * 100),
      awaiting_gate: awaitingGate,
      started_at: live.started_at || null,
      cancelled: !!live.cancelled
    };
  }
  return {
    project_id: projectId,
    running: false,
    phase: null,
    stages_complete: 0,
    stages_total: STAGES.length,
    stages_failed: 0,
    percent: 0,
    awaiting_gate: null,
    started_at: null,
    cancelled: false
  };
}

module.exports = {
  startSdkAutopilot,
  isRunning,
  getJobSnapshot,
  STAGES,
  // Phase 4.7: exposed so other services (regen, late-add, tests) can read
  // the same typed bible the autopilot sees without re-implementing the
  // disk-load + parser glue.
  readStoryBible,
  readParsedBible,
  _internals: { buildSceneLua, safeParseJson, runBrainstorm, resolveConceptGate, TONE_SEEDS }
};
