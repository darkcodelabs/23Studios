# 23studios — Claude Code Instructions

## Session coordination rules (mandatory)

Before starting any work in this repo, run:
  ps -ef | grep -E "anthropic.claude-code" | grep -v grep

If other claude sessions are running with cwd anywhere under this repo, DO NOT begin work on shared branches. Either:
1. Work on a session-specific branch named claude-<session-uuid-short>/<task>, or
2. Coordinate with the other session first (the orchestrator will handle this), or
3. Stand down.

Before any commit, check that no other process is mid-write to the index:
  ls .git/index.lock 2>/dev/null

If present and no process holds it, remove it. If present and a process holds it, wait.

After any commit, immediately push to origin so other sessions can see the work:
  git push origin <branch>

If you cannot push (no remote yet, network issue), stop and report. Do not pile up local commits.

Never check out a branch another session is committing to. Use git fetch + log to read its state instead.

When you finish a unit of work, print exactly:
SESSION TASK COMPLETE - SAFE TO CLOSE
This is the signal for the orchestrator to dismiss the session.

A local pre-commit hook (`.git/hooks/pre-commit`) enforces a per-repo commit lock. The hook is not version-controlled — re-install from the recipe in this file if you clone fresh.

---

23studios is a Playdate game-authoring platform. SDK (Lua + pdc) projects only — the Pulp path is legacy but still supported. The active build is **Phase 3: Style-Driven Authoring System + Asset Library + Late-Add Operations**, layered on top of the existing 9-stage SDK autopilot.

## Sources of truth

| Need | Location |
|---|---|
| Playdate SDK 3.0.6 API surface | `~/.claude/skills/playdate-developer/` (installed skill — `dev_quick_ref.md` + `references/api_index.json`) |
| Authoritative Playdate doc | <https://sdk.play.date/3.0.6/> ONLY — **never** `help.play.date` |
| 9-stage SDK autopilot | `server/services/sdk_autopilot.js` (brainstorm → story → characters → scene_bursts → portrait_bursts → scene_lua → sfx → music → launcher) |
| Stage prompts + augments | `server/services/sdk_prompt_assembly.js` |
| Feature manifest (Playdate features Claude can reference) | `server/data/feature_manifest.seed.json` |
| Minigame recipes (11 templates) | `server/data/minigame_recipes.seed.json` |
| **Style axis configs (Phase 3)** | `server/services/style_axes/*.json` (14 axes) |
| **Asset library (Phase 3)** | per-project: `<local_path>/sdk_data/asset_library/`; user-scope: `~/.23studios/user_library/`; global: `server/data/global_library/` |
| Runtime Lua (Playdate-side) | `server/services/sdk_runtime_lua/` (core: `main`, `scene_manager`, `scene_transition`, `save_state`, `sprite_base`, `input`, `animation`, `audio_manager`; concepts in `concepts/`) |
| Per-SDK-project data | `<local_path>/sdk_data/{project.json, story_bible.md, scenes/, characters/, sfx_baseline/, scene_music/, launcher/, asset_library/}` |

## Rules

### Runtime Lua bootstrap pattern (MANDATORY)

Every Lua module emitted into the Playdate side **must** follow the load-once pattern:

- Every system / data / concept module is imported ONCE in `main.lua` in dependency order.
- Each module self-binds to a global before returning:
  ```lua
  local M = {}
  -- ... module body
  _G.<module_name> = M
  return M
  ```
- **FORBIDDEN** outside `main.lua`: `local foo = import "concepts/foo"`. On hardware this captures nil and the game crashes silently.
- **CORRECT** access in any scene / system: `scene_manager.push(...)`, `dialog.pick(...)`, `save_state.get()`.

This pattern is enforced by `tools/preflight.sh` (port from HAKCD). Any code emitter (`scene_lua` stage, late-add ops, generated minigame slots) must produce code that passes this check.

### Preflight is the ship gate

`pdc compiled clean` is **not done**. The bar is:

1. `sdk_export.js` runs the QA checklist BEFORE pdc (already does — extend it).
2. Adopt HAKCD's `tools/preflight.sh` pattern: import discipline (grep for `local x = import` outside main.lua), save_state encapsulation, pdc compile, smoke test, asset verify.
3. **Smoke test SKIP=FAIL by default.** Pass `--allow-skip` only when running on CI without a Simulator installed.
4. Apply the same gate to every late-add operation rebuild.

### No placeholders

`server/services/playdate_validator.js` already exposes `isPlaceholder1bitPng`, `isPlaceholderPixelArt`, etc. **All Phase 3 asset import + generation paths must reject placeholders using these existing helpers** — do not reimplement detection. Stops at boundaries: `asset_import.js`, `style_axis.refineOption` outputs, late-add scene background regen.

### Global style picks are LIVE-READ each frame

Mirrors HAKCD's PwnGlove pattern (`chrome_theme.lua` reads `save_state.pwn_glove_equipped` live, not cached). Generalize for Phase 3:

- Any active style pick that affects rendering (HUD, dialog box, transition, chrome) is read from the asset-library index cache **each frame**, not pushed at scene init.
- `asset_library.js` exposes a fast in-memory accessor for the active picks; runtime Lua modules query via a thin Lua reader.
- This makes hot-swapping style picks via late-add ops show up immediately without scene reset.

### Demo discipline

- No `record_demo.sh` or screenshot live captures in previews, tests, or docs.
- Previews use **scripted inputs** (HAKCD `demo_reel.lua` pattern) or static frames generated by the renderer.
- `style_preview.js` previews are static images or short scripted-input Lua snippets — never live captures.

### Style-pick injection into LLM prompts

`sdk_autopilot.js` reads `<local_path>/sdk_data/asset_library/index.json` at every stage entry and feeds the active picks into the system prompt via `sdk_prompt_assembly.formatActivePicks(activePicks)`. Stages that consume specific axes are declared in each axis JSON's `consumed_by_stages` field. The `launcher` stage (the 9th) consumes `hardware_menu_style` — pause image, system menu items.

### Late-add operations are non-destructive

`server/services/late_add.js` operations:

- Never re-run the full 9-stage autopilot.
- Only regenerate assets whose `consumed_by_stages` includes a swapped axis.
- Keep replaced assets in the asset library so they can be reverted.
- Always preview the diff before committing.
- Rebuild the .pdx after any change, gate on preflight, refresh the simulator preview WS.

### Intake form layers (not rewrites) into the composer

`server/services/intake_form.js` already collects axis-adjacent data. Phase 3 ADDS `mapIntakeToAxisDefaults(intake)` to seed axis defaults:

| Intake field | Seeds |
|---|---|
| `genre` | `gameplay_style`, `pacing_style`, `audio_style` defaults |
| `format` | `gameplay_style.camera` |
| `archetype` | `character_style` |
| `crank` | crank-usage flag consumed by all relevant axes |
| `audio` | `audio_style.music_palette` |
| `save_state` | `save_style.trigger` |

`IntakeForm.jsx` stays as the front door. `composer_v2.jsx` walks the 14 axes for refinement after intake completes. Defaults-only users click through; control-wanting users refine per axis.

### NPC dialog: separate from HAKCD dialog

HAKCD `concepts/dialog.lua` stays a linear pool sampler with `pick_unseen` rotation — that's a real feature for ambient barks. Phase 3 builds **separate** `sdk_runtime_lua/concepts/dialog_tree.lua` for branching dialog (choices, conditions, flag setting). Scenes import whichever they need. No HAKCD backport required.

### Preset packs are seeds

Ship 8 starting packs in `server/services/preset_packs_data/`: `classic_adventure`, `noir_thriller`, `1bit_horror`, `cozy_sim`, `rhythm_game`, `metroidvania`, `twine_visual_novel`, `arcade_action`. snake_case ids, display names in the JSON. **HAKCD itself becomes the 9th pack** once Phase 4 derives picks from the live HAKCD project. User-scope library accumulates more packs as projects flag picks `for_reuse: true`.

### Scene manager swap is breaking — that's fine

Pre-Phase-3 generated games are throwaway test output. Replacing 23studios's flip-based `sdk_runtime_lua/scene_manager.lua` with HAKCD's stack-based version (`push`/`pop`/`replace`, `exit` runs before `init`) breaks any prior generated scene_lua. **Acceptable.** Update the `scene_lua` stage augment in `sdk_prompt_assembly.js` to emit code matching the new API before regenerating any project.

### Use what's already there

- **Image gen**: `server/services/pulp_ai.js` (`generateScene` 400×240, `generatePortrait` 64×64, `generateTileArt`). Don't write new gen paths.
- **Procedural SFX**: `sfx_synth.js` baseline 6 WAVs + `generateOne(preset)`.
- **Tracker music**: `music_library.js` (`pickForScene`, `renderTrack`).
- **Dither**: `dither.js` (threshold, Bayer 4×4, Floyd-Steinberg, Atkinson).
- **Validation**: `playdate_validator.js` — single source of truth for "is this Playdate-safe".
- **Sharp**: already a dep. Use for any image manipulation (alpha channel, resize, composite). No hand-rolled PNG byte ops.
- **LLM**: `claude.js` (Claude Code subprocess) or `openrouter.js`. **No new LLM client** and **no Anthropic SDK dep** added to this repo.

### Seed data is canonical — reference it, don't regenerate

- `server/data/feature_manifest.seed.json` (44 KB) — Playdate SDK feature catalog.
- `server/data/minigame_recipes.seed.json` (43 KB) — 11 minigame templates with `lua_template` + `visual_brief` + recipe metadata.

`style_axis.js` reads these when generating options for `minigame_style` (uses recipes as default option pool) and any axis referencing SDK features. **Do not duplicate this data inside axis configs.**

### Conventions

- **Server:** Node 20+, CommonJS (`module.exports = { ... }` + `require()`). Matches the rest of `server/services/`.
- **UI:** `.jsx` (React + Vite + Tailwind). **No TypeScript migration.** Plan docs referencing `.tsx` are wrong — treat as `.jsx`.
- **Commits:** Conventional Commits (`type(scope): description`). Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- **Tests:** alongside source or in `tests/`. Smoke pipeline: `npm run smoke:sdk`.
- **No AI co-author attribution.** Cory commits as Cory.

### Do Not

- Cite `help.play.date` for anything. Only `sdk.play.date/3.0.6/`.
- Add new LLM clients. Use `claude.js` or `openrouter.js`.
- Add TypeScript or pnpm. This is CommonJS + npm.
- Re-run the full 9-stage autopilot for late-add operations.
- Cache active style picks at scene init — live-read every frame.
- Ship placeholder art. `playdate_validator.isPlaceholder*` rejects at import.
- Use `record_demo.sh` or live capture for previews.
- Commit secrets or credentials.
- Skip preflight.
