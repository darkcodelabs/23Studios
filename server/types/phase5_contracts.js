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
// 4b. MechanicState — typed per-mechanic state machines
// ============================================================================
//
// Added in v3 per coordinator review. Every gameplay mechanic with a
// progression-bearing state machine declares its states + legal transitions
// here. progression.lua reads / writes via the typed wrappers below.
//
// Two state machines ship in Wave A/B as Day-1 regression tests:
//   PWNGLOVE (multi-tool, see phase5_pwnglove_multitool_addendum.md)
//   Coin (24-coin grid, see phase5_pwnglove_coins_priority.md)

/**
 * @typedef {Object} PwngloveState
 *
 * Top-level equip state:
 * @property {'holstered'|'equipped'} equip_state
 *   holstered: in inventory, no input read, no HUD
 *   equipped:  HUD active, crank read, layer inputs live
 *
 * Per-layer unlock + activity (each layer state advances independently;
 * Tyson master unlock cascade-flips them all):
 * @property {Object} layers
 *   @property {Object} layers.konami
 *     @property {boolean} unlocked     true when equip_state='equipped' (always)
 *     @property {'idle'|'buffering'|'konami_armed'|'konami_consumed'} state
 *     @property {number} bonus_attempts   0 unless konami_armed; cleared on consume
 *   @property {Object} layers.flipper
 *     @property {Object<string,boolean>} tools_unlocked   { rfid_clone, subghz_replay, ir_learn, ibutton_emulate, blue_box, bad_usb }
 *     @property {string=} active_tool          null or a key from tools_unlocked
 *     @property {Object<string,number>} charge   per-tool charge meter (0..100)
 *   @property {Object} layers.portal
 *     @property {boolean} unlocked
 *     @property {number} portal_energy         0..100, live during charge
 *     @property {number} uses_remaining_this_act   refills on act transition
 *   @property {Object} layers.gravity
 *     @property {boolean} unlocked
 *     @property {string=} attached_object_id   null when not holding
 *     @property {number} heat                  0..100 (sustained 200+ RPM accumulates)
 *     @property {number} cooldown_until_ms     0 if cool
 *
 * Master unlock:
 * @property {boolean} tyson_unlock              persisted; cascade-flips all layer.unlocked=true
 */

/**
 * @typedef {'holstered'|'equipped'} PwngloveEquipState
 * @typedef {'idle'|'buffering'|'konami_armed'|'konami_consumed'} KonamiState
 * @typedef {'idle'|'charging'|'ready'|'cooling'} FlipperToolState
 * @typedef {'idle'|'charging'|'warping'|'cooldown'|'collapsed'} PortalState
 * @typedef {'idle'|'attaching'|'attached'|'placing'|'throwing'|'overheated'} GravityState
 */

// Legal transitions enforced by progression.lua:
//
//   konami:
//     idle        → buffering   (any d-pad input while equipped, no layer claimed input)
//     buffering   → idle        (mismatch OR timeout > buffer_timeout_ms)
//     buffering   → konami_armed (full sequence matched)
//     konami_armed → konami_consumed (next minigame consumes bonus)
//     konami_consumed → idle
//
//   flipper.<tool>:
//     unlocked=false → unlocked=true (on the matching scene_complete event)
//     idle → charging    (player holds A on a tool target hotspot)
//     charging → ready   (charge meter hits 100 OR per-tool threshold)
//     ready → cooling    (tool emits; sets cooldown timer)
//     cooling → idle     (cooldown elapsed)
//
//   portal:
//     idle → charging       (player holds B + cranks)
//     charging → warping    (player releases B with portal_energy >= 25)
//     charging → collapsed  (player releases B with portal_energy < 25; use consumed)
//     warping → cooldown    (scene_manager.replace fires, uses_remaining-- )
//     cooldown → idle       (next act transition refills uses_remaining)
//
//   gravity:
//     idle → attaching      (A on movable_object, RPM check passes)
//     attaching → attached  (object cursor-follows)
//     attached → placing    (A press; object stays at cursor)
//     attached → throwing   (B press; force = current RPM)
//     attached → overheated (heat >= 100; force-drop, NeoPixels red)
//     placing/throwing/overheated → idle (3s cooldown if overheated)

/**
 * @typedef {Object} CoinState
 *
 * Per-coin state machine (one instance per coin 0..23):
 * @property {number} id                  0..23
 * @property {'locked'|'available'|'minting'|'minted'} state
 * @property {boolean} phrase_known       true once scene reveals the phrase
 * @property {boolean} puzzle_complete    true when ENTIRE coin solved
 * @property {string[]} hints_seen        ids of hints the player has triggered
 */

// Legal CoinState transitions:
//   locked → available   (phrase_known=true OR previous-coin puzzle_complete=true per canonical rule)
//   available → minting  (A-press in coin_grid on this coin's cell)
//   minting → available  (B-press abandons puzzle)
//   minting → minted     (puzzle_complete=true)
//   minted → minted      (terminal)

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
 *   @property {PwngloveState} flags.pwnglove    typed PWNGLOVE state machine (see MechanicState section)
 *   @property {Object<string,CoinState>} flags.coins   typed CoinState[] keyed by coin id "0".."23"
 *   @property {boolean} flags.pwnglove_mode_complete   playground all-8-stations visited
 * @property {Object<string,Object>} checkpoints  Named deep-copies of flags for system-menu PWNGLOVE MODE
 *                                                push/has/restore exposed via progression.lua
 */

// ============================================================================
// 5b. Checkpoint API — progression.lua, gates Team Wiring
// ============================================================================
//
// Required for PWNGLOVE MODE playground (system menu entry/exit). Player
// hits menu → "pwnglove mode" → push_checkpoint("pre_pwnglove_mode") →
// scene_manager.transition_to("pwnglove_playground"). Player hits menu →
// "back to story" → restore_checkpoint("pre_pwnglove_mode") restores all
// flags, replays scene stack.
//
// Lua-side API:
//   progression.push_checkpoint(label: string) -- deep-copy flags + scene stack
//   progression.has_checkpoint(label: string) -> bool
//   progression.restore_checkpoint(label: string) -- restore + drop
//
// Implementation note: deep-copy must include scene_state, inventory, coins,
// pwnglove subtree. Audio prefs (music_enabled etc.) are NOT checkpointed —
// they should persist across mode switches.

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
  // Bible field enums — Bible team validates against these.
  //
  // v3 changes (2026-05-23 batch absorb):
  //   - REPLACED 'pwnglove_konami_unlock' with 'pwnglove_multitool'
  //     (Konami is now Layer 1 of the multi-tool umbrella, not a top-level kit)
  //   - REMOVED 'lockpick_crank' — scope mitigation per multi-tool addendum:
  //     real lockpicks route through PWNGLOVE Flipper.blue_box at Bell pedestal,
  //     crank-controlled via the unified pwnglove_hud.crank_rpm channel.
  MECHANIC_KIT_VALUES: [
    // TOP PRIORITY — real-world-grounded mechanics from
    // NoDataFound/TriKC0x01 + NoDataFound/23Coins. See
    // docs/phase5_pwnglove_coins_priority.md +
    // docs/phase5_pwnglove_multitool_addendum.md +
    // docs/phase5_pwnglove_crank_power_channel.md +
    // docs/phase5_pwnglove_mode_playground.md.
    // These two go through the emitter FIRST as the regression test for
    // recipe inlining.
    'pwnglove_multitool',
    'coin_grid_minter',

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

  // PWNGLOVE power layer ids — bible parser validates against these.
  PWNGLOVE_POWER_LAYERS: [
    'konami',          // Layer 1 — equip-unlocked, +30 attempts buffer
    'flipper',         // Layer 2 — six tools, progressively unlocked
    'portal',          // Layer 3 — scene fast-travel, Act 3 unlock
    'gravity',         // Layer 4 — object manipulation, Act 4 unlock
    'tyson'            // Master — 007-373-5963 cascade-unlocks all of above
  ],

  // PWNGLOVE Flipper tool ids — bible parser validates against these.
  PWNGLOVE_FLIPPER_TOOLS: [
    'rfid_clone', 'subghz_replay', 'ir_learn',
    'ibutton_emulate', 'blue_box', 'bad_usb'
  ],

  // Tyson master unlock code — referenced by pwnglove_tyson.lua runtime
  // module + recipe_loader's code matcher. Mike Tyson's Punch-Out!! (NES, 1987).
  TYSON_MASTER_CODE: '007-373-5963',

  // Crank-as-power-channel canonical formulas. Team Runtime implements these
  // exactly. Changes require coordinator approval — these are part of the
  // game feel contract, not the API contract.
  CRANK_POWER_CURVES: {
    konami_buffer: {
      // attempts = 30 + log(1 + crank_revs_post_konami) * 25
      base: 30, log_coef: 25, asymptote: 100
    },
    flipper: {
      rfid_clone:      { mode: 'accumulate', rate_per_rpm: 1.0, decay_per_sec: 5,  threshold: 50 },
      subghz_replay:   { mode: 'live',       formula: 'clamp(rpm/10, 0, 30)',       capture_min: 15 },
      ir_learn:        { mode: 'live',       formula: 'rpm * 0.5',                  range_div: 10 },
      blue_box:        { mode: 'cumulative_during_hold', sec_per_rev: 0.2 },
      ibutton_emulate: { mode: 'live',       formula: 'rpm * 100',                  lock_window_hz: 5, target_hz: 6000 },
      bad_usb:         { mode: 'live',       formula: 'clamp(rpm/2, 1, 60)' }
    },
    portal: {
      energy_per_rev: 1.0,
      thresholds: { same_act: 25, prev_acts: 60, seckc_hive: 100 },
      collapse_below: 25
    },
    gravity: {
      // Object mass -> required RPM to lift
      required_rpm: { post_it: 5, floppy: 20, modem: 60, server_rack: 200, refrigerator: 300 },
      heat_per_sec_above_200: 1,
      heat_decay_per_sec: 10,
      overheat_at: 100,
      cooldown_ms: 3000,
      throw_force_div: 1   // force = rpm at release / div
    },
    tyson: {
      digit_count: 11,                  // 9 digits + 2 auto-inserted dashes
      digit_advance_input: 'a',
      digit_commit_input: 'reverse_crank_flick',
      flick_min_reverse_rpm: 60,
      flick_window_ms: 250
    }
  },

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
    'unlocked_tools', 'scene_state', 'scripted_event_timers',
    // v3 additions
    'pwnglove', 'coins', 'pwnglove_mode_complete', 'tyson_unlock'
  ],

  TOOL_IDS: [
    'wardialer', 'red_box', 'blue_box', 'beige_box',
    'password_cracker', 'killswitch',
    // v3 — PWNGLOVE itself is an inventory item
    'pwnglove'
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

  // PWNGLOVE MODE playground — system menu integration contract.
  // Coordinator hand-authors source/scenes/pwnglove_playground.lua against
  // these constants. Team Wiring exposes the system menu hook in main.lua.
  PWNGLOVE_PLAYGROUND_SCENE_ID: 'pwnglove_playground',
  PWNGLOVE_MODE_INTRO_SCENE_ID: 'pwnglove_mode_intro',   // 1.5s glove splash before playground
  PWNGLOVE_PLAYGROUND_CHECKPOINT_LABEL: 'pre_pwnglove_mode',
  COIN_VAULT_VIEWER_SCENE_ID: 'coin_vault_viewer',
  TITLE_SCENE_ID: 'title',

  SYSTEM_MENU_ITEMS: [
    {
      label: 'pwnglove mode',
      action: 'enter_pwnglove_mode',
      // Sequence: push_checkpoint -> intro splash 1.5s -> playground
      sequence: ['push_checkpoint:pre_pwnglove_mode', 'transition_to:pwnglove_mode_intro'],
      always_available: true
    },
    {
      label: 'back to story',
      action: 'exit_pwnglove_mode',
      sequence: ['restore_checkpoint:pre_pwnglove_mode'],
      available_when: 'has_checkpoint(pre_pwnglove_mode)'
    }
  ],

  // 9 playground hotspots (added coin_vault between portal and tyson per
  // canonical-pins addendum). Team Emitter recipe ids must exist for each
  // station. Coordinator's hand-authored playground scene wires hotspots
  // to these recipe ids 1:1.
  PWNGLOVE_PLAYGROUND_STATIONS: [
    { id: 'lockpick_station', recipe: 'pwnglove_lockpick_station', tier: 1, ui_ref: 'docs/lockpickmini.png' },
    { id: 'rfid_pedestal',    recipe: 'pwnglove_flipper_suite',    tier: 2, ui_ref: 'docs/pwnglove_remotehack.png' },
    { id: 'payphone',         recipe: 'pwnglove_flipper_suite',    tier: 2 },
    { id: 'ir_wall',          recipe: 'pwnglove_flipper_suite',    tier: 3 },
    { id: 'gravity_arena',    recipe: 'pwnglove_gravity_gun',      tier: 3 },
    { id: 'subghz_tuner',     recipe: 'pwnglove_flipper_suite',    tier: 3 },
    { id: 'portal_pedestal',  recipe: 'pwnglove_portal_gun',       tier: 3 },
    { id: 'coin_vault',       recipe: 'coin_vault_viewer',         tier: 1, ui_ref: 'docs/coingame.png' },
    { id: 'tyson_cabinet',    recipe: 'pwnglove_tyson_master_unlock', tier: 1 }
  ],

  // Canonical pinned assets — sdk_main_emitter MUST hard-copy these
  // and NEVER call the image pipeline for them. Pipeline-regenerating any
  // of these weakens the whole product. Lineage matters: title + coins
  // come from the real 23-codes/23Coins project; gamepwnglovev2.png is
  // the already-rendered game asset (no "let me try a variant").
  //
  // Paths are relative to repo root (server/services/sdk_main_emitter.js
  // resolves them with path.resolve(__dirname, '../../', value)).
  CANONICAL_PINS: {
    title:         'docs/hakcd_title.png',
    pwnglove_icon: 'docs/gamepwnglovev2.png',
    coin_0:        'docs/coin0.png',
    coin_1:        'docs/coin1.jpg',
    coin_2:        'docs/coin2.jpg',
    coin_3:        'docs/coingame.png'   // placeholder for Yoda hash coin; user to drop final
  },

  // Coin Vault viewer config — 24-coin grid, 4 real coins, 20 locked.
  // source/data/coins.json carries the per-coin dialog payload.
  COIN_VAULT_CONFIG: {
    total_coins: 24,
    grid_cols: 4,
    grid_rows: 6,
    real_coins: [0, 1, 2, 3],
    locked_card_asset: 'images/coins/coin_locked.png',
    ui_ref: 'docs/coingame.png',
    side_panel_canonical_text: 'Solving the entire coin earns you the next coin regardless of solve status.',
    footer_glyph: '[ 23 C0iNS ]'
  },

  CONTRACT_VERSION: '5.0.0-day1+pwnglove+crank+playground+canonical_pins+coin_vault+v4'
};
