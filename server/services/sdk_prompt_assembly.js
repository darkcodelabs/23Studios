'use strict';

// sdk_prompt_assembly.js — Stage prompt assembly for 23 Studios SDK autopilot.
//
// Single source of truth for:
//   - UNIVERSAL_DIRECTIVE      (section 3 of docs/23studios_intake_prompt.md,
//                               prepended to every Claude call)
//   - STAGE_AUGMENTS           (sections 4-12: per-stage instructions appended
//                               after the story bible)
//   - assembleSystemPrompt()   (concatenate directive + bible + stage augment
//                               + caller-supplied extras, with {var} subst.)
//   - buildSceneLuaFromFeatures (deterministic Lua emit for stage 6: combine
//                                feature manifest snippets + mechanic-kit
//                                recipe body into a single scene module)
//
// The text blocks below are intentionally verbatim from the user's master
// intake prompt. Do NOT paraphrase: the autopilot's behavior is tuned against
// the exact wording. If a stage needs tweaking, edit the constant — do not
// wrap it in conditional logic.

const fs = require('fs');
const path = require('path');

// --- Section 3 — Universal directive (verbatim from spec) ----------------

const UNIVERSAL_DIRECTIVE = `You are generating content for a Playdate game in the 23 Studios pipeline.

HARD CONSTRAINTS:
- Playdate display is 400x240, 1-bit (pure black and pure white), 30fps default, 50fps max
- Memory budget is 16MB RAM, 4GB flash
- Lua 5.4 with 32-bit numbers
- Arrays are 1-indexed
- Instance methods use colon syntax (sprite:moveTo), class methods use dot (sprite.update)
- Forward slashes for paths, never backslashes
- All angle values are degrees, not radians
- Coordinates: origin (0,0) is top-left, x increases right, y increases down

QUALITY BAR:
- Specific over abstract: name the dither type, name the easing function, name the SDK API
- Every scene must use at least two Playdate SDK features beyond the basic draw call
- Crank is featured input unless intake says otherwise
- Save state hooks (gameWillTerminate, deviceWillSleep) are present in every game

DO NOT:
- Invent SDK functions that do not exist
- Use require() (use import instead)
- Use grayscale or color in any asset prompt
- Reference Disney, Marvel, copyrighted characters, or named celebrities
- Use em dashes or en dashes (use hyphens)
- Use emoji`;

// --- Sections 4-12 — Per-stage augments ----------------------------------
//
// Each entry is the augmentation block that gets appended to the bible for
// that stage. Placeholders in {curly_braces} are substituted from the `vars`
// arg passed to assembleSystemPrompt. Unknown placeholders are left as-is so
// they're visible in the prompt log instead of silently disappearing.

const STAGE_AUGMENTS = {

  // Section 4 — brainstorm augment
  brainstorm: `STAGE: brainstorm

Job: turn the composer's pitch into a one-page brainstorm tied to the intake
form values. Output is PLAIN TEXT, no markdown. Cover, in this order:

1. Genre + format restatement, with 1 sentence on why it fits the Playdate
   form factor (1-bit display, crank, 4 buttons, accelerometer).
2. Three concrete hooks the player remembers after the credits roll.
3. The audience this is for (one sentence, no demographics jargon).
4. The vibe: pick 5-8 adjectives from the intake's tone_keywords +
   visual_keywords and weave them into 2 sentences.
5. The crank's role in this game ({intake.crank_usage}). Be specific. If
   "central", name the diegetic object the crank IS in-fiction. If
   "decorative", name 1 menu/transition use only.
6. One sentence on what this game is NOT (what you're refusing to do — a
   negative space helps later scene gen stay focused).

Do not invent setting/cast details that contradict the bible. If a field
was left blank in the intake, your inference must be constrained by the
already-filled fields, not invented from whole cloth.`,

  // Section 5 — story augment (the schema bump lives in the JS prompt,
  // this is the stylistic / constraint block)
  story: `STAGE: story + scene list

Output STRICT JSON. No prose outside the JSON. Schema (every field is
required unless marked optional):

{
  "outline": "3-5 sentence three-act outline. Match the bible's act
              breakdown verbatim if present.",
  "startup_scene": "scene_id of the first scene the player sees",
  "scenes": [
    {
      "id": "snake_case_id",
      "name": "Human Name",
      "type": "explore | dialog | minigame | cutscene | decision | hub",
      "description": "What the player sees in the BACKGROUND ONLY. Be
                      concrete about the 1-bit pixel-art environment:
                      architecture, props, lighting, dither pattern.
                      CRITICAL: do NOT describe any human figure,
                      character, player, NPC, or person in the background.
                      The player + NPCs are rendered as separate sprites
                      on top — leave the focal area empty.",
      "mood": "1-3 words from the intake's tone_keywords",
      "music_intent": "1 sentence describing the audio bed for this scene
                       (e.g. 'sparse tracker pulse, no melody, room tone
                       between hits')",
      "mechanic_kit": "one of: lockpick_crank | dialog_branch |
                       inventory_grid | platformer_run | top_down_explore |
                       rhythm_tap | drawing_canvas | timing_meter |
                       conversation_wheel | character_creator_crank |
                       pursuit_evade | custom | null",
      "custom_spec": "ONLY when mechanic_kit == 'custom'. 2-3 sentences
                      describing the bespoke mechanic. Reference specific
                      SDK APIs (playdate.getCrankChange, sprite:moveTo,
                      etc). Otherwise null.",
      "exits": [
        { "to": "scene_id", "trigger": "1 sentence: how the player gets
                 there (button, area, dialog choice, success/fail)" }
      ],
      "style_reference": "Optional. One of: bedroom, bbs_chat_close, chat,
                          coins_inventory, haxheadroom_minigame,
                          lockpicking_minigme, lockpicking_target, menu,
                          powerglove_hacking, powerglove_menu, room3,
                          seckc, title. Or null."
    }
  ]
}

Total scene count: {intake.scene_count}. Of those, {intake.minigame_count}
must be type="minigame". Include exactly one title/start scene first.

Every scene's exits must reference scene ids that exist in this same
scenes list. The startup_scene's exits chain must be reachable to every
other scene (no orphans).`,

  // Section 6 — characters augment
  characters: `STAGE: characters

Output STRICT JSON. Schema:

{
  "characters": [
    {
      "id": "snake_case_id",
      "name": "Human Name",
      "role": "protagonist | antagonist | npc | mentor | ally",
      "bio": "1-2 sentence backstory rooted in the bible's setting",
      "visual_anchor": "ONE physical detail readers should picture every
                        time this character appears (e.g. 'cracked
                        wraparound sunglasses', 'left arm in a denim
                        sling', 'hood up over a sweat-stained ballcap').
                        This becomes the consistency anchor across every
                        portrait + scene reference.",
      "portrait_prompt": "Visual description for the 1-bit 64x64 portrait.
                          Must include the visual_anchor verbatim.
                          Specify silhouette + 1-2 defining features.
                          Atkinson dither for the skin / shading. Pure
                          black background. No text, no logos, no color
                          word at all."
    }
  ]
}

Generate 3-6 characters. Protagonist + antagonist + mentor MUST match the
bible's named cast — do not invent replacements. You may add 1-2
supporting NPCs. Every portrait_prompt MUST contain its character's
visual_anchor string so downstream image regens stay consistent.`,

  // Section 7 — scene_bursts augment (visual lock for image gen)
  scene_bursts: `STAGE: scene_bursts — visual lock

You are writing the IMAGE PROMPT for a single 400x240 1-bit Playdate
scene background. The pipeline forbids the words "color" and "grayscale"
in the final prompt sent to the image model; assembleSystemPrompt strips
them, so do not rely on them.

Required prompt structure (in this order):
1. Subject: the room/exterior/space in 1 sentence. Architecture + lighting
   direction.
2. Dither call-out: name the primary dither (Atkinson for portraits +
   detailed scenes, Bayer 8x8 for skies + fog + flat regions,
   Floyd-Steinberg only for high-detail textures). Match the bible's
   {bible.primary_dither} when set.
3. Props: 3-5 concrete props that anchor the player in this fiction.
4. Negative space: explicitly state that the focal floor / center
   foreground is EMPTY — no human figure, no NPC, no player. The sprite
   layer is composited on top by the runtime.
5. Style refs: name {intake.visual_refs} but do not name copyrighted
   characters from those refs.

End the prompt with: "1-bit pixel art, pure black and pure white only,
400x240, Playdate aspect, no anti-aliasing, no gradients."

Output: just the final image prompt text, no commentary, no fences.`,

  // Section 8 — portrait_bursts augment
  portrait_bursts: `STAGE: portrait_bursts — character image lock

You are writing the IMAGE PROMPT for a single 64x64 1-bit Playdate
character portrait. The output is a sprite-sheet ready PNG — head + upper
shoulders, looking forward or 3/4.

Required:
1. Open with the character's visual_anchor verbatim (the one physical
   detail set at character-gen time).
2. Silhouette description (1 sentence): hair shape, hat/hood if any,
   shoulder line.
3. Face features (1 sentence): brow, eyes, mouth set.
4. Dither: Atkinson for skin shading. Pure black background. Pure black
   shoulders melting into background so the head reads cleanly.
5. No text, no logos, no UI chrome, no name caption, no badge.

End with: "1-bit pixel art portrait, pure black and pure white only,
64x64, centered, Playdate sprite style, no anti-aliasing."

Output: just the final image prompt text, no commentary.`,

  // Section 9 — scene_lua augment (Claude emits feature_set, JS wraps Lua)
  scene_lua: `STAGE: scene_lua — feature selection

You are NOT writing Lua. You are picking which SDK features this scene
uses. The autopilot will compose the Lua module from the Feature Manifest
deterministically. Your job is to pick the right kit + features.

Output STRICT JSON:

{
  "scene_id": "{scene.id}",
  "mechanic_kit": "one of the kit ids (or 'custom' or null) matching the
                   story stage's pick — restate it",
  "feature_set": [
    "3-7 feature ids from the Feature Manifest below"
  ],
  "rationale": "1 sentence per feature: why this scene needs it"
}

Selection rules:
- Always include at least 2 features that are not the basic draw call
  (per Universal Directive quality bar).
- Crank scenes must include "crank_input" and either "crank_dock_hint" or
  "crank_indicator_ui".
- Accelerometer scenes must include "accel_start_stop".
- Music scenes must include "music_fade_in" AND "music_stop_on_exit".
- Dialog scenes must include "dialog_box" and "input_button_a".
- Minigame scenes must include "score_hud" and "fail_state" unless the
  custom_spec explicitly says otherwise.

Feature manifest (use ONLY these ids; ask for none others):
{feature_manifest_ids}

Scene runtime contract (Phase 3 — stack-based scene_manager):

  Generated scenes are Lua TABLES with these methods. The runtime calls
  them via the global scene_manager (loaded once in main.lua, bound to
  _G.scene_manager). The API is:

    scene_manager.push(scene_table, args)     -- become top of stack
    scene_manager.replace(scene_table, args)  -- swap top
    scene_manager.pop()                       -- return to previous

  Lifecycle (exact order):
    scene:init(args)   -- one-time construction; receives push/replace args
    scene:enter()      -- called when scene becomes top of stack
    scene:update()     -- every frame while on top (NO dt parameter)
    scene:draw()       -- every frame after update
    scene:input(evt)   -- optional, fed by main loop / input_buffer
    scene:exit()       -- called when scene leaves top of stack

  HARD GUARANTEE: scene_manager calls exit() on the OUTGOING scene
  BEFORE init() / enter() on the INCOMING scene. Cleanup in exit() is
  safe — the next scene has not been constructed yet.

  When a scene needs to transition, feature snippets call:
    scene_manager.replace(require("scenes." .. target_id), { spawn = "..." })
  NEVER call any other scene_manager API (no .goto, no .switch, no .set).

Scene context:
- id: {scene.id}
- type: {scene.type}
- description: {scene.description}
- mood: {scene.mood}
- mechanic_kit: {scene.mechanic_kit}
- custom_spec: {scene.custom_spec}
- exits: {scene.exits}`,

  // Section 10 — sfx augment
  sfx: `STAGE: sfx — synth recipe selection

The sfx_synth module ships 6 procedural baselines: select, back, pickup,
fail, hit, blip. You are picking which baseline maps to each in-game
event AND naming any 1-3 extra one-shots this game needs beyond the
baseline.

Output STRICT JSON:

{
  "event_map": {
    "menu_select": "select",
    "menu_back": "back",
    "item_get": "pickup",
    "minigame_fail": "fail",
    "minigame_hit": "hit",
    "ui_blip": "blip"
  },
  "extra_oneshots": [
    {
      "id": "snake_case_id",
      "trigger": "1 sentence: when this fires",
      "synth_recipe": "1 sentence: waveform + envelope + filter (e.g.
                       'square wave 220Hz, 30ms attack, 180ms decay, no
                       sustain, lowpass 4kHz')"
    }
  ]
}

Keep extra_oneshots to 1-3 entries. No music here — music is its own
stage. No looping ambience. Every recipe must be reproducible by a
classic ADSR + filter synth — no samples.`,

  // Section 11 — music augment
  music: `STAGE: music — per-scene assignment

The music library is already seeded under sdk_data/scene_music/. Your
job is to pick the right track per scene based on its mood +
music_intent + audio_direction ({intake.audio_direction}).

Output STRICT JSON:

{
  "assignments": [
    {
      "scene_id": "string",
      "preferred_keywords": [
        "2-4 keywords describing what to match in the library track's
         filename / metadata (e.g. 'sparse', 'tracker', 'menu', 'tense',
         'drone', 'jazz', 'chip')"
      ],
      "fallback_intent": "1 sentence describing what synth-generated
                          replacement to commission if no library track
                          matches"
    }
  ]
}

Hard rules:
- No track may be assigned to more than one scene.
- Title / hub scenes get the most-melodic track in the library.
- Minigame scenes get high-energy tracker / chip tracks.
- Dialog / cutscene scenes get sparse / ambient tracks.
- Every scene gets exactly one assignment (no missing scenes).`,

  // Section 12 — launcher augment
  launcher: `STAGE: launcher — card + icon + launch image

You are generating the image prompts AND the launcher animation script
for the Playdate launcher chrome. There are three required assets and
one optional animation script.

Output STRICT JSON:

{
  "card_prompt": "Image prompt for card.png (350x155). The 'shelf card'
                  shown in the launcher list. Should be a wide, framed
                  marquee of the game's central image — title legible,
                  primary character or icon visible. 1-bit, Atkinson
                  dither. End with: '350x155, 1-bit pixel art, pure
                  black and pure white only, launcher card, no
                  anti-aliasing.'",
  "icon_prompt": "Image prompt for icon.png (32x32). A single-glyph
                  silhouette of the game's central object/symbol.
                  Pure black on pure white, no internal dither (too
                  small). End with: '32x32, 1-bit, pure black silhouette
                  on pure white, no anti-aliasing.'",
  "launch_image_prompt": "Image prompt for launchImage.png (400x240).
                          The splash shown when the game starts. The
                          title scene's frame, framed for impact. End
                          with: '400x240, 1-bit pixel art, pure black
                          and pure white only, splash screen, no
                          anti-aliasing.'",
  "animation_txt": "Optional. animation.txt contents for a 2-4 frame
                    launcher card animation. Each line: 'frame N
                    duration_ms'. Leave as null if no animation."
}

The card.png / icon.png / launchImage.png will all be generated via
pulp_ai.generateScene with explicit dim overrides at autopilot time —
do not include dim metadata in the prompt itself, just the visual brief.`,
};

// --- Section 16 — QA checklist (consumed by sdk_export.runQaChecklist) ---
//
// This is the source-of-truth definition for the per-scene + per-project
// checks that gate pdc invocation. Each entry is { id, scope, label, run }.
// run is a sync function returning null on pass or a string detail on fail.
//
// scope = 'scene' is called once per scene with (scene, sdkData, project).
// scope = 'project' is called once with (sdkData, project, stageDir).

const QA_CHECKS = [
  // ---- per-scene checks ----
  {
    id: 'no_globals',
    scope: 'scene',
    label: 'scene lua avoids globals (no top-level non-local assignment)',
    run: (scene) => {
      const lua = String(scene && scene.lua || '');
      if (!lua) return null; // empty handled by another check
      // Look for top-level (column 1) `name =` or `function name(` without
      // `local`. False positives are acceptable; only blatant globals fail.
      const lines = lua.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(ln) && !/^local\s/.test(ln)
            && !/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\{/.test(ln)) {
          // Module table declaration like `Scene_x = {}` is also a global —
          // mitigated by the deterministic emitter using `local Scene_x`.
          return `line ${i + 1}: looks like a global assignment: '${ln.trim().slice(0,60)}'`;
        }
        if (/^function\s+[A-Za-z_]/.test(ln) && !/^function\s+local/.test(ln)
            && !/^function\s+[A-Za-z_][A-Za-z0-9_]*[:.]/.test(ln)) {
          return `line ${i + 1}: looks like a global function: '${ln.trim().slice(0,60)}'`;
        }
      }
      return null;
    },
  },
  {
    id: 'timers_in_state',
    scope: 'scene',
    label: 'all playdate.timer.new calls assign into self.timers / state.timers',
    run: (scene) => {
      const lua = String(scene && scene.lua || '');
      if (!/playdate\.timer\.new/.test(lua)) return null;
      // Every timer.new call should appear after `state.timers` or
      // `self.timers` (or equivalent) on the same line / nearby.
      const lines = lua.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/playdate\.timer\.new\(/.test(lines[i])) {
          const ctx = lines.slice(Math.max(0, i - 1), i + 1).join(' ');
          if (!/(self\.timers|state\.timers|timers\s*\[)/.test(ctx)) {
            return `line ${i + 1}: timer not tracked in state.timers / self.timers`;
          }
        }
      }
      return null;
    },
  },
  {
    id: 'sprites_have_collide_rect',
    scope: 'scene',
    label: 'sprites with movement (moveTo/moveBy/moveWithCollisions) have setCollideRect',
    run: (scene) => {
      const lua = String(scene && scene.lua || '');
      if (!/sprite/i.test(lua)) return null;
      const hasMovement = /(moveBy|moveWithCollisions)\b/.test(lua);
      if (!hasMovement) return null;
      if (!/setCollideRect/.test(lua)) {
        return 'sprite movement present but no setCollideRect found';
      }
      return null;
    },
  },
  {
    id: 'crank_scene_has_dock_check',
    scope: 'scene',
    label: 'crank-driven scenes check isCrankDocked + show ui.crankIndicator',
    run: (scene) => {
      const lua = String(scene && scene.lua || '');
      const features = (scene && scene.feature_set) || [];
      const usesCrank = /getCrankChange|crankInput/.test(lua)
                     || features.includes('crank_input');
      if (!usesCrank) return null;
      const ok = /isCrankDocked/.test(lua) && /crankIndicator/.test(lua);
      return ok ? null : 'crank scene missing isCrankDocked check or ui.crankIndicator';
    },
  },
  {
    id: 'accel_start_stop',
    scope: 'scene',
    label: 'accelerometer scenes call startAccelerometer in enter + stopAccelerometer in exit',
    run: (scene) => {
      const lua = String(scene && scene.lua || '');
      const features = (scene && scene.feature_set) || [];
      const usesAccel = /accelerometer/i.test(lua)
                     || features.includes('accel_start_stop');
      if (!usesAccel) return null;
      const startOk = /startAccelerometer\s*\(/.test(lua);
      const stopOk = /stopAccelerometer\s*\(/.test(lua);
      if (!startOk || !stopOk) {
        return `accelerometer: start=${startOk}, stop=${stopOk}; both required`;
      }
      return null;
    },
  },
  {
    id: 'music_stop_on_exit',
    scope: 'scene',
    label: 'scenes that play music call audio_manager.stop_music on exit',
    run: (scene) => {
      const lua = String(scene && scene.lua || '');
      if (!/(play_music|playMusic|audio_manager\.play_music)/.test(lua)) return null;
      // exit() block must include stop_music.
      const exitMatch = lua.match(/:exit\s*\(\s*\)[\s\S]*?\bend\b/);
      const exitBody = exitMatch ? exitMatch[0] : '';
      if (!/(stop_music|stopMusic)/.test(exitBody)) {
        return 'music started but exit() does not call audio_manager.stop_music';
      }
      return null;
    },
  },

  // ---- per-project checks ----
  {
    id: 'pdxinfo_fields',
    scope: 'project',
    label: 'pdxinfo has name, author, description, bundleID, version, buildNumber, imagePath',
    run: (sdkData, project, stageDir) => {
      const pdxinfoPath = stageDir ? path.join(stageDir, 'source', 'pdxinfo') : null;
      if (!pdxinfoPath || !fs.existsSync(pdxinfoPath)) {
        return 'pdxinfo not found in stage dir';
      }
      const txt = fs.readFileSync(pdxinfoPath, 'utf8');
      const required = ['name', 'author', 'description', 'bundleID', 'version',
                        'buildNumber', 'imagePath'];
      const missing = required.filter((k) => !new RegExp(`^${k}=`, 'm').test(txt));
      return missing.length ? `pdxinfo missing fields: ${missing.join(', ')}` : null;
    },
  },
  {
    id: 'card_png_350x155',
    scope: 'project',
    label: 'card.png is exactly 350x155',
    run: (sdkData, project, stageDir) => assertPngDim(stageDir,
      'source/launcher/card.png', 350, 155, { optional: false }),
  },
  {
    id: 'icon_png_32x32',
    scope: 'project',
    label: 'icon.png is exactly 32x32',
    run: (sdkData, project, stageDir) => assertPngDim(stageDir,
      'source/launcher/icon.png', 32, 32, { optional: false }),
  },
  {
    id: 'launchImage_400x240',
    scope: 'project',
    label: 'launchImage.png is exactly 400x240',
    run: (sdkData, project, stageDir) => assertPngDim(stageDir,
      'source/launcher/launchImage.png', 400, 240, { optional: true }),
  },
  {
    id: 'no_color_or_grayscale_in_prompts',
    scope: 'project',
    label: 'no logged pulp_data prompt contains the words "color" or "grayscale"',
    run: (sdkData, project, stageDir) => {
      const root = project && project.local_path;
      if (!root) return null;
      const pulpDataDir = path.join(root, 'sdk_data', 'pulp_data');
      if (!fs.existsSync(pulpDataDir)) return null;
      const offenders = [];
      const walk = (dir) => {
        for (const f of fs.readdirSync(dir)) {
          const fp = path.join(dir, f);
          const st = fs.statSync(fp);
          if (st.isDirectory()) walk(fp);
          else if (/\.(json|txt|log|md)$/i.test(f)) {
            try {
              const t = fs.readFileSync(fp, 'utf8');
              if (/\b(color|colour|grayscale|greyscale)\b/i.test(t)) {
                offenders.push(path.relative(root, fp));
              }
            } catch (_e) { /* ignore */ }
          }
        }
      };
      try { walk(pulpDataDir); } catch (_e) { /* ignore */ }
      return offenders.length
        ? `forbidden words in prompt logs: ${offenders.slice(0, 5).join(', ')}`
        : null;
    },
  },
  {
    id: 'total_size_under_40mb',
    scope: 'project',
    label: 'staged source/ total size is under 40 MB',
    run: (sdkData, project, stageDir) => {
      if (!stageDir) return null;
      const src = path.join(stageDir, 'source');
      if (!fs.existsSync(src)) return null;
      let total = 0;
      const walk = (dir) => {
        for (const f of fs.readdirSync(dir)) {
          const fp = path.join(dir, f);
          const st = fs.statSync(fp);
          if (st.isDirectory()) walk(fp);
          else total += st.size;
        }
      };
      walk(src);
      const mb = total / (1024 * 1024);
      return mb > 40 ? `staged source = ${mb.toFixed(1)} MB (>40 MB cap)` : null;
    },
  },
];

function assertPngDim(stageDir, relPath, w, h, { optional } = {}) {
  if (!stageDir) return null;
  const fp = path.join(stageDir, relPath);
  if (!fs.existsSync(fp)) {
    return optional ? null : `${relPath} missing`;
  }
  // Parse PNG IHDR for width/height — no image lib dependency.
  let buf;
  try { buf = fs.readFileSync(fp); } catch (_e) {
    return `${relPath} unreadable`;
  }
  if (buf.length < 24 || buf.slice(1, 4).toString('ascii') !== 'PNG') {
    return `${relPath} not a valid PNG`;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== w || height !== h) {
    return `${relPath} is ${width}x${height}, expected ${w}x${h}`;
  }
  return null;
}

// --- Assembly --------------------------------------------------------------

function substituteVars(text, vars) {
  if (!vars || !text) return text;
  return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, key) => {
    const parts = key.split('.');
    let cur = vars;
    for (const p of parts) {
      if (cur == null) return m;
      cur = cur[p];
    }
    if (cur == null) return m;
    if (typeof cur === 'object') return JSON.stringify(cur);
    return String(cur);
  });
}

function bibleBlock(storyBible) {
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

// Concatenate UNIVERSAL_DIRECTIVE + bible + active style picks + per-stage
// augment + extras. vars is substituted across the augment (not the directive
// or bible). activePicks is the {axisId: optionRecord} map returned by
// asset_library.getActivePicksWithSpecs(); if present, the picks are inlined
// into the prompt so the LLM stays consistent with the user's picks.
function assembleSystemPrompt({ stageId, storyBible, vars, extras, activePicks }) {
  const augment = STAGE_AUGMENTS[stageId] || '';
  const substituted = substituteVars(augment, vars);
  const parts = [
    UNIVERSAL_DIRECTIVE,
    bibleBlock(storyBible),
    formatActivePicks(activePicks, stageId),
    substituted,
    extras || '',
  ].filter(Boolean);
  return parts.join('\n\n');
}

// Format active style picks into a prompt block. Only picks whose axis lists
// the current stage in consumed_by_stages are included (keeps the prompt
// focused; other stages get the picks they need only).
//
// activePicks shape: { axisId: optionRecord | [optionRecord, ...] | null }
// Returns '' if no relevant picks.
function formatActivePicks(activePicks, stageId) {
  if (!activePicks || typeof activePicks !== 'object') return '';
  const lines = [];
  for (const [axisId, record] of Object.entries(activePicks)) {
    if (!record) continue;
    // Best-effort consumed_by_stages check — we don't have axis config here;
    // include all picks. Stages can ignore irrelevant axes. Future opt: filter
    // by reading the axis config.
    const records = Array.isArray(record) ? record : [record];
    for (const r of records) {
      if (!r || !r.spec) continue;
      lines.push(`### ${axisId}: ${r.name || r.spec.name || r.id}`);
      for (const [k, v] of Object.entries(r.spec)) {
        if (k === 'name' || k === 'preview_prompt' || k === 'preview_lua_template') continue;
        if (typeof v === 'object') lines.push(`- ${k}: ${JSON.stringify(v)}`);
        else lines.push(`- ${k}: ${v}`);
      }
      lines.push('');
    }
  }
  if (lines.length === 0) return '';
  return [
    '## ACTIVE STYLE PICKS FOR THIS PROJECT',
    '',
    'Every output below MUST be consistent with these picks. Treat them as canon.',
    '',
    ...lines
  ].join('\n');
}

// --- Feature manifest helpers --------------------------------------------

function loadFeatureManifest() {
  const fp = path.join(__dirname, '..', 'data', 'feature_manifest.seed.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch (_e) { return null; }
}

// Deterministic Lua emitter. Takes the scene record, its picked feature ids,
// and (optionally) a mechanic-kit recipe body, and assembles a single Lua
// module by stitching the manifest's snippet sections (imports, state_init,
// setup, input_bindings, update_tick, cleanup) in order.
//
// Emits scene tables that work with the Phase 3 stack-based scene_manager
// (server/services/sdk_runtime_lua/scene_manager.lua). Contract:
//
//   scene_manager.push(scene, args) / .replace(scene, args) / .pop()
//
//   Lifecycle: init(args) -> enter() -> update() -> draw() -> input(evt) -> exit()
//   exit() on outgoing scene runs BEFORE init()/enter() on incoming scene.
//   update() takes NO dt parameter (scene_manager passes nothing).
//
// scene.exits (when non-empty): emitted as a `Scene_<id>.exits` table the
// transition_to() helper uses to call scene_manager.replace(). Feature
// snippets reference `self:transition_to(exit_id)` to trigger navigation.
function buildSceneLuaFromFeatures(scene, featureSet, recipeBody) {
  const id = String(scene && scene.id || 'scene');
  const ident = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
  const manifest = loadFeatureManifest() || { features: {} };
  const feats = Array.isArray(featureSet) ? featureSet : [];
  const exits = Array.isArray(scene && scene.exits) ? scene.exits : [];

  const sections = { imports: [], state_init: [], setup: [],
                     input_bindings: [], update_tick: [], cleanup: [] };
  for (const fid of feats) {
    const entry = (manifest.features && manifest.features[fid]) || null;
    if (!entry) continue;
    for (const k of Object.keys(sections)) {
      if (typeof entry[k] === 'string' && entry[k].trim()) {
        sections[k].push(`  -- [${fid}]\n  ${entry[k].trim().replace(/\n/g, '\n  ')}`);
      }
    }
  }

  const importsBlock = sections.imports.length
    ? sections.imports.join('\n').replace(/^ {2}-- \[/gm, '-- [').replace(/^ {2}/gm, '')
    : '';
  const stateInit = sections.state_init.join('\n') || '  -- (no feature state)';
  const setup = sections.setup.join('\n') || '  -- (no feature setup)';
  const inputs = sections.input_bindings.join('\n') || '  -- (no feature input bindings)';
  const update = sections.update_tick.join('\n') || '  -- (no feature update)';
  const cleanup = sections.cleanup.join('\n') || '  -- (no feature cleanup)';

  const recipeSection = recipeBody && recipeBody.trim()
    ? `\n  -- ===== mechanic-kit recipe body =====\n  ${recipeBody.trim().replace(/\n/g, '\n  ')}\n`
    : '';

  // Exits table — feature snippets / transition_to() use it to call
  // scene_manager.replace(require("scenes." .. target_id), { spawn = ... })
  const exitsTable = exits.length
    ? `local exits = {\n${exits.map((e) => {
        const lbl = JSON.stringify(String((e && (e.label || e.to_scene)) || 'next'));
        const tgt = JSON.stringify(String((e && e.to_scene) || ''));
        const spw = JSON.stringify(String((e && e.spawn_target) || (e && e.spawn) || ''));
        return `  [${lbl}] = { to = ${tgt}, spawn = ${spw} },`;
      }).join('\n')}\n}`
    : `local exits = {} -- no static exits declared`;

  return [
    `-- scenes/${id}.lua — generated by sdk_autopilot.js (deterministic).`,
    `-- Runtime contract: Phase 3 stack-based scene_manager`,
    `--   scene_manager.push(scene, args) / .replace(scene, args) / .pop()`,
    `--   lifecycle: init(args) -> enter() -> update() -> draw() -> input(evt) -> exit()`,
    `--   exit() on outgoing runs BEFORE init()/enter() on incoming`,
    `-- feature_set: ${feats.join(', ') || '(none)'}`,
    `-- mechanic_kit: ${scene && scene.mechanic_kit || 'none'}`,
    'local gfx <const> = playdate.graphics',
    importsBlock,
    '',
    `local Scene_${ident} = {}`,
    `local state = { timers = {}, sprites = {} }`,
    exitsTable,
    '',
    // init: receives args from scene_manager.push/replace, runs ONCE per
    // mount on the stack. Defensive against nil args.
    `function Scene_${ident}:init(args)`,
    `  args = args or {}`,
    `  self._spawn = args.spawn`,
    `  self._enter_args = args`,
    `end`,
    '',
    // enter: becomes top of stack. exit() on outgoing scene has already run.
    `function Scene_${ident}:enter()`,
    `  self._bg = gfx.image.new("assets/scenes/${id}")`,
    stateInit,
    setup,
    recipeSection,
    `  if audio_manager and audio_manager.play_music then`,
    `    audio_manager.play_music("sounds/${id}", { fade_ms = 250 })`,
    `  end`,
    `end`,
    '',
    // exit: leaves top of stack. Runs BEFORE the next scene's init. Cleanup
    // is safe — no race with the incoming scene.
    `function Scene_${ident}:exit()`,
    cleanup,
    `  for _, t in pairs(state.timers) do if t and t.remove then t:remove() end end`,
    `  state.timers = {}`,
    `  if audio_manager and audio_manager.stop_music then audio_manager.stop_music({ fade_ms = 250 }) end`,
    `end`,
    '',
    // update: NO dt parameter — scene_manager.update() calls update() with
    // no args per HAKCD's stack contract. Compute timing via
    // playdate.getCurrentTimeMilliseconds() if a feature needs it.
    `function Scene_${ident}:update()`,
    update,
    `end`,
    '',
    `function Scene_${ident}:draw()`,
    `  gfx.clear(gfx.kColorWhite)`,
    `  if self._bg then self._bg:draw(0, 0) end`,
    `  if chrome_theme and chrome_theme.draw_overlay then chrome_theme.draw_overlay() end`,
    `end`,
    '',
    // input: optional handler. Feature snippets append button/crank bindings.
    `function Scene_${ident}:input(evt)`,
    inputs,
    `  if evt == "a" then`,
    `    if audio_manager and audio_manager.play_sfx then audio_manager.play_sfx("select") end`,
    `  end`,
    `end`,
    '',
    // Transition helper: feature snippets call self:transition_to(exit_label)
    // to navigate. ALWAYS use this — never call scene_manager directly from
    // feature snippets so future scene_manager changes have a single
    // call site to update.
    `function Scene_${ident}:transition_to(label)`,
    `  local target = exits[label]`,
    `  if not target or target.to == "" then`,
    `    print("scene_${ident}: no exit named " .. tostring(label))`,
    `    return`,
    `  end`,
    `  local ok, next_scene = pcall(import, "scenes." .. target.to)`,
    `  if not ok or not next_scene then`,
    `    print("scene_${ident}: failed to load scenes." .. target.to)`,
    `    return`,
    `  end`,
    `  scene_manager.replace(next_scene, { spawn = target.spawn })`,
    `end`,
    '',
    // Expose exits table for read-only inspection by the editor / debug menu.
    `Scene_${ident}.exits = exits`,
    '',
    `return Scene_${ident}`,
    ''
  ].join('\n');
}

module.exports = {
  UNIVERSAL_DIRECTIVE,
  STAGE_AUGMENTS,
  QA_CHECKS,
  assembleSystemPrompt,
  formatActivePicks,
  buildSceneLuaFromFeatures,
  loadFeatureManifest,
  _internals: { substituteVars, bibleBlock, assertPngDim, formatActivePicks },
};
