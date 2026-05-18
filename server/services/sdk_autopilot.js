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

async function runBrainstorm({ pitch, claudeCtx }) {
  const text = await askClaude(claudeCtx,
    'Pitch: ' + pitch + '\n\nFlesh out a one-page brainstorm. Genre, hooks, audience, vibe. Plain text, no markdown.',
    'You are a Playdate game design consultant. Keep it punchy and concrete.'
  );
  return { text };
}

async function runStoryAndScenes({ pitch, brainstorm, claudeCtx }) {
  const text = await askClaude(claudeCtx,
`Pitch: ${pitch}

Brainstorm: ${brainstorm.text}

Output a JSON object with this shape (no markdown, no commentary):
{
  "outline": "3-5 sentence story outline",
  "startup_scene": "scene_id of the first scene",
  "scenes": [
    {
      "id": "snake_case_id",
      "name": "Human Name",
      "description": "What the player sees in the BACKGROUND ONLY. Be concrete about the 1-bit pixel-art environment: architecture, props, lighting, dither pattern. CRITICAL: do NOT describe any human figure, character, player, NPC, or person in the background — the player + NPCs are rendered as separate sprites on top. The background is the EMPTY ROOM / scene only.",
      "style_reference": "Optional name of a HAKCD reference asset to anchor style: one of bedroom, bbs_chat_close, chat, coins_inventory, haxheadroom_minigame, lockpicking_minigme, lockpicking_target, menu, powerglove_hacking, powerglove_menu, room3, seckc, title, or null."
    }
  ]
}

Generate 5-10 scenes total. Include a title scene first, then 4-9 gameplay scenes. Backgrounds are EMPTY environments only — no characters visible in any scene PNG.`,
    'You output STRICT JSON only. No prose outside the JSON block.'
  );
  const parsed = safeParseJson(text);
  if (!parsed) throw new Error('story stage: JSON parse failed');
  return parsed;
}

async function runCharacters({ pitch, story, claudeCtx }) {
  const text = await askClaude(claudeCtx,
`Pitch: ${pitch}
Story outline: ${story.outline}
Scenes: ${(story.scenes || []).map((s) => s.name).join(', ')}

Output STRICT JSON only:
{
  "characters": [
    {
      "id": "snake_case_id",
      "name": "Human Name",
      "role": "protagonist|antagonist|npc|mentor|ally",
      "bio": "1-2 sentence character backstory",
      "portrait_prompt": "Visual description for 1-bit portrait — focus on silhouette + 1-2 defining features"
    }
  ]
}

Generate 3-6 characters. Include a protagonist.`,
    'You output STRICT JSON only.'
  );
  const parsed = safeParseJson(text);
  if (!parsed) throw new Error('characters stage: JSON parse failed');
  return parsed;
}

// Generate each scene's 400x240 background PNG via pulp_ai.generateScene.
async function runSceneBursts({ projectId, sdkRoot, sdk, ctx, emit: ev, job }) {
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
      // generateScene returns { pngBuffer } (400x240 1-bit, sanitized).
      // EXPLICIT 'no character' clause — player + NPCs are sprite-layer entities.
      const styleRefHint = s.style_reference
        ? ` Match the silhouette + dither density of HAKCD's ${s.style_reference} reference scene.`
        : '';
      const promptText = `${s.name}. ${s.description || ''} ` +
        `IMPORTANT: this is an EMPTY scene background — NO human figure, NO player, ` +
        `NO NPC, NO character visible anywhere in the frame. Only architecture, ` +
        `props, lighting, dither textures. The player sprite is rendered on top by ` +
        `the runtime — leave the floor / focal area empty.${styleRefHint}`;
      const r = await pulpAi.generateScene({ prompt: promptText, dim: [400, 240] });
      if (!r.pngBuffer) throw new Error('no png returned');
      await fsp.writeFile(destPng, r.pngBuffer);
      ev('asset', { kind: 'scene', id: s.id, bytes: r.pngBuffer.length });
    } catch (e) {
      ev('log', { text: `scene ${s.id} failed: ${e.message}` });
      // Fallback: if a style_reference is set + AI failed, copy + crop the
      // reference PNG directly. Loses character-removal benefit but ships
      // SOMETHING instead of a blank slot.
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

async function runPortraitBursts({ projectId, sdkRoot, characters, emit: ev, job }) {
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
      const r = await pulpAi.generatePortrait({
        prompt: c.portrait_prompt || `${c.name} — ${c.role}`,
        dim: 64
      });
      if (!r.pngBuffer) throw new Error('no png returned');
      await fsp.writeFile(destPng, r.pngBuffer);
      ev('asset', { kind: 'portrait', id: c.id, bytes: r.pngBuffer.length });
    } catch (e) {
      ev('log', { text: `portrait ${c.id} failed: ${e.message}` });
    }
  }
}

function buildSceneLua(scene) {
  const id = scene.id;
  const ident = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
  return [
    `-- scenes/${id}.lua — autopilot-generated SDK scene.`,
    'local gfx <const> = playdate.graphics',
    '',
    `local Scene_${ident} = {}`,
    '',
    `function Scene_${ident}:init(args) self._spawn = args and args.spawn end`,
    `function Scene_${ident}:enter()`,
    `  self._bg = gfx.image.new("assets/scenes/${id}")`,
    `  if audio_manager and audio_manager.play_music then`,
    `    audio_manager.play_music("sounds/${id}", { fade_ms = 250 })`,
    `  end`,
    `end`,
    '',
    `function Scene_${ident}:exit() end`,
    `function Scene_${ident}:update(dt) end`,
    '',
    `function Scene_${ident}:draw()`,
    `  gfx.clear(gfx.kColorWhite)`,
    `  if self._bg then self._bg:draw(0, 0) end`,
    `end`,
    '',
    `function Scene_${ident}:input(evt)`,
    `  -- A: confirm/advance. B: back. autopilot leaves this minimal.`,
    `  if evt == "a" then`,
    `    if audio_manager and audio_manager.play_sfx then audio_manager.play_sfx("select") end`,
    `  end`,
    `end`,
    '',
    `return Scene_${ident}`,
    ''
  ].join('\n');
}

async function runSceneLua({ sdkRoot, sdk, emit: ev }) {
  for (const s of sdk.scenes || []) {
    if (!s || !s.id) continue;
    s.lua = buildSceneLua(s);
    ev('asset', { kind: 'scene_lua', id: s.id, bytes: s.lua.length });
  }
}

async function runSfxBaseline({ sdkRoot, emit: ev }) {
  try {
    const r = sfxSynth.generateBaseline({ destDir: path.join(sdkRoot, 'sfx_baseline') });
    for (const n of Object.keys(r)) ev('asset', { kind: 'sfx', id: n, ms: r[n].ms });
  } catch (e) { ev('log', { text: 'sfx_baseline failed: ' + e.message }); }
}

async function runMusicAssign({ sdkRoot, sdk, emit: ev }) {
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
  const used = new Set();
  for (const s of scenes) {
    const pick = musicLib.pickForScene({ library: r.manifest, scene: s, used });
    if (!pick.trackId) continue;
    used.add(pick.trackId);
    const track = r.manifest.find((t) => t.id === pick.trackId);
    s.bgm_track_id = track.id;
    s.bgm_file = 'sounds/' + path.basename(track.wav);
    // Rename the wav to match scene id so the scene's enter hook resolves.
    const tgt = path.join(destDir, s.id + '.wav');
    try { fs.copyFileSync(track.wav, tgt); } catch (_e) { /* ignore */ }
    ev('asset', { kind: 'bgm', scene_id: s.id, track_id: track.id });
  }
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

      // Bake static project context for prompts.
      const ctx = { project_name: project.name, theme: '', description: pitch };
      const claudeCtx = { projectId: project.id, cwd: project.local_path };

      ev('phase', { id: 'brainstorm' });
      const brainstorm = await runBrainstorm({ pitch, claudeCtx });
      sdk.brainstorm = brainstorm.text;
      await writeSdk(project.local_path, sdk);
      ev('log', { text: 'brainstorm: ' + brainstorm.text.slice(0, 200) + '...' });
      job.summary.stages_complete++;

      ev('phase', { id: 'story' });
      const story = await runStoryAndScenes({ pitch, brainstorm, claudeCtx });
      sdk.outline = story.outline;
      sdk.startup_scene = story.startup_scene || (story.scenes && story.scenes[0] && story.scenes[0].id);
      sdk.scenes = story.scenes || [];
      await writeSdk(project.local_path, sdk);
      ev('log', { text: 'story: ' + sdk.scenes.length + ' scenes; startup=' + sdk.startup_scene });
      job.summary.stages_complete++;

      ev('phase', { id: 'characters' });
      const chars = await runCharacters({ pitch, story, claudeCtx });
      sdk.characters = chars.characters || [];
      await writeSdk(project.local_path, sdk);
      ev('log', { text: 'characters: ' + sdk.characters.length });
      job.summary.stages_complete++;

      ev('phase', { id: 'scene_bursts' });
      await runSceneBursts({ projectId, sdkRoot, sdk, ctx, emit: ev, job });
      job.summary.stages_complete++;

      ev('phase', { id: 'portrait_bursts' });
      await runPortraitBursts({ projectId, sdkRoot, characters: sdk.characters, emit: ev, job });
      job.summary.stages_complete++;

      ev('phase', { id: 'scene_lua' });
      await runSceneLua({ sdkRoot, sdk, emit: ev });
      await writeSdk(project.local_path, sdk);
      job.summary.stages_complete++;

      ev('phase', { id: 'sfx' });
      await runSfxBaseline({ sdkRoot, emit: ev });
      job.summary.stages_complete++;

      ev('phase', { id: 'music' });
      await runMusicAssign({ sdkRoot, sdk, emit: ev });
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
