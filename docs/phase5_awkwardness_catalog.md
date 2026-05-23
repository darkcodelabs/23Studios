# Phase 5 Awkwardness Catalog

**Source:** Path B prototype — hand-authored `sc01_bedroom_recurring_hub.lua` as a real playable hub on top of the existing autopilot output. Goal was to surface the gaps in runtime + emitter that make scenes feel like a slideshow instead of a game.

**Release:** `v0.0.2-pathb-bedroom-playable`. 1/27 scenes playable. Other 26 still shell.

**Awkwardness items below feed directly into the Phase 5 spec.** Each item is a real friction point hit during hand-authoring. None are theoretical.

---

## 1. Dialog runtime schema mismatch

**What I expected:** `dialog_tree.load("the_mentor", { on_say, on_choice, on_end })` pulls dialogue JSON, fires callbacks per line. Standard.

**What's true:**
- `runtime/concepts/dialog_tree.lua` `load(npc_id)` reads from `assets/npc_dialogs/<npc_id>.json` — hardcoded path
- Our 88 generated dialogues are at `sdk_data/dialogue/<scene_id>__<npc_id>.json`
- pdc copies neither into the pdx (wireSourceTree doesn't touch dialogue files)
- The expected schema is `{ entry_node, nodes: { id: { type: "say"|"choice", ... } } }` — a tree
- Our generator emits flat `{ lines: [{ id, text, trigger }] }` — a list

**Two incompatible formats. Two incompatible paths. Zero discovery.**

For prototype, I baked dialogue lines directly into scene Lua and ignored the runtime entirely. Phase 5 needs to pick one schema (recommend keeping the flat list — branching dialog is rare in this game) and write a new minimal `dialog_pop.lua` runtime, OR write a transform layer that produces tree shape from flat. Either way the wireSourceTree copy step must add `sdk_data/dialogue/` → `source/dialogue/` and main.lua needs `import "dialogue_pop"`.

## 2. Hotspot system fork — two patterns, neither wired

Repo ships:
- `concepts/hotspot_navigator.lua` — angle-from-center rose pattern (analog stick / d-pad-as-rose, picks the hotspot in the direction you press)
- `concepts/hotspot_system.lua` — point-and-click + visibility + icons (loads PNGs as cursor markers)

Neither is documented as canonical. Bedroom needs a third pattern: **walk-into-bbox + A to interact**. None of the runtime modules implement that. I wrote it inline (`bbox_overlap`, `find_overlap`).

Phase 5 should pick ONE hotspot interaction pattern (recommend walk-into-bbox for explore scenes, hotspot_navigator for crowded UI scenes like AOL chatroom), document it as canonical, deprecate the other.

## 3. No player sprite system

No runtime concept handles "draw newb at x,y, move on d-pad, clamp to room bounds, animate walk cycle." The autopilot ships character portraits at 64×64 — fine for dialog cards, too big for sprite movement on a 400×240 screen.

I cropped newb.png to 32×32 by hand for prototype. No sprite sheet, no walk cycle, no facing direction. Phase 5 needs:
- Sprite-from-portrait emitter step (crop to 32×32 OR generate a fresh sprite asset class at gen time)
- `player_sprite.lua` runtime concept (spawn at scene's spawn_point, d-pad walk with `kButtonIsPressed`, bounds, sprite z-order vs bg)
- Scene declares walkable bounds in its data
- Walk-cycle frame swap when moving (Bayer4x4-dithered animated sprite per Phase 4.8 spec)

## 4. Mechanic_kit is read-only metadata, never consumed

Bible scene spec has `mechanic_kit` field with 12 values (lockpick_crank | dialog_branch | inventory_grid | platformer_run | top_down_explore | rhythm_tap | drawing_canvas | timing_meter | conversation_wheel | character_creator_crank | pursuit_evade | custom). Autopilot's `runStoryAndScenes` writes the value into project.json. **Nothing reads it.**

`server/data/minigame_recipes.seed.json` has 11 templates with `lua_template` strings. **Nothing reads that either.**

Phase 5's central job is the recipe-inlining stage:
- For each scene with `mechanic_kit !== null`, load matching recipe
- Splice `lua_template` into scene's `:enter / :update / :draw / :input` overriding the shell
- Wire required runtime concept imports into main.lua
- Validate the spliced Lua compiles via pdc dry-run before sideload

## 5. main.lua never inits subsystems

Emitted main.lua imports save_state, audio_manager, etc, but never calls their `init()`. `save_state.get(key)` would crash on first call (returns nil from uninitialized `data`). `audio_manager.init()` is a no-op today but documented as the place to load user volume preferences.

I patched the prototype's main.lua by hand with explicit `save_state.init()` + `audio_manager.init()` calls before `scene_manager.push`. Phase 5 emitter must add these.

## 6. char_wheel exists but no scene invokes it

`concepts/char_wheel.lua` is a complete crank-driven handle picker (`:crank_input`, `:button_a`, `:get_value`, `:update`, `:jump_block(up/down)`). The bible explicitly specs the title scene as char_wheel intake ("player picks a handle at game start via char_wheel; default 'newb'").

Title scene currently does NONE of that — it shows bg + plays sfx + auto-advances to bedroom. Prototype hard-codes handle = "newb" via save_state default.

Phase 5 needs:
- Title scene's `mechanic_kit = 'character_creator_crank'` in bible spec
- Recipe wires char_wheel.new() into title scene's :enter, dispatches input to its :crank_input + :button_a, on A → save_state.set("handle", char_wheel:get_value()) → transition

## 7. No save_state schema enforcement

`save_state.lua` has a `DEFAULTS = { music_enabled, music_volume, sfx_volume, flags = {} }` table. Game-specific flags (handle, current_act, inventory, current_handle, completed_scenes, unlocked_tools) live under `flags`. No validation. No migration on schema bump. No "current_act tracker" runtime that scenes can query like `if save_state.act() >= 3 then enable_blue_box() end`.

Phase 5 needs a `progression.lua` runtime concept that wraps save_state with typed accessors: `progression.act()`, `progression.tool_unlocked(name)`, `progression.completed(scene_id)`, `progression.inventory_has(item_id)`.

## 8. No scene graph honoring

Pipeline-generated exits are LINEAR (`each scene → next scene by sceneIdx`). Bible defines a DAG (bedroom is recurring hub, payphone has parallel branches, Act 4 has 3 endings). My kickoff script overwrote bible exits with linear chain because it was faster than parsing the bible's scene graph.

Phase 5 needs:
- Scene exits emitter that reads bible `scene.exits[]` verbatim
- For recurring hub scenes (bedroom mentioned in Act 1, Act 3), scene needs to know which act it's in via save_state
- Multi-target exit selector (A→primary, B→secondary, D-pad→walk-out)

## 9. Modem minigame stub instead of real minigame

Bedroom's modem should trigger `haxheadroom_dials` — the actual war-dialer minigame the bible specs. The concept exists at `concepts/haxheadroom_{dials,logic,audio}.lua` and is fully implemented (level-based, crank-tuned, win/lose). I stubbed it with a 3-line text card because wiring `haxheadroom_logic.new(level_number)` + `:draw` + crank input handoff was more than a prototype-day's worth.

Phase 5 needs:
- Minigame mounting pattern: scene's `:enter` does `state.mg = minigame.new(opts)`, scene's `:update / :draw / :input` delegate to `mg:update / mg:draw / mg:input`, on `mg:is_done()` scene calls win/fail handler and clears
- Bedroom modem hotspot fires haxheadroom_dials at level 1 (intro war-dial)

## 10. No interrupt mechanic

Bible mom-interrupt: "every 20-25 minutes of game time, a random household event can interrupt a session." Requires a global timer running across scenes, a save_state-gated next-event timestamp, and a dispatch that pushes a modal mom-yelled scene over the current scene.

Nothing in the runtime supports modal scene overlay. `scene_manager.push` would stack but the parent stops updating (Playdate single-update-loop convention). Phase 5 needs a separate `event_bus.lua` runtime that ticks on every frame regardless of active scene + can spawn dialog popups without pushing a new scene.

## 11. Scene wiring noise

Each scene Lua hand-binds `_G[id] = Scene` and `_G[Scene_id] = Scene`. Each scene re-implements `transition_to(label)` with the same body. Each scene re-implements the dialog popper if it has dialog. The emitter has a shell function, but anything beyond the shell forces the author to re-paste boilerplate.

Phase 5 should ship a `scene_base.lua` runtime concept that scenes EXTEND, not duplicate:

```lua
local Scene = scene_base.new('sc01_bedroom_recurring_hub', {
  exits = { ... },
  hotspots = { ... },
  music = 'sounds/music/sc01_bedroom_recurring_hub',
})
function Scene:on_hotspot_interact(hs) ... end
return Scene
```

Eliminates 60-80 lines of boilerplate per scene.

## 12. Hotspot positions are hand-tuned bbox coords

I picked `{x=290, y=60, w=60, h=50}` for the computer by eyeballing the bg PNG. There's no tool that:
- Renders the scene bg in the gallery UI with hotspot overlay editor
- Saves bbox coords back to scene's project.json entry
- Auto-suggests bbox positions from bg image semantic analysis (likely too ambitious)

For now Phase 5 emitter could read hotspot positions from a per-scene `hotspots.json` sidecar the user hand-edits, OR the gallery UI grows a hotspot editor on top of the existing scene preview.

## 13. Pdc warning noise

`pdc` prints two warnings on every compile:
- `Unrecognized file types are copied by default. Use the -k or --skip-unknown flag to skip these files instead.`
- `Copying launcher/animation.txt` and `Copying main.lua.canonical`

main.lua.canonical is the autopilot's stashed backup from wireSourceTree. It's never imported, just sits in the pdx adding bytes. Phase 5 should strip it before pdc.

## 14. Music doesn't pause during dialog

Bedroom's keygen music plays continuously. When the player opens the computer dialog, music keeps playing under the dialog text. For most scenes that's fine. For tense scenes (RedHook confrontation, lockpicking with neighbor light) the music should duck or pause.

audio_manager has no `pause / resume`. Just `play_music / stop_music`. Phase 5 needs:
- `audio_manager.pause_music()` + `resume_music()`
- Per-scene `pause_during_overlay = true/false` flag
- Or a `scene_base` default that pauses on any dialog open

## 15. No "show me what works on hardware" validator

Sideload to real device is the only way to know if the prototype actually plays. Smoketest (Phase 3 Patch B) reports `booted=true` but doesn't simulate input. Phase 5 should ship:
- Scripted-input demo recorder per HAKCD demo_reel.lua pattern
- Per-scene `acceptance.json` declaring inputs that must produce specific state transitions
- Headless smoketest that replays the script + asserts the asserts

---

## Phase 5 spec shape (informed by the above)

Based on the 15 awkwardness items, Phase 5 needs:

### New emitter stages

1. **Recipe inlining** — for scene's mechanic_kit, splice the matching recipe into scene's lifecycle methods (resolves #4, #6, #9)
2. **Scene_base extension** — emit scenes as data + handlers, not boilerplate (resolves #11)
3. **Hotspot sidecar reader** — read per-scene hotspot JSON for bbox + interact handler kind (resolves #12)

### New runtime concepts

4. **player_sprite.lua** — newb sprite with d-pad walk, room bounds, walk-cycle frames (resolves #3)
5. **scene_base.lua** — base scene with default lifecycle + hotspot dispatch + dialog mounting (resolves #11, #14)
6. **dialog_pop.lua** — flat-list dialog popper that reads `dialogue/<sid>__<nid>.json` (resolves #1)
7. **minigame_mount.lua** — pattern for mounting a minigame inside a scene with win/fail callbacks (resolves #9)
8. **progression.lua** — typed wrapper over save_state for act + tools + inventory + completed scenes (resolves #7)
9. **event_bus.lua** — global tick + scheduled-event dispatcher for mom interrupt etc (resolves #10)

### main.lua emitter changes

10. Add `save_state.init()` + `audio_manager.init()` calls before scene_manager.push (resolves #5)
11. Add `import "scene_base"` and the new concept imports (resolves #11)
12. Strip `main.lua.canonical` before pdc (resolves #13)

### wireSourceTree changes

13. Copy `sdk_data/dialogue/` → `source/dialogue/` (resolves #1)
14. Copy `sdk_data/hotspots/` → `source/hotspots/` (resolves #12)
15. Generate sprite assets from portraits (32×32 crops) → `source/images/sprites/` (resolves #3)

### Bible parse changes

16. Honor `scene.exits[]` verbatim instead of overwriting with linear chain (resolves #8)
17. Read `scene.key_npcs` for hotspot placement hints
18. Read `scene.primary_mechanic` to set `mechanic_kit`

### UI / gallery changes (Phase 4.5 follow-up)

19. Hotspot editor overlay on scene preview — drag bboxes, save to hotspots.json (resolves #12)
20. Mechanic preview — render the spliced scene Lua in the gallery's "code" tab so authors can verify recipe inlined correctly

### Validator changes (Phase 3 follow-up)

21. Scripted-input acceptance test per scene — replay inputs, assert state transitions (resolves #15)

---

## Estimate

Phase 5 is **2-3 weeks of pipeline work**. Recipe inlining alone is probably a week (emitter rewrite + recipe schema validation + all 11 recipes tested individually on real hardware). Scene_base + player_sprite + dialog_pop are each 1-2 days. Bible scene-graph honoring is 1 day. event_bus + progression are each 2-3 days.

Suggest **shipping in two waves**:

**Wave A — Make scenes playable (1 week):**
- scene_base.lua + player_sprite.lua + dialog_pop.lua
- main.lua init calls
- wireSourceTree dialogue + sprite copy
- Bible exits honored
- One real minigame end-to-end (lockpick_crank, since it's the showpiece)

**Wave B — Make game progressive (1 week):**
- progression.lua + tool unlock gating
- event_bus.lua + mom interrupt
- Remaining 10 minigame recipes wired
- Choice branches (Act 4 publish path)
- Acceptance test scripts

After Wave A every scene is at least walkable + clickable + dialogable. After Wave B every bible-spec'd mechanic works.

---

## Verdict

The prototype proves the runtime concepts compose **with hand-holding**. Most concepts are real, working code. The gaps are at the emitter + integration layer, not in the runtime primitives.

Phase 5's job is to bridge those gaps. Not rewrite the runtime.

That's the realistic timeline. The 15 awkwardness items above are the actual TODO list.
