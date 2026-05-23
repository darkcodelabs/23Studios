# HAKCD v0.0.1-sideload-fixed

Hotfix release on top of v0.0.1-from-bible after first sideload test.

## What the previous build did wrong

User sideloaded v0.0.1-from-bible to real Playdate hardware. Game booted to title screen but:

1. No music played in any scene
2. Pressing A did nothing visible

## Root causes

### Music silent

- Scene Lua emitted `audio_manager.play_music("sounds/<id>", ...)`
- audio_manager.play_music passes path verbatim to `playdate.sound.fileplayer.new(path)`
- Playdate resolved `sounds/<id>` → looked for `sounds/<id>.pda`
- Actual file was at `sounds/music/<id>.pda` — wrong dir
- fileplayer.new returned nil, music silently no-op

### SFX silent on A press

- Scene Lua's `:input("a")` called `audio_manager.play_sfx("select")`
- audio_manager.play_sfx tried `sounds/select` then `sfx_baseline/select`
- Actual file at `sounds/sfx/select.pda`
- sampleplayer.new returned nil, sfx silently no-op

### A button does nothing

- Scene Lua `:input("a")` only attempted `play_sfx` and returned
- Never called `self:transition_to(label)` to advance scene
- Title scene had `exits` table with one valid target (`sc01_bedroom_recurring_hub`) but nothing fired it

## Fixes (this release)

1. sed across `source/scenes/*.lua`: `play_music("sounds/X")` → `play_music("sounds/music/X")`
2. `source/runtime/audio_manager.lua` play_sfx: `sampleplayer.new("sounds/X")` → `"sounds/sfx/X"`
3. Patched all 27 scene Lua files: `:input("a")` now calls `self:transition_to(next(exits))` after the sfx — auto-advances to first declared exit

## Expected behavior after fix

- Title screen: music plays (first keygen track via title.pda), A advances to bedroom
- Bedroom: music swaps, A advances to next scene per linear chain
- Every scene reachable by repeated A press

## Still known issues

- Dialogue JSON sidecars exist (88 files in `sdk_data/dialogue/`) but `concepts/dialog_tree.lua` runtime not wired to display them — scenes don't pop dialog cards
- Portrait dither still smears the background (Patch A flat-first applies cleanly to scenes, portraits need a stricter pass)
- Scene Lua emitter needs upstream fix in `sdk_prompt_assembly.js` so next pipeline run doesn't ship the same path mismatch — current build is hand-patched

## Pipeline followups

These three bugs all need to fix-forward in the emitter so the next bible-driven build is correct:

- `sdk_prompt_assembly.js` `buildSceneLuaFromFeatures` — emit `sounds/music/<id>` not `sounds/<id>`
- `sdk_prompt_assembly.js` — emit A-press auto-transition_to(first_exit) by default
- `sdk_runtime_lua/audio_manager.lua` — play_sfx path order

Will land as separate commits.
