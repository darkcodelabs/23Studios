# How 23Studios Generates a Game

A self-contained explainer for an external reviewer. Covers the end-to-end
pipeline: from a pitch sentence to a sideloadable Playdate `.pdx`. No
internal jargon assumed.

---

## 1. What 23Studios Is

23Studios is a **Playdate game-authoring platform**. It is **not** a game.
It is the toolchain that produces games. The platform itself is a Node 20
HTTP server (CommonJS), a React + Vite + Tailwind UI (`.jsx`, no
TypeScript), and a Python sidecar service (the Visual Pack Factory) for
production-ready 1-bit art generation.

Output: a directory tree containing `source/*.lua` + `source/images/*.png`
+ `source/sounds/*.wav` + `source/pdxinfo` that `pdc` (the Playdate SDK
compiler) builds into a `.pdx`. The `.pdx` is sideloaded to a Playdate or
loaded into the Playdate Simulator.

Two project types:

| `game_type` | Status | Notes |
|---|---|---|
| `sdk`   | Active | Lua + `pdc` projects. The full 9-stage autopilot targets this. |
| `pulp`  | Legacy | Pulp (Playdate's no-code authoring tool) projects. Still supported but no new development. |

This doc focuses on `sdk` projects — Lua + `pdc`. Pulp is mentioned only
where the codebase reuses Pulp code paths.

---

## 2. Sources of Truth

| Need | Location |
|---|---|
| Playdate SDK 3.0.6 API surface | `~/.claude/skills/playdate-developer/` (skill bundle with `dev_quick_ref.md` + `references/api_index.json`) |
| Authoritative Playdate doc | `https://sdk.play.date/3.0.6/` — never `help.play.date` |
| 9-stage SDK autopilot | `server/services/sdk_autopilot.js` |
| Stage prompt assembly | `server/services/sdk_prompt_assembly.js` |
| Per-project on-disk state | `<local_path>/sdk_data/{project.json, story_bible.md, scenes/, characters/, sfx_baseline/, scene_music/, launcher/, asset_library/}` |
| Project registry | `server/data/projects.json` |
| Style axis configs (Phase 3) | `server/services/style_axes/*.json` (14 axes) |
| Asset library | per-project: `<local_path>/sdk_data/asset_library/`; user-scope: `~/.23studios/user_library/`; global: `server/data/global_library/` |
| Runtime Lua emitted into games | `server/services/sdk_runtime_lua/` |
| Visual Pack Factory (art gen) | `services/visual_pack_factory/` |
| LLM clients | `server/services/claude.js` (Claude Code subprocess), `server/services/openrouter.js` (raw OpenRouter HTTP) |

---

## 3. The Project Model

A "project" is a row in `server/data/projects.json` plus a directory on
disk at `local_path`.

```jsonc
{
  "id": "hakcd",                          // slug, primary key
  "name": "HAKCD",
  "description": "1998 phreaker coming-of-age...",
  "local_path": "/home/hakcer/projects/personal/hakcd",
  "platform": "playdate",
  "publisher": "23 Studios",
  "developer": "Cory Kennedy",
  "build_command": "",                    // optional: custom build wrapper
  "preflight_command": "",                // optional: custom QA gate
  "game_type": "sdk"
}
```

The directory at `local_path` is where everything lands:

```
<local_path>/
├── source/
│   ├── main.lua
│   ├── pdxinfo
│   ├── data/                # visual_spec.lua, canon graph, etc.
│   ├── images/              # 1-bit PNGs ready for pdc
│   ├── sounds/              # WAV (sfx) + MP3/wav (music)
│   ├── scenes/
│   └── ...
├── sdk_data/                # the authoring DB the autopilot reads/writes
│   ├── project.json
│   ├── story_bible.md
│   ├── scenes/<id>.json
│   ├── characters/<id>.json
│   ├── sfx_baseline/
│   ├── scene_music/
│   ├── launcher/
│   └── asset_library/
│       └── index.json        # active Phase-3 style picks
├── tools/                   # project-local helpers (preflight, validate)
└── build/                   # pdc output, sentinels
```

CRUD: `server/services/projects.js` (`createProject`, `getProject`,
`patchProject`, `deleteProject`). REST: `server/routes/projects.js`.

---

## 4. Inputs

Three pieces of authored input drive the autopilot:

### 4.1 The Pitch

A single sentence or short paragraph. Passed to the autopilot when you
start it:

```
POST /api/projects/:id/sdk/autopilot/start
{ "pitch": "1998 phreaker war-dials a BBS run by a dead hacker..." }
```

The pitch seeds the **brainstorm** stage. Multiple alternate concepts are
fanned out from this seed.

### 4.2 The Story Bible

`<local_path>/sdk_data/story_bible.md` — a free-form markdown design
document. Beats, not dialogue. Acts, characters, tone, setting,
antagonist. Every stage receives the bible as system context (the
autopilot logs `"story_bible.md loaded (N chars) — every stage will
receive it as system context"`).

A parallel typed parse (`bibleParser`) extracts cast / scenes / acts /
beats so stages can selectively pull structured slices.

### 4.3 The Intake Form

`<local_path>/sdk_data/sdk.json :: intake` — a small JSON record from
`IntakeForm.jsx`. Fields:

| Field | Seeds |
|---|---|
| `genre` | `gameplay_style`, `pacing_style`, `audio_style` defaults |
| `format` | `gameplay_style.camera` |
| `archetype` | `character_style` |
| `crank` | crank-usage flag consumed by relevant axes |
| `audio` | `audio_style.music_palette` |
| `save_state` | `save_style.trigger` |

Intake LAYERS into defaults; it does not replace the composer. The user
can refine each of the 14 style axes after intake completes
(`composer_v2.jsx`).

---

## 5. The 9-Stage SDK Autopilot

`server/services/sdk_autopilot.js`. One `startSdkAutopilot({projectId,
pitch, onEvent, skipBatchGates, forceRegen})` call drives the whole
thing. Stages run sequentially. State is persisted to disk so a run can
resume after a crash or a manual gate.

```
┌────────────┐    ┌──────────────┐    ┌────────────┐    ┌────────────┐    ┌───────────────┐
│ brainstorm │───▶│ story+scenes │───▶│ characters │───▶│ scene_bursts│───▶│ portrait_bursts│
└────────────┘    └──────────────┘    └────────────┘    └────────────┘    └───────────────┘
                                                                                  │
┌──────────┐    ┌─────────────────┐    ┌─────┐    ┌───────┐    ┌──────────┐       │
│ launcher │◀───│      music      │◀───│ sfx │◀───│ dialog│◀───│ scene_lua │◀──────┘
└──────────┘    └─────────────────┘    └─────┘    └───────┘    └──────────┘
```

| # | Stage | Output | Consumed style axes |
|---|---|---|---|
| 1 | `brainstorm` | N alternate concept pitches; gate `concept_pick` waits for human selection | `tone`, `pacing_style` |
| 2 | `story+scenes` | scenes manifest, story beats, act structure | `gameplay_style`, `pacing_style` |
| 3 | `characters` | cast roster + per-character data | `character_style` |
| 4 | `scene_bursts` | per-scene background PNG (1-bit, 400×240) via `pulp_ai.generateScene` | `scene_style`, `dither_style`, `mood_style` |
| 5 | `portrait_bursts` | per-character dialogue portrait (1-bit, 64×64) via `pulp_ai.generatePortrait` | `character_style`, `portrait_style` |
| 6 | `scene_lua` | one `<scene_id>.lua` per scene, conforming to the runtime bootstrap rules (see §6) | `interaction_style`, `chrome_theme` |
| 7 | `sfx` | 6 baseline WAVs + per-scene SFX via `sfx_synth.generateOne(preset)` | `audio_style` |
| 8 | `music` | per-scene track assignment via `music_library.pickForScene` + `renderTrack` | `audio_style.music_palette` |
| 9 | `launcher` | `pdxinfo`, system-menu items, pause image, launch card | `hardware_menu_style` |

Each stage emits events through `onEvent(kind, data)`:

- `phase {id}` — entered a stage
- `log {text}` — informational
- `gate {gate, ...}` — waiting on human input (e.g. `concept_pick`)
- `error {message}`
- `done {awaiting_gate?}` — terminal

Gates default to **blocking**. Pass `skipBatchGates=true` (or env
`SKIP_BATCH_GATES=1`) to bypass batch gates while still honouring
critical ones.

---

## 6. The Runtime Lua Bootstrap Rule (Mandatory)

Every `.lua` file emitted into the Playdate side **must** follow the
load-once pattern. This is enforced by `tools/preflight.sh`. Any code
emitter that violates it will fail the build.

```lua
-- main.lua imports every module ONCE in dependency order:
import "concepts/scene_manager"
import "concepts/save_state"
import "concepts/dialog"
-- ...

-- Each module self-binds to a global before returning:
local M = {}
-- ... module body ...
_G.scene_manager = M
return M

-- Any scene / system accesses via the global:
scene_manager.push(...)
save_state.get()
```

Forbidden outside `main.lua`:

```lua
local foo = import "concepts/foo"   -- on hardware this captures nil and
                                    -- the game crashes silently
```

The `scene_lua` stage prompt explicitly emits code matching this
pattern. The `preflight.sh` import-discipline grep blocks the build on
any violation.

---

## 7. Image Generation Paths

Two distinct paths, two distinct purposes.

### 7.1 `server/services/pulp_ai.js` — autopilot art

Used by stages `scene_bursts` and `portrait_bursts`. Calls OpenRouter's
chat-completions multimodal API (`modalities: ['image', 'text']`) with
`openai/gpt-image-1` or equivalent. Returns base64-encoded PNGs in
`message.images[0].image_url.url`.

- `generateScene` — 400×240, scene background
- `generatePortrait` — 64×64, dialogue portrait
- `generateTileArt` — tile art

Project-context-coupled (project lookup, pulp_dir logging, spend
tracking via `openrouter_spend.js`, reference picking via
`references.js`). Designed for the autopilot's stage-level use.

### 7.2 `services/visual_pack_factory/` — pack-based art

A **shared service**. Per-game packs of authored-looking art produced
via a review pipeline, intake-only, project-agnostic. HAKCD was the
first consumer; HaxHeadroom is the second.

Pack lifecycle (state machine):

```
generated ─▶ queued_for_review ─▶ approved_for_iteration ─┐
                              ─▶ rejected                  │
                              ─▶ needs_correction          ▼
                                                    approved_final
                                                           ▼
                                                   hardware_reviewed
                                                           ▼
                                                       exported
```

Tools (Python, in `tools/`):

| Tool | Purpose |
|---|---|
| `init_pack.py` | bootstrap a new pack (`pack_config.yaml`, skeleton dirs, base prompt seed) |
| `add_source.py` | register inspiration sources (image / url / sketch / note); usage forced to `inspiration_only` |
| `generate_pack.py` | ingest a candidate file (intake-only path) |
| `generate_candidates.py` | call a **provider** (OpenRouter, mock) to produce N candidates, postprocess to 1-bit at target dims, ingest |
| `regenerate_candidate.py` | re-gen from a parent + correction notes, preserves lineage |
| `queue_review.py` | move `generated` → `queued_for_review` |
| `approve_candidate.py` | `--level final` requires `--reviewer`; writes `approvals.yaml` |
| `reject_candidate.py` | `rejected` or `needs_correction` + correction notes |
| `export_candidate.py` | copy approved candidate into game repo, enforce target dimensions |
| `update_visual_spec.py` | rewrite `<repo>/source/data/visual_spec.lua` from exported candidates, preserving hand-authored entries |
| `validate_pack.py` | exit 0/2/3; checks placeholders, dim mismatch, 1-bit colour, source usage, hardware review |
| `hardware_review.py` | attach a device photo + verdict; **only path** to set `hardware_reviewed=true` |
| `build_contact_sheet.py` | candidate / silhouette / hardware grid |
| `build_reference_board.py` | mood board from active sources |
| `extract_style_notes.py` | mean luminance, edge density, dark/light ratios per source |
| `convert_to_playdate.py` | 1-bit conversion (`--dither none` hard threshold, `--dither bayer4`); Floyd-Steinberg refused by design |
| `debug_candidate.py` | forensic dump of an existing candidate (entropy, tile-repeat, etc.) |
| `trace_generation.py` | per-stage dump of one gen for byte-level inspection |
| `build_lua_db.py` | salted SHA-256 puzzle DB compilation |
| `seed_hakcd_packs.py` | idempotent seeder for the 5 + 2 HAKCD packs |
| `_image_integrity.py` | shared integrity checks (PNG magic, IHDR, decode, entropy, black-fraction, tile-repeat) |

Providers (Python, in `providers/`):

- `base_provider.py` — abstract interface
- `provider_registry.py` — swappable registry
- `openrouter_provider.py` — chat-completions multimodal client (own
  Python HTTP client; project-agnostic, decoupled from `pulp_ai.js`)
- `mock_provider.py` — deterministic 1-bit pattern for offline smoke

Each prompt is composed of:

1. Per-pack-type opener (PACK_TYPE_OPENERS — SPRITE SHEET / ROOM
   DEVELOPMENT KIT / TILESET / UI COLLECTION / etc.)
2. Pack id + target dimensions
3. `PLAYDATE_VISUAL_RULES` (v3): 1-bit only, no AA, dithering is the only
   allowed shading, output must read at 32×32, etc.
4. `COPYRIGHT_FIREWALL` (references inspiration-only)
5. Authoring intent (the pack's base prompt + style guide)
6. Optional: correction notes (regen mode), parent candidate id

Postprocess: convert provider output (typically 1024×1024 RGB) to target
dims, hard-threshold to pure black/white. Validate via `_image_integrity`
before ingest. Optional `--strict-integrity` rejects on any warning.

---

## 8. Style Axes (Phase 3)

`server/services/style_axes/*.json` — 14 JSON configs that drive every
stage's prompt assembly. Each axis defines:

- `id`, `display_name`, `description`
- `default_option` and a pool of `options`
- `consumed_by_stages` — which autopilot stages read this axis

Examples: `gameplay_style`, `pacing_style`, `character_style`,
`scene_style`, `chrome_theme`, `dither_style`, `audio_style`,
`save_style`, `interaction_style`, `mood_style`, `portrait_style`,
`hardware_menu_style`, `minigame_style`, `tone`.

The autopilot reads `<local_path>/sdk_data/asset_library/index.json` at
every stage entry and feeds active picks into the system prompt via
`sdk_prompt_assembly.formatActivePicks(activePicks)`.

`minigame_style` and SDK-feature-referencing axes pull from canonical
seed JSON (`server/data/feature_manifest.seed.json`,
`server/data/minigame_recipes.seed.json`) — axis configs do **not**
duplicate this data.

### Live-read style picks

Style picks that affect rendering (HUD, dialog box, transition, chrome)
are read from the asset-library cache **each frame**, not pushed at
scene init. Mirrors HAKCD's PwnGlove pattern: `chrome_theme.lua` reads
`save_state.pwn_glove_equipped` live. This lets late-add operations
hot-swap picks without scene resets.

---

## 9. Late-Add Operations

`server/services/late_add.js`. Modify a project after the autopilot has
completed, **non-destructively**:

- Never re-run the full 9-stage autopilot.
- Only regenerate assets whose `consumed_by_stages` includes the
  swapped axis.
- Keep replaced assets in the asset library so changes can be reverted.
- Always preview the diff before committing.
- Rebuild the `.pdx`, gate on preflight, refresh the simulator preview
  WebSocket.

---

## 10. Validators

### 10.1 Preflight

`tools/preflight.sh` — the ship gate. `pdc compiled clean` is NOT done.
The preflight bar:

1. `sdk_export.js` runs QA checklist BEFORE `pdc`.
2. Import discipline: grep for `local x = import` outside `main.lua` — fail.
3. `save_state` encapsulation check.
4. `pdc` compile.
5. Smoke test (default `SKIP=FAIL`, pass `--allow-skip` only on CI without Simulator).
6. Asset verify.

Applies to every late-add rebuild.

### 10.2 V3 Visual Contract Validator

`<project_repo>/tools/canon/validate_visuals.sh` — parses
`source/data/visual_spec.lua`. Checks:

| Check | Behaviour |
|---|---|
| Every entry's `path` resolves on disk | FAIL |
| `placeholder` entries declare `target_replacement_version` | WARN |
| `final` entries have `human_reviewed=true` + `reviewer` | FAIL |
| `meets_readability_min` true OR `placeholder` exemption | WARN |
| At `pdxinfo` ≥ 0.2.0: no `placeholder` / `wip` shippable assets | FAIL |

WARN-only below pdxinfo 0.2.0, FAIL past the gate. Hooked into the
project Makefile so `make build` blocks placeholders past the gate.

### 10.3 Canon Validators (HAKCD-specific)

`tools/canon/validate_continuity.sh` — id-graph drift on
`source/data/*.lua`. Sentinel under `build/.validated/`. Cheap.

### 10.4 Factory `validate_pack.py`

Pack-state integrity, not build-state. Catches `placeholder_rejected` at
ingest (via `playdate_validator.isPlaceholderScenePng`),
`dim_mismatch`, `final_not_reviewed`, `not_1bit_color`,
`non_inspiration_usage`, `missing_hardware_review` (after
`--enforce-hardware`).

### 10.5 Hardware Review Gate

`hardware_review.py` is the **only** path to flip `hardware_reviewed=true`.
Requires a real device photo (not a simulator screenshot). Once
pdxinfo ≥ 0.2.0, `validate_pack --enforce-hardware` blocks any
`approved_final` without a hardware record.

---

## 11. LLM Clients

Two and only two. No new LLM clients are added to this repo.

| Client | Use |
|---|---|
| `server/services/claude.js` | Spawns the `claude` CLI as a subprocess. Used by stages that need agentic capability. **`claude --prompt-file` does NOT exist** — pipe prompts via stdin. |
| `server/services/openrouter.js` | Raw OpenRouter HTTP client used by `pulp_ai.js`. |
| `services/visual_pack_factory/providers/openrouter_provider.py` | Python OpenRouter client used by the factory. Project-agnostic. Separate from `pulp_ai.js` because the factory is project-agnostic intake-only. |

No Anthropic SDK dependency. No new gen paths added beyond the above.

---

## 12. Canonical Seed Data

Never regenerated — read at runtime by axis configs and prompt assembly:

- `server/data/feature_manifest.seed.json` (~44 KB) — Playdate SDK feature catalog
- `server/data/minigame_recipes.seed.json` (~43 KB) — 11 minigame templates with `lua_template` + `visual_brief` + recipe metadata

`style_axis.js` reads these when generating options for `minigame_style`
and SDK-feature-referencing axes. Axis configs do **not** duplicate this
data.

---

## 13. From Bible to `.pdx`: a Walk-Through

End-to-end, the path from a sentence to a sideloadable build:

1. **Create project record.** `POST /api/projects` with `id`,
   `local_path`, `game_type: "sdk"`, etc. The project row goes into
   `projects.json`; `local_path` is `mkdir`-ed.
2. **Author story bible.** Write `sdk_data/story_bible.md` by hand. This
   is the design document — beats, characters, antagonist, tone, setting.
3. **Fill intake.** `IntakeForm.jsx` writes `sdk_data/sdk.json :: intake`
   — genre, format, archetype, crank usage, audio palette, save-state
   trigger.
4. **(Optional) Tune style axes.** `composer_v2.jsx` walks the 14 axes.
   Picks land in `sdk_data/asset_library/index.json`.
5. **(Optional) Lock MVP vibe.** `/project/:id/mvp` Lock Vibe records
   approved anchors that prepend to every scene prompt.
6. **Start autopilot.** `POST /api/projects/:id/sdk/autopilot/start` with
   `{ pitch }`. The autopilot reads the bible, intake, picks, MVP lock,
   and walks all 9 stages.
7. **Resolve gates.** Each gate (`concept_pick`, batch gates if not
   skipped) waits for a human pick via the dashboard. Resolutions are
   persisted to disk so a restart resumes.
8. **(Optional) Generate authored-looking visual packs.** Use
   `visual_pack_factory` to produce sprite sheets / room kits / portrait
   sheets / UI collections / tile sets at production quality (real
   reference intake, review queue, hardware review). Approved exports
   land in `<local_path>/source/images/` and `update_visual_spec.lua`
   merges the entries into the canonical `source/data/visual_spec.lua`,
   preserving hand-authored rows.
9. **Preflight.** `tools/preflight.sh` runs import-discipline grep +
   `save_state` encapsulation check + `pdc` compile + smoke test (`SKIP=FAIL`)
   + asset verify. Blocks on any failure.
10. **`pdc` build.** `make` (project Makefile). `validate-visuals` runs
    first (Phase V3 visual contract), then `validate-canon` (Phase 7
    canon graph), then `pdc source build/<game>.pdx`.
11. **Sideload.** Drop the `.pdx` on the Playdate via USB or the Side
    Load page.
12. **Hardware review.** Photograph the device running the game. Run
    `hardware_review.py --photo <jpg> --verdict pass/fail` on every
    `approved_final` candidate that shipped. Photos are SHA-hashed and
    stored under `exports/hardware_review/`. Simulator screenshots do
    not count.
13. **Late-add operations.** When something needs changing without a
    full re-run, `late_add.js` operations regenerate only the affected
    axes' assets, preserve replaced assets in the library, preview
    the diff, rebuild the `.pdx`, gate on preflight, refresh the
    simulator WebSocket.

---

## 14. Hard Discipline (the "don'ts")

- No `help.play.date` references. Only `sdk.play.date/3.0.6/`.
- No new LLM clients. Use the two above.
- No TypeScript. No pnpm. CommonJS + npm.
- Never re-run the full 9-stage autopilot for late-add operations.
- Never cache active style picks at scene init — live-read every frame.
- Never ship placeholder art. `playdate_validator.isPlaceholder*`
  rejects at the factory ingest boundary.
- Never use `record_demo.sh` or live captures for previews. Use scripted
  inputs (HAKCD's `demo_reel.lua` pattern) or static frames generated
  by the renderer.
- Never commit secrets or credentials.
- Never skip preflight.

---

## 15. Project Conventions

- Server: Node 20+, CommonJS (`module.exports = { ... }` + `require()`)
- UI: `.jsx` (React + Vite + Tailwind); plan docs that reference `.tsx`
  are wrong — treat as `.jsx`
- Commits: Conventional Commits (`type(scope): description`).
  Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`. No AI
  co-author attribution (Cory commits as Cory)
- Tests: alongside source or in `tests/`. Smoke pipeline:
  `npm run smoke:sdk`
- Session coordination: every Claude session works on a branch named
  `claude-<session-uuid-short>/<task>`. The repo has a pre-commit hook
  enforcing the per-repo commit lock and the Cory git identity. After
  any commit, immediately push to origin so other sessions can see the
  work.

---

## 16. Known Spec Drift (real, in the codebase)

- The Phase 5 `claude --prompt-file` flag does **not** exist. Spec at
  `docs/23studios_phase5_iteration_loop.md` (Stage 3) is wrong — pipe
  prompts via stdin instead. See the comment at the top of
  `server/services/claude.js`.
- Minigame recipes live in a single seed JSON (`server/data/minigame_recipes.seed.json`),
  not per-recipe files. Spec at Stage 1.4 is wrong.
- `lockpicking_minigame.png` is actually `lockpicking_minigme.png` in
  the source filename (typo missing the `a`). References use the typo'd
  path. Do not rename.

---

## 17. Why This Exists

23Studios solves three concrete pain points in Playdate development:

1. **The blank-canvas problem.** Going from "pitch" to "first playable"
   on Playdate is mostly assembly: writing scene boilerplate, hooking
   up the scene manager, wiring an input handler, dropping in a save
   state, generating placeholder art that becomes real art later. The
   autopilot eliminates that assembly.
2. **The hardware-vs-simulator gap.** Playdate art looks great on a
   high-DPI desktop simulator and falls apart on the 1-bit reflective
   LCD under fluorescent light. The Visual Pack Factory's
   `hardware_review.py` gate makes "no device photo, no ship" a hard
   rule.
3. **The non-destructive iteration problem.** Late-stage requests like
   "swap the chrome theme" or "regenerate the bedroom scene only" used
   to mean re-running the whole pipeline. `late_add.js` regenerates only
   the affected axes' assets, preserves replaced versions in the
   library, and rebuilds the `.pdx` in seconds.

The platform is opinionated. The 14 style axes, the 9-stage autopilot,
the bootstrap pattern, the no-placeholder rule, the hardware-photo gate
— all are choices, not defaults. They exist because the alternative is
a half-built Playdate game that crashes silently when imports go wrong,
ships placeholder rectangles, and never gets reviewed on actual hardware.

---

*This doc is hand-maintained, not generated. Last touched concurrently
with the v3 Playdate Asset Generation Standard sprint.*
