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

const SDK_DATA_REL = 'sdk_data';

function emit(onEvent, evt, data) {
  if (typeof onEvent === 'function') {
    try { onEvent(evt, data); } catch (_e) { /* ignore */ }
  }
}

function ensureDirs(localPath) {
  const root = path.join(localPath, SDK_DATA_REL);
  for (const sub of ['', 'scenes', 'characters', 'sfx_baseline', 'scene_music']) {
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

async function runBrainstorm({ pitch, claudeCtx, storyBible, intake }) {
  const sys = assembly.assembleSystemPrompt({
    stageId: 'brainstorm',
    activePicks: claudeCtx.activePicks,
    storyBible,
    vars: { intake: intake || {} },
    extras: 'You are a Playdate game design consultant. Keep it punchy and concrete.'
  });
  const text = await askClaude(claudeCtx,
    'Pitch: ' + pitch + '\n\nFlesh out a one-page brainstorm tied to the story bible above. Plain text, no markdown.',
    sys
  );
  return { text };
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
  const sys = assembly.assembleSystemPrompt({
    stageId: 'characters',
    activePicks: claudeCtx.activePicks,
    storyBible,
    vars: { intake: intake || {} },
    extras: 'You output STRICT JSON only.'
  });
  const text = await askClaude(claudeCtx,
`Pitch: ${pitch}
Story outline: ${story.outline}
Scenes: ${(story.scenes || []).map((s) => s.name).join(', ')}

Output JSON matching the schema in the stage augment above. Generate
3-6 characters. The protagonist + antagonist + mentor MUST match the
bible's named cast. Every character.portrait_prompt MUST contain the
character's visual_anchor string verbatim.`,
    sys
  );
  const parsed = safeParseJson(text);
  if (!parsed) throw new Error('characters stage: JSON parse failed');
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
async function runSceneBursts({ projectId, sdkRoot, sdk, ctx, emit: ev, job,
                                storyBible, intake, bibleVars, activePicks, locked }) {
  const scenes = sdk.scenes || [];
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
      await fsp.writeFile(destPng, r.pngBuffer);
      // Mirror the pre-dither OpenRouter render under art_source/ so the
      // dashboard card hero, README, store page, etc. can show the high-
      // detail original — not the brutally-dithered 400x240 device PNG.
      if (r.sourceBuffer) {
        const srcDir = path.join(sdkRoot, 'art_source', 'scenes');
        await fsp.mkdir(srcDir, { recursive: true });
        await fsp.writeFile(path.join(srcDir, s.id + '.png'), r.sourceBuffer);
      }
      ev('asset', { kind: 'scene', id: s.id, bytes: r.pngBuffer.length });
    } catch (e) {
      ev('log', { text: `scene ${s.id} failed: ${e.message}` });
      if (s.style_reference) {
        await tryReferenceFallback(s, destPng, ev);
      }
    }
  }
}

const REFERENCE_DIR = '/home/hakcer/projects/personal/hakcd/hakcd_pixel_collection';

async function tryReferenceFallback(scene, destPng, ev) {
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
    await fsp.writeFile(destPng, buf);
    ev('asset', { kind: 'scene_ref_fallback', id: scene.id, ref: refName, bytes: buf.length });
  } catch (e) {
    ev('log', { text: `reference fallback failed for ${scene.id}: ${e.message}` });
  }
}

async function runPortraitBursts({ projectId, sdkRoot, characters, emit: ev, job, activePicks,
                                   storyBible, intake, bibleVars }) {
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
      // Section 8: visual_anchor must lead. Fall back to portrait_prompt or
      // a minimal description if either is missing.
      const anchor = c.visual_anchor || `${c.role || 'character'} anchor`;
      const promptText = (c.portrait_prompt && c.portrait_prompt.includes(anchor))
        ? c.portrait_prompt
        : `${anchor}. ${c.portrait_prompt || (c.name + ' - ' + c.role)}`;
      const r = await pulpAi.generatePortrait({
        prompt: promptText, dim: 64,
        projectId, sceneId: c.id, stage: 'portrait_bursts'
      });
      if (!r.pngBuffer) throw new Error('no png returned');
      await fsp.writeFile(destPng, r.pngBuffer);
      if (r.sourceBuffer) {
        const srcDir = path.join(sdkRoot, 'art_source', 'characters');
        await fsp.mkdir(srcDir, { recursive: true });
        await fsp.writeFile(path.join(srcDir, c.id + '.png'), r.sourceBuffer);
      }
      ev('asset', { kind: 'portrait', id: c.id, bytes: r.pngBuffer.length });
    } catch (e) {
      ev('log', { text: `portrait ${c.id} failed: ${e.message}` });
    }
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

  for (const s of sdk.scenes || []) {
    if (job && job.cancelled) break;
    if (!s || !s.id) continue;
    let featureSet = [];

    if (featureIds.length) {
      const sys = assembly.assembleSystemPrompt({
        stageId: 'scene_lua',
    activePicks: claudeCtx.activePicks,
        storyBible,
        vars: {
          intake: intake || {},
          bible: bibleVars || {},
          scene: s,
          feature_manifest_ids: featureIds.join(', ')
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
    ev('asset', { kind: 'scene_lua', id: s.id,
                  bytes: s.lua.length, features: featureSet });
  }
}

// Legacy export kept for tests / external callers — wraps the new path.
function buildSceneLua(scene) {
  return assembly.buildSceneLuaFromFeatures(scene, scene.feature_set || [], '');
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
  const sourceDir = process.env.MUSIC_SOURCE_DIR
    || '/home/hakcer/projects/personal/hakcd/tools/keygenmusic_scraper/downloads/keygenmusic';
  if (!fs.existsSync(sourceDir)) {
    ev('log', { text: 'music: source dir missing; skipping' });
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
      await fsp.writeFile(out, r.pngBuffer);
      if (r.sourceBuffer) {
        const srcDir = path.join(sdkRoot, 'art_source', 'launcher');
        await fsp.mkdir(srcDir, { recursive: true });
        await fsp.writeFile(path.join(srcDir, t.name), r.sourceBuffer);
      }
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

function startSdkAutopilot({ projectId, pitch, onEvent }) {
  if (isRunning(projectId)) {
    const e = new Error('sdk_autopilot_already_running');
    e.status = 409; e.code = 'autopilot_already_running'; throw e;
  }
  const job = { projectId, pitch, running: true, cancelled: false,
                started_at: Date.now(), summary: { stages_complete: 0, stages_failed: 0 } };
  _jobs.set(projectId, job);

  const ev = (kind, data) => emit(onEvent, kind, data);

  const awaitDone = (async () => {
    try {
      const project = await projects.getProject(projectId);
      if (!project) { ev('error', { message: 'project not found' }); return; }
      if (project.game_type !== 'sdk') {
        ev('error', { message: 'not an sdk project (game_type=' + project.game_type + ')' });
        return;
      }
      const sdkRoot = ensureDirs(project.local_path);
      const sdk = await readSdk(project.local_path);
      const storyBible = readStoryBible(project.local_path);
      if (storyBible) {
        ev('log', { text: `story_bible.md loaded (${storyBible.length} chars) — every stage will receive it as system context` });
      } else {
        ev('log', { text: 'no story_bible.md; running in open-prompt mode' });
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
      const brainstorm = await runBrainstorm({ pitch, claudeCtx, storyBible, intake });
      sdk.brainstorm = brainstorm.text;
      await writeSdk(project.local_path, sdk);
      ev('log', { text: 'brainstorm: ' + brainstorm.text.slice(0, 200) + '...' });
      job.summary.stages_complete++;

      ev('phase', { id: 'story' });
      const story = await runStoryAndScenes({ pitch, brainstorm, claudeCtx, storyBible, intake });
      sdk.outline = story.outline;
      sdk.startup_scene = story.startup_scene || (story.scenes && story.scenes[0] && story.scenes[0].id);
      sdk.scenes = story.scenes || [];
      await writeSdk(project.local_path, sdk);
      ev('log', { text: 'story: ' + sdk.scenes.length + ' scenes; startup=' + sdk.startup_scene });
      job.summary.stages_complete++;

      ev('phase', { id: 'characters' });
      const chars = await runCharacters({ pitch, story, claudeCtx, storyBible, intake });
      sdk.characters = chars.characters || [];
      await writeSdk(project.local_path, sdk);
      ev('log', { text: 'characters: ' + sdk.characters.length });
      job.summary.stages_complete++;

      ev('phase', { id: 'scene_bursts' });
      await runSceneBursts({ projectId, sdkRoot, sdk, ctx, emit: ev, job,
                             storyBible, intake, bibleVars, activePicks: claudeCtx.activePicks,
                             locked });
      job.summary.stages_complete++;

      ev('phase', { id: 'portrait_bursts' });
      await runPortraitBursts({ projectId, sdkRoot, characters: sdk.characters,
                                 emit: ev, job, storyBible, intake, bibleVars, activePicks: claudeCtx.activePicks });
      job.summary.stages_complete++;

      ev('phase', { id: 'scene_lua' });
      await runSceneLua({ sdkRoot, sdk, claudeCtx, storyBible, intake, bibleVars,
                          emit: ev, job });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;

      ev('phase', { id: 'sfx' });
      await runSfxBaseline({ sdkRoot, sdk, claudeCtx, storyBible, intake,
                              bibleVars, emit: ev });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;

      ev('phase', { id: 'music' });
      await runMusicAssign({ sdkRoot, sdk, claudeCtx, storyBible, intake,
                             bibleVars, emit: ev });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;

      ev('phase', { id: 'launcher' });
      await runLauncher({ projectId, sdkRoot, sdk, claudeCtx, storyBible, intake, bibleVars,
                          emit: ev, job });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;

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

module.exports = {
  startSdkAutopilot,
  isRunning,
  _internals: { buildSceneLua, safeParseJson }
};
