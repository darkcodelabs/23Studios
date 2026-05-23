'use strict';

// server/types/phase5_contracts.js
//
// Phase 5 cross-team data shapes. EVERY team imports types from this file.
// Day 1 contract — locked. Changes require coordinator approval.
//
// Repo is CommonJS so this is a JSDoc-typed module, not a .d.ts. Editors
// that respect JSDoc typedefs get autocomplete + checking; runtime treats
// it as a no-op module that exports the typedef names as strings for
// runtime introspection.

// ============================================================================
// 1. Hotspot — Bible → Emitter → scene_base
// ============================================================================
//
// A rectangular interactive region within a scene. The player walks newb
// into the rect; A-press fires the hotspot's on_interact handler.
//
// Coordinate space: scene pixel coordinates on a 400x240 Playdate display.
// rect.x + rect.w must be <= 400. rect.y + rect.h must be <= 240.

/**
 * @typedef {Object} HotspotRect
 * @property {number} x      Top-left X in scene pixels (0..400)
 * @property {number} y      Top-left Y in scene pixels (0..240)
 * @property {number} w      Width in scene pixels
 * @property {number} h      Height in scene pixels
 */

/**
 * @typedef {Object} Hotspot
 * @property {string} id              Unique per scene, snake_case (e.g. "computer", "modem")
 * @property {HotspotRect} rect       Pixel bbox in scene coordinates
 * @property {'dialog'|'minigame'|'pickup'|'transition'|'scripted'} on_interact
 *                                    What fires when player presses A on this hotspot
 * @property {string=} dialogue_ref   When on_interact='dialog', npc_id of the dialogue JSON
 *                                    (resolved as sdk_data/dialogue/<scene_id>__<dialogue_ref>.json)
 * @property {string=} minigame       When on_interact='minigame', recipe id from minigame_recipes.seed.json
 * @property {Object=} minigame_opts  Opts passed to the minigame's :new() constructor
 * @property {string=} pickup_item    When on_interact='pickup', inventory id to add via progression.add_item
 * @property {string=} target_scene   When on_interact='transition', destination scene_id
 * @property {string=} target_spawn   When on_interact='transition', spawn point id in destination
 * @property {string=} scripted_event When on_interact='scripted', event name dispatched on event_bus
 * @property {string=} requires       Predicate expression — only active when met.
 *                                    Examples: "progression.act() >= 2", "progression.has_item('red_box')"
 * @property {string=} label          Optional UI hint shown when player overlaps (e.g. "use computer")
 */

// ============================================================================
// 2. DialogLine + Dialog — dialogue_generator.js → dialog_pop
// ============================================================================
//
// FLAT list format, matches what dialogue_generator.js already produces.
// Phase 5 does NOT migrate to tree format — branching dialog is rare in
// HAKCD; when needed scenes can call dialog_pop.show() multiple times
// from a Lua-side state machine.

/**
 * @typedef {Object} DialogLine
 * @property {number} id        1-based sequence within this Dialog
 * @property {string} text      ≤ 200 chars, single Playdate dialogue card
 * @property {string} trigger   Filter — "on_enter" | "on_interact" | "on_exit"
 *                              | "on_idle" | "on_use_<item>" | "on_dialog_choice_<id>"
 *                              dialog_pop reads this to decide which subset to show.
 */

/**
 * @typedef {Object} Dialog
 * @property {string} npc_id     Speaker character id from sdk.characters
 * @property {string} scene_id   Scene context this dialogue lives in
 * @property {DialogLine[]} lines
 */

// ============================================================================
// 3. Recipe — minigame_recipes.seed.json → gameplay_synthesis → minigame_mount
// ============================================================================
//
// A reusable minigame template. The emitter inlines `lua_template` into the
// scene's lifecycle methods, wiring `required_imports` into main.lua and
// passing `default_opts` to the recipe's :new() constructor at scene :enter.

/**
 * @typedef {Object} Recipe
 * @property {string} id                Recipe id (e.g. "lockpick_crank", "haxheadroom_dials")
 * @property {string} mechanic_kit      Bible enum value this recipe satisfies
 *                                      (must match bible's mechanic_kit enum exactly)
 * @property {string} display_name      Human label
 * @property {string} visual_brief      Art direction for scenes hosting this recipe
 * @property {string[]} required_imports Runtime concept module names to import in main.lua
 *                                      (e.g. ["concepts/lockpick_logic", "concepts/haxheadroom_audio"])
 * @property {string} lua_template      Template Lua source spliced into scene's :enter/:update/:draw/:input.
 *                                      Substitution tokens: {{state_var}}, {{opts_table}},
 *                                      {{win_callback}}, {{fail_callback}}.
 * @property {Object} default_opts      Constructor opts passed to the recipe's runtime concept :new()
 * @property {Object} state_schema      JSON schema for the recipe's per-scene state (validates at emit time)
 * @property {Object} win_condition     { event: 'recipe_win', payload: ... } — emitted to event_bus on win
 * @property {Object} fail_condition    { event: 'recipe_fail', payload: ... } — emitted to event_bus on fail
 */

// ============================================================================
// 4. Scene module — Emitter → main.lua via _G self-bind
// ============================================================================
//
// Every emitted scene module satisfies this Lua interface. scene_base.lua
// implements the default lifecycle; scenes override hotspot-interact handlers
// and (when recipe-driven) the minigame mount call.
//
// Lua-side interface, expressed here as a JSDoc typedef for documentation only.

/**
 * @typedef {Object} SceneLuaInterface
 * @property {string} id              Scene id (snake_case)
 * @property {Object} exits           Map of exit_label -> { to: scene_id, spawn: spawn_point_id }
 * @property {Hotspot[]} hotspots     Loaded from <scene_id>.hotspots.json sidecar
 * @property {string=} entry_point    Default newb spawn coord id (or "center" for room middle)
 * @property {string=} mechanic_kit   When set, scene's lifecycle is spliced with a recipe
 * @property {string=} music_path     Resolved path like "sounds/music/<scene_id>"
 *
 * Lifecycle methods (every scene must implement OR inherit from scene_base):
 * @property {function(this:SceneLuaInterface, table)} init   (args) — pre-enter setup
 * @property {function(this:SceneLuaInterface)} enter         play music, spawn player, init hotspots
 * @property {function(this:SceneLuaInterface)} update        d-pad walk, hotspot overlap, dispatch
 * @property {function(this:SceneLuaInterface)} draw          bg, player sprite, hotspot debug, overlays
 * @property {function(this:SceneLuaInterface, string)} input button event ('a'|'b'|'up'|...)
 * @property {function(this:SceneLuaInterface)} exit          stop music, persist save_state
 * @property {function(this:SceneLuaInterface, string)} transition_to (label) — scene_manager.replace
 *
 * Optional handler overrides (scene_base default = no-op):
 * @property {function(this:SceneLuaInterface, Hotspot)} on_hotspot_interact (hs)
 * @property {function(this:SceneLuaInterface, string, Object)} on_event (event_name, payload)
 * @property {function(this:SceneLuaInterface)} on_recipe_win
 * @property {function(this:SceneLuaInterface)} on_recipe_fail
 */

// ============================================================================
// 5. SaveState flag namespace — progression → save_state
// ============================================================================
//
// progression.lua is the typed wrapper. Scenes NEVER call save_state directly
// for game state. Only audio prefs (music_enabled, volumes) go through
// save_state directly per legacy.

/**
 * @typedef {Object} SaveStateSchema
 * @property {boolean} music_enabled        legacy — save_state direct
 * @property {number} music_volume          legacy — save_state direct (0..10)
 * @property {number} sfx_volume            legacy — save_state direct (0..10)
 * @property {Object} flags                 game state under .flags
 *   @property {string} flags.handle        Player chosen handle (default "newb")
 *   @property {number} flags.current_act   1..4
 *   @property {string[]} flags.completed_scenes   Set of scene ids (use as { [id]: true })
 *   @property {string[]} flags.inventory   Array of item ids
 *   @property {string[]} flags.unlocked_tools  ["wardialer", "red_box", "blue_box", "beige_box", "killswitch"]
 *   @property {Object} flags.scene_state   Per-scene persisted state (e.g. computer:'powered_on')
 *   @property {Object} flags.scripted_event_timers   {event_name: next_fire_ts}
 */

// ============================================================================
// 6. EventBus event — event_bus → scenes / progression / audio_manager
// ============================================================================

/**
 * @typedef {Object} BusEvent
 * @property {string} type           dot.namespaced — "scene.enter", "scene.exit",
 *                                                    "recipe.win", "recipe.fail",
 *                                                    "interrupt.mom_yells",
 *                                                    "inventory.add", "tool.unlock"
 * @property {Object} payload        Event-specific data
 * @property {'global'|'scene'|'overlay'} scope
 *                                   global: every subscriber fires
 *                                   scene: only current scene receives
 *                                   overlay: dialog/minigame overlay receives + can cancel
 * @property {boolean=} cancellable  If true, subscribers can call event:cancel() to halt propagation
 */

// ============================================================================
// 7. Bible scene entry (parsed) — story_bible_parser.js → Emitter
// ============================================================================
//
// Extends the existing parser's scene shape with Phase 5 fields. The parser
// must extract these from the bible's markdown SCENE LIST section. Existing
// fields preserved (id, name, type, description, mood, music_intent, exits).

/**
 * @typedef {Object} BibleSceneEntry
 * @property {string} id
 * @property {string} name
 * @property {'explore'|'dialog'|'minigame'|'cutscene'|'decision'|'hub'} type
 * @property {string} description
 * @property {string} mood
 * @property {string} music_intent
 *
 * Phase 5 new fields:
 * @property {string=} mechanic_kit       Enum from minigame_recipes.seed.json mechanic_kit values
 * @property {Object=} entry_point        Default newb spawn — { x: 200, y: 120 } OR "center"
 * @property {Hotspot[]} hotspots         Bible declares hotspots inline; UI hotspot editor edits this
 * @property {BibleExit[]} exits          Structured graph, not linear chain
 * @property {BibleInterrupt[]=} interrupts  Scripted events with trigger conditions
 * @property {string[]=} key_npcs         Character ids that appear in this scene (drives dialogue gen rotation)
 */

/**
 * @typedef {Object} BibleExit
 * @property {string} to                  Destination scene_id
 * @property {string=} spawn              Spawn point id in destination scene
 * @property {string} trigger             Human description ("press A on bed", "lockpick succeeds")
 * @property {string=} requires           Predicate ("progression.has_item('red_box')")
 */

/**
 * @typedef {Object} BibleInterrupt
 * @property {string} event_name          Dispatched via event_bus
 * @property {string} condition           Predicate expression
 *                                        ("save_state.get('dialog_count') > 5 and randf() < 0.3")
 * @property {number=} cooldown_seconds   Minimum game-time delay between fires (default 60)
 * @property {string=} overlay_scene      Optional scene_id to push as overlay when fired
 */

// ============================================================================
// 8. Sidecar files — wireSourceTree contract
// ============================================================================
//
// Files emitted alongside each scene .lua, all copied into source/ by
// wireSourceTree. Paths are sdk_data-relative (source-side equivalents below).

/**
 * SIDECAR INVENTORY
 *
 * sdk_data/scenes/<scene_id>.png             → source/images/scenes/<scene_id>.png   (existing)
 * sdk_data/scenes/<scene_id>.prompt.json     → (not copied — gallery-only metadata)  (existing)
 * sdk_data/scenes/<scene_id>.hotspots.json   → source/hotspots/<scene_id>.json       (NEW — Hotspot[])
 * sdk_data/characters/<npc_id>.png           → source/images/portraits/<npc_id>.png  (existing)
 * sdk_data/dialogue/<sid>__<nid>.json        → source/dialogue/<sid>__<nid>.json     (NEW — Dialog)
 * sdk_data/scene_music/<scene_id>.wav        → source/sounds/music/<scene_id>.pda    (existing, fixed)
 * sdk_data/sfx_baseline/<sfx>.wav            → source/sounds/sfx/<sfx>.pda           (existing)
 * sdk_data/launcher/{card,icon,launchImage}.png → source/launcher/...               (existing)
 *
 * Player sprite — NEW. Generated at wireSourceTree by cropping the
 * protagonist portrait to 32x32 nearest-neighbor:
 * sdk_data/characters/<protag_id>.png        → source/images/sprites/<protag_id>_32.png
 */

// ============================================================================
// 9. Team file ownership — LOCKED per coordinator rule
// ============================================================================
//
// Each team has exclusive write access to these paths. Cross-team file edits
// require coordinator approval, period.
//
// Team Runtime owns:
//   server/services/sdk_runtime_lua/concepts/player_sprite.lua          (NEW)
//   server/services/sdk_runtime_lua/concepts/scene_base.lua             (NEW)
//   server/services/sdk_runtime_lua/concepts/dialog_pop.lua             (NEW)
//   server/services/sdk_runtime_lua/concepts/minigame_mount.lua         (NEW)
//   server/services/sdk_runtime_lua/concepts/progression.lua            (NEW)
//   server/services/sdk_runtime_lua/concepts/event_bus.lua              (NEW)
//   tests/runtime/*                                                     (per-module smoke tests)
//
// Team Emitter owns:
//   server/services/sdk_prompt_assembly.js
//   server/services/gameplay_synthesis.js                               (NEW)
//   server/services/recipe_loader.js                                    (NEW)
//   server/data/minigame_recipes.seed.json                              (schema validation, not content)
//
// Team Bible owns:
//   server/services/story_bible_parser.js
//   server/services/bible_validator.js                                  (NEW)
//   HAKCD_story_bible_v0.1.md  → upgrades to v0.2 with new sections
//
// Team Wiring owns:
//   server/services/sdk_main_emitter.js                                 (NEW — split from sdk_autopilot.js)
//   server/services/sdk_wire_source.js                                  (NEW — split from sdk_autopilot.js wireSourceTree)
//   server/services/sdk_milestones.js
//   server/services/sdk_autopilot.js  → ONLY the stage-orchestration parts; Emitter team
//                                       owns the emitter parts, Wiring team owns init/wire.
//                                       PR-gated edits required.
//
// Team UI owns:
//   ui/src/pages/Gallery.jsx
//   ui/src/pages/SceneEditor.jsx
//   ui/src/components/HotspotEditor.jsx                                 (NEW)
//   ui/src/components/MechanicKitPicker.jsx                             (NEW)
//
// SHARED READ-ONLY (any team imports, NO team writes):
//   server/types/phase5_contracts.js   ← THIS FILE
//
// COORDINATOR-ONLY:
//   server/services/sdk_autopilot.js   (stage orchestration — when emitter team
//                                        needs to add gameplay_synthesis stage,
//                                        wiring team needs to add init calls,
//                                        coordinator merges both)

// ============================================================================
// 10. Wave A vs Wave B — what's in scope when
// ============================================================================
//
// Wave A (Days 2-4, integration Day 5): MAKE SCENES PLAYABLE
//   Runtime:  scene_base, player_sprite, dialog_pop                    (3 modules)
//   Emitter:  recipe loader + inliner + scene_base injection           (3 surfaces)
//   Bible:    schema + parser + HAKCD backfill                         (3 surfaces)
//   Wiring:   main.lua init sequence + wireSourceTree extensions       (2 surfaces)
//   UI:       gallery scene preview (no editor yet)                    (1 surface)
//   Acceptance: bedroom + 3 other scenes walkable + hotspot dialog works on hardware.
//   One real minigame (lockpick_crank) end-to-end.
//
// Wave B (Days 6-9, integration Day 10): MAKE GAME PROGRESSIVE
//   Runtime:  minigame_mount, progression, event_bus                   (3 modules)
//   Emitter:  hotspot sidecar emit, scene-graph honoring, interrupts   (3 surfaces)
//   Bible:    validator + interrupts schema                            (2 surfaces)
//   Wiring:   music pause during dialog, pdc warning cleanup           (2 surfaces)
//   UI:       hotspot editor (drag bbox over scene PNG, save to bible) (1 surface)
//   Acceptance: full pdx with all 11 minigames wired, save persists, scene graph
//   respected, Act 4 publish choice forks, mom interrupt fires.

// ============================================================================
// Exports — string constants so other JS modules can introspect type names
// ============================================================================

module.exports = {
  // Bible field enums — Bible team validates against these
  MECHANIC_KIT_VALUES: [
    // TOP PRIORITY — real-world-grounded mechanics from
    // NoDataFound/TriKC0x01 + NoDataFound/23Coins. See
    // docs/phase5_pwnglove_coins_priority.md. These two go through the
    // emitter FIRST as the regression test for recipe inlining.
    'pwnglove_konami_unlock',
    'coin_grid_minter',

    'lockpick_crank',
    'dialog_branch',
    'inventory_grid',
    'platformer_run',
    'top_down_explore',
    'rhythm_tap',
    'drawing_canvas',
    'timing_meter',
    'conversation_wheel',
    'character_creator_crank',
    'pursuit_evade',
    'custom',
    null   // explicit null = shell scene, no mechanic
  ],

  HOTSPOT_INTERACT_KINDS: [
    'dialog', 'minigame', 'pickup', 'transition', 'scripted'
  ],

  DIALOG_TRIGGER_PREFIXES: [
    'on_enter', 'on_interact', 'on_exit', 'on_idle',
    'on_use_', 'on_dialog_choice_'
  ],

  EVENT_BUS_SCOPES: ['global', 'scene', 'overlay'],

  RESERVED_SAVE_STATE_FLAGS: [
    'handle', 'current_act', 'completed_scenes', 'inventory',
    'unlocked_tools', 'scene_state', 'scripted_event_timers'
  ],

  TOOL_IDS: [
    'wardialer', 'red_box', 'blue_box', 'beige_box',
    'password_cracker', 'killswitch'
  ],

  // Sidecar path conventions — wireSourceTree contract
  SIDECAR_PATHS: {
    hotspots_src:  'sdk_data/scenes',           // <scene_id>.hotspots.json
    hotspots_dst:  'source/hotspots',
    dialogue_src:  'sdk_data/dialogue',
    dialogue_dst:  'source/dialogue',
    sprite_src:    'sdk_data/characters',       // 64x64 portrait cropped to 32x32
    sprite_dst:    'source/images/sprites'
  },

  CONTRACT_VERSION: '5.0.0-day1+pwnglove'
};
