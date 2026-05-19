# Phase 6: Web App Overhaul — Intake-to-Ship Authoring Environment

**Status:** SPEC (not implementation). Approve before any code is written.
**Author:** Phase 6 spec draft, 2026-05-18.
**Prereqs:** Phase 4 (HAKCD validation) shipped, Phase 5 (iteration loop) shipped.

---

## Premise

The 23 Studios web app today is a chat interface bolted to a process. The user hands it a story bible, a style canon, a SKILL.md, and a reference image library — and then watches the orchestrator hand-decompose all of it scene by scene, agent by agent. The pipeline is mature enough that the surface must catch up.

The reference point is Panic's own SDK marketing shot (Pulp editor + sound studio + simulator + code editor + asset pipeline — all integrated, all aimed at shipping a Playdate game). 23 Studios needs the same coherence PLUS the AI-orchestration surfaces that Panic's tooling doesn't need.

Phase 6 ships a two-half web app:

1. **Upstream (Intake-to-Requirements):** the app reads the source material and derives the work itself, then interviews the user to close gaps, then locks scope, then emits a work graph that drives everything downstream. No more hand-rolled todo lists.

2. **Downstream (Authoring IDE):** Panic-grade tooling — storyboard, scene manager, asset approver, prompt canon viewer, reference library, agent dashboard, sim integration, cost panel, gate review, Lua editor, build pipeline — all driven by the work graph, all surfacing live status.

PLUS AI-pipeline extensions: agent visibility, decision log, drift detector, reference grounding enforcement. The things Panic doesn't need because they aren't AI-orchestrated.

---

## Why now

Lessons from the HAKCD Phase 4 build (concrete pain points this spec answers):

1. **Permission gates stalled pipeline-driver agent silently.** Orchestrator only noticed when the user asked "is this updating in the UI." → Agent dashboard with live status fixes this.
2. **QA regex false positive blocked build at gate.** Drift detector should have flagged the regex was matching the wrong scope BEFORE export. → Drift detector + dry-run QA.
3. **Bible-reader missed 7 reference images** because the orchestrator gave it an incomplete list. → Intake auto-enumerates the entire reference library.
4. **Scope decisions made ad-hoc in chat** (haxheadroom defer, coin static, etc.). No persistent record beyond conversation scrollback. → Interactive interview produces structured decision log.
5. **Cost meter never surfaced actual OpenRouter spend.** User had no visibility into burn. → Live cost panel.
6. **8 scenes generated vs 26 in bible.** No pre-flight warning that the platform's autopilot wouldn't cover full scope. → Work graph projects expected output BEFORE generation runs.
7. **Manual scene/character/asset decomposition** consumed an hour of orchestrator turns. → Parse + extract automates it.

This spec is reactive engineering. Every section maps to a problem already lived through.

---

## Definitions

| Term | Meaning |
|---|---|
| **Source material** | Bible (story), canon (style spec/prompts), SKILL.md (platform rules), reference image library, optional supplementary refs (URLs, videos, music, anecdotes) |
| **Requirements doc** | Machine-readable enumeration of every asset/scene/character/UI-surface/sfx/music/Lua module the game needs, with anchors + canon refs + SKILL.md rules + dependency chain + cost estimate |
| **Coverage gap** | A requirement that has no canon prompt, no reference anchor, or no dependency satisfied |
| **Scope lock** | A frozen subset of requirements that the user has approved for v0.x — anything outside scope is deferred with rationale |
| **Work graph** | DAG of every task (asset, scene, Lua module, sfx, music, validation, gate), with dependencies, agent assignments, cost projections, and status fields |
| **Decision log** | Append-only record of every choice the orchestrator made autonomously vs escalated to user; filterable; auditable |
| **Drift** | A generated prompt or asset that deviates from canon/SKILL.md without explicit override |
| **Gate** | A user-blocking checkpoint (e.g., scope lock, visual ship review, smoke test) that must be signed off before downstream work proceeds |

---

# SECTION A — UPSTREAM: Intake-to-Requirements Pipeline

This whole section runs BEFORE any image generation, Lua emission, or build burn happens. Output of Section A is the scope-locked work graph that drives everything in Sections B and C.

---

## A1. Intake (upload + tag)

### Purpose
Single entry point for all source material. Replaces the current pattern of "user hands paths to the orchestrator via chat."

### Inputs (v1)
- Story bible (markdown, plain text, or PDF — the app parses to text)
- Style canon (markdown — the prompt-language spec)
- SKILL.md (or equivalent platform constraints file)
- Reference image library (folder upload or git-tracked path)
- OPTIONAL: supplementary references — URLs, videos (with frame-extraction toggle), music references, anecdote/note files

### Inputs (deferred to v1.5)
- **Voice notes as pre-uploaded artifacts** (audio file → transcript on upload). Rationale: A5 interview already supports live voice input (Web Speech), which covers the same need without requiring a transcribe-on-upload pipeline. Defer the upload-and-transcribe path until v1.5 once usage patterns show it's needed.

### UX skeleton
- New project flow: 4-step wizard (Bible → Canon → SKILL → References) OR drag-and-drop a project folder with auto-detection
- Each upload gets a tag panel: who wrote it, version, last-edited, hash for change detection
- References get bulk-tag UI: pick subjects (scenes, characters, UI surfaces) from a dropdown populated by parse stage
- Re-intake: if the user updates the bible mid-project, the app diffs old vs new, surfaces affected requirements, asks "re-derive impacted items?"

### Outputs
- Project state: `{ source_files: [...], hashes: {...}, parsed: false }`
- Server-side mirror at `<project>/sdk_data/source/` so all stages reference the same canonical paths

### Ships in
v1 — required for everything else.

### Dependencies
None upstream. Everything downstream depends on A1.

---

## A2. Parse + Extract

### Purpose
App reads all source material and structures it into machine-readable form. The "automated bible-reader" we hand-rolled for HAKCD becomes a first-class stage.

### Extraction targets (per HAKCD spec from user)
- **Story beats**: acts, scenes (ID, title, summary, characters present, gameplay type), transitions between scenes
- **Characters**: name, role, traits, dialog samples (with attribution), portrait references
- **Locations**: name, description, anchor reference image (if any), scenes that use it
- **Props / inventory items**: name, source scene, anchor reference, sprite requirements
- **UI surfaces**: menus, HUDs, dialog boxes, transition screens, inventory grids, status bars
- **Sound cues**: SFX triggers (per-scene + global), music beds (per-scene + per-act)
- **Minigames / mechanics**: name, scene, input mechanic, win/loss states (where bible specifies)
- **Cameo / personalization beats**: lines, scenes, source notes (e.g., "Cory K. SC26")
- **Style anchors**: which reference images map to which scenes/characters/UI surfaces

### Extraction technique
LLM-driven extraction via Claude (subprocess per Phase 5 cost split — iteration model). Bible + canon + reference filenames go in as one prompt; structured JSON comes out. Reference image visual content extracted via multimodal call (one per image, batched within a single Claude session for consistency).

### Outputs
- `<project>/sdk_data/requirements/extracted.json` — fully-structured extraction
- `<project>/sdk_data/requirements/reference_catalog.json` — every PNG with: dimensions, dither type, composition, anchored-to subject, content description
- `<project>/sdk_data/requirements/extraction_log.json` — what the parser pulled, what it skipped, what it flagged as ambiguous

### Ships in
v1.

### Dependencies
A1 (uploaded source).

### Acceptance bar
Re-running parse on the HAKCD source must produce the same scene list, character list, and reference anchor map that bible-reader produced manually — or better.

---

## A3. Requirements Derivation

### Purpose
Cross-reference parsed extraction against SKILL.md + canon to enumerate every concrete deliverable.

### Output format (per HAKCD example)
```
Based on the source material, you need:
- N scenes (each with: ID, act, summary, characters, gameplay type, anchor refs, canon section, SKILL.md rules, dep chain, est cost)
- M character portraits (each with: name, source scenes, reference if any, sprite size per SKILL.md, est cost)
- K unique location backgrounds (each with: scenes that use it, anchor ref, canon section, est cost)
- Coin gallery: 24 slots × imagetable cells (designed vs placeholder split)
- Inventory items: list with sprite spec
- UI surfaces: title, launcher, menus, HUDs, transitions
- Coin imagetable (24 cells)
- X sfx cues + Y music beds
- Z Lua scene modules
- N dialog blocks
TOTAL: estimated $Z OpenRouter spend at 0 reroll, $Z' at 1.5 reroll/scene avg
```

### Per-item fields (the requirements row schema)
- `id` (stable)
- `kind` (scene_bg, character_portrait, sprite, sfx, music_bed, scene_lua, dialog_block, ui_surface, inventory_item, imagetable, launcher_asset)
- `title` (human label)
- `source_refs` (bible section quoted, canon section cited)
- `anchor_refs` (list of reference image paths)
- `skill_rules` (which SKILL.md rules govern this item)
- `dependencies` (other requirement IDs that must complete first)
- `est_cost_usd` (per generation pass)
- `reroll_budget` (default 2 from user-configurable global)
- `agent_assignment` (which agent type handles it)
- `gate_blocks` (which gates block this item from shipping)
- `status` (pending / queued / in_progress / done / failed / deferred)
- `notes` (free-form annotation from user)

### Outputs
- `<project>/sdk_data/requirements/derived.json` — the full requirements doc
- Browsable HTML rendering at `/project/<id>/requirements`
- Diff view if re-derived: what changed since last run

### Ships in
v1.

### Dependencies
A2.

### Acceptance bar
For HAKCD, the derived requirements must enumerate all 26 scenes the bible names + 15 characters + 8 unique locations + 24 coin slots + PWNGLOVE variants + launcher + title — without manual decomposition.

---

## A4. Coverage Gap Analysis

### Purpose
Tell the user what the source material doesn't cover so they can fix it before generation.

### Cross-references performed
- Each scene against canon: explicit prompt | derivable from canon §3 preamble | needs new canon | needs reference anchor | uncovered
- Each scene against reference library: has anchor | adjacent-scene anchor borrowable | no anchor (must derive from GLOBAL_STYLE master)
- Each character against reference library: has portrait ref | needs derivation
- Each minigame against canon recipes (`server/data/minigame_recipes.seed.json`): existing recipe | needs new recipe | deferred
- Each SFX/music cue against existing seed libraries

### Output format
```
COVERAGE REPORT:

Scenes (26 total):
  ✓ 13 have explicit canon prompts (SC01, SC02, SC03, SC09, SC15, SC17, SC18, SC25, SC26, ...)
  ⚠ 7 can derive from existing canon + closest-adjacent anchor (SC04, SC05, SC07, SC13, SC14, SC22, SC23)
  ✗ 6 have no canon and no reference anchor (SC06, SC16, SC19, SC20, SC21, SC24)
       → options: (a) write new canon entries, (b) derive from GLOBAL_STYLE master + bible only, (c) defer to v0.2

References (18 images cataloged):
  ✓ 10 anchored to specific scenes
  ⚠ 2 ambiguous (chat.png is byte-dupe of bbs_chat_close.png; room3.png subject unclear)
  ✗ 6 named-in-bible items have NO reference image (k0nsole portrait, mom voice-only, SC20 Aegis tech support visual, ...)

Minigames (5 implied by bible):
  ✓ 3 covered by existing platform recipes (crank_lockpick, dialog_tree, hotspot_system)
  ⚠ 1 needs custom recipe (red box DTMF — extends dialog_tree pattern)
  ✗ 1 deferred-by-default (haxheadroom — no bible spec, only reference image)

SKILL.md rule violations forecast (zero generated yet, projection from canon):
  ⚠ Canon §10 blue box scene uses 2600 Hz + "trunk seized" — will trip OpenRouter filter; falls back to §17 filter-safe rewrite (1 reroll budget burned per scene)
```

### Outputs
- `<project>/sdk_data/requirements/coverage_report.json`
- Browsable rendering at `/project/<id>/requirements/coverage`
- Inline per-requirement annotation: each row in the requirements doc shows its coverage status

### Ships in
v1.

### Dependencies
A2 + A3 + the reference catalog from A2.

---

## A5. Interactive Requirements Interview

### Purpose
Close coverage gaps by interrogating the user with specific, pointed questions. Not a wall — a queue. Not a parser dump — a conversation.

### Categories the app interrogates (verbatim from user spec)

#### Minigames + Mechanics
- For each mechanic identified: scope-in or out, input mechanic (crank/d-pad/timing), win/loss state, difficulty curve, fail behavior, retry, accessibility skip
- For unscoped references (haxheadroom): in or out for v0.x, unlock scene, mechanic spec
- For multi-instance puzzles (23 coins): N distinct puzzles vs N instances of one mechanic, per-puzzle solve logic vs gallery-only
- For ambiguous-affordance items (PWNGLOVE): passive inventory vs active interaction, scene bindings

#### Additional Assets Needed
- Location reuse confirmations: SC14/SC23 reuse SC01 OR distinct visual state?
- Missing portraits/sprites: provide ref OR describe-and-derive
- SFX/music count confirmation + expansion
- Transition styles: hard cut default OR specific (dither-wipe / scanline / chromatic distortion per act)

#### Context + Research Fill-ins
- Era-appropriate reference suggestions: reference image / URL / "derive from canon"
- Specific-location anchors: real place OR generic
- Dialog style decisions: canon-style handles OR preserve user's archive
- Specific numbers/easter-eggs: canonical (816/913 for KC) OR fictional OR personal-history

#### URLs + External References
- Art-informing archives (AOL screenshots, AOHell, Phrack scans, NFO repositories, Hackers 1995 screenshots, BBS ad archives) — scraped and tagged as supplementary refs
- Video references — frame extraction for visual energy
- Music references — for SFX/bed mood targeting (not licensing)

#### Notes, Anecdotes, Personal Context
- Cameo dialog verbatim hooks (e.g., Cory K. lines in SC26)
- Real venue / community details (SecKC, Knuckleheads, CCCKC)
- Group references for in-game NFO art (RAZOR1911, FAIRLIGHT, ACiD)
- Era specifics: year (1996/97/98) cascades to modem speed, AOL version, browser refs

#### Gaps the App Found On Its Own
- Bible-mentioned-but-undescribed scenes ("SC04 PhoenixDown has no description beyond title — what happens here?")
- Characters with no dialog samples — derive voice from traits OR user provides
- Climactic scenes with no fail state — restart / bad-ending branch / single-path

### Interaction Model
- **One question at a time** OR **grouped by category** — user toggle
- Per-question actions: `Answer` | `Skip for now` | `Let autopilot decide` | `I need to think` | `Defer to v0.2`
- **Live doc update**: each answer mutates the requirements doc in real time; user sees the doc evolving
- **Decision tracking**: every gap resolution tagged (user-answered, canon-derived, autopilot-decided, deferred)
- **Re-ask escalation**: if "let autopilot decide" picks something high-stakes, it pops back into the queue for explicit user sign-off. High-stakes = ANY of:
  1. Introduces a NEW named character voice not in bible
  2. Defines a NEW mechanic spec not previously locked
  3. Single-call cost > $1.00 OR projected adds > 5% to remaining budget
  4. Creates a NEW canon section (vs citing an existing one)
  5. Adds a scene outside the locked scope (scope creep)
- **Voice input**: Web Speech API transcription accepted as answer text; user confirms transcript before commit

### Output
- Fully-fleshed requirements doc (every gap closed or explicitly deferred)
- Tagged reference library (every URL/image/anecdote/note linked to the scene/asset it informs)
- Confirmed minigame list with mechanic specs
- Asset list with anchor per item
- Scope lock candidate (ready for A6)

### UX skeleton
- Dedicated screen at `/project/<id>/interview`
- Queue panel on left (categorized; filter by status)
- Question panel center (rich-text answer area + chips for common answers + voice button)
- Live requirements diff panel right (red/green strikethrough on what changed)
- Bottom bar: progress meter (N of M gaps closed), "Lock scope" CTA (disabled until critical gaps closed)

### Ships in
v1 (the upstream is incomplete without this — see "Without this stage..." in the user's spec).

### Dependencies
A4 (coverage gaps drive the question queue).

### Acceptance bar
- For HAKCD re-run, the interview must surface the same scope decisions the orchestrator made in chat (haxheadroom defer, coin static, PWNGLOVE/POWERGLOWE split, etc.) as explicit questions with the same options.
- Voice transcription accuracy ≥ 90% on technical terminology (handle names, era refs).
- User can complete a full interview pass for HAKCD in under 30 minutes.

---

## A6. Scope Proposal + Lock

### Purpose
Translate the fleshed requirements + user interview into a concrete v0.x scope. Mark deferred items with rationale. User approves / adjusts / cuts. App freezes the scope.

### Proposal mechanism
- App proposes default scope based on:
  - Budget constraint (user-configurable max OpenRouter spend)
  - Dependency closure (only include items whose deps can satisfy)
  - Coverage threshold (only include items where canon + anchor + bible together produce ≥ X% confidence per the drift detector model)
  - User-marked "in scope" answers from A5
- Items defaulted to deferred with rationale:
  - "haxheadroom: no canon, no bible spec, would require new recipe + new canon entry; deferred to v0.2"
  - "23 Coins backing logic: bible doesn't specify per-coin puzzle rules; v0.1 static gallery, logic deferred to v0.2"

### UX skeleton
- Two-column proposal at `/project/<id>/scope`
- Left: "In v0.1" — list of items with cost subtotal at bottom, drag-to-defer
- Right: "Deferred to v0.2+" — list of items with rationale, drag-to-include
- Top: budget meter, total cost, scene count, est generation time
- "Lock scope" button → freezes both lists, emits work graph (A7)
- Locked-scope JSON is git-tracked at `<project>/sdk_data/scope/v0.1.json` so it's auditable + roll-backable

### Ships in
v1.

### Dependencies
A5 (closed gaps).

### Acceptance bar
User can lock the HAKCD v0.1 scope (8 scenes for first cut, deferring 18) OR the full 26-scene scope, with the app correctly enumerating dependency closures both ways.

---

## A7. Work Graph Generation

### Purpose
The locked scope becomes a DAG of every task. The graph IS the autopilot input. No more hand-built todo lists.

### Graph node schema
```
{
  "id": "task-SC01-scene_burst",
  "requirement_id": "req-scene-SC01",
  "kind": "scene_burst",
  "title": "SC01 Bedroom Hub — generate background",
  "agent_assignment": "openrouter:openai/gpt-5-image-mini",
  "prompt_source": "canon:§4 verbatim",
  "anchor_inputs": ["pixel_collection/bedroom.png", "haKCd_demo.png"],
  "skill_rules": ["1bit", "400x240"],
  "depends_on": [],
  "blocks": ["task-SC01-scene_lua"],
  "est_cost_usd": 0.08,
  "reroll_budget": 2,
  "gate_blocks": ["GATE-2-visual-ship"],
  "status": "pending",
  "started_at": null,
  "finished_at": null,
  "attempt_log": [],
  "output_paths": []
}
```

### Graph edge semantics
- `depends_on`: must be `status: done` before this node starts
- `blocks`: this node's completion unblocks the listed nodes
- `gate_blocks`: this node ships only after the listed gates are signed off

### Outputs
- `<project>/sdk_data/work_graph.json` — the full DAG
- Live updates to graph as agents complete tasks (status flows back into the graph)
- Browsable visualization at `/project/<id>/graph` (force-directed layout + status colors)

### Ships in
v1.

### Dependencies
A6 (scope lock).

### Acceptance bar
For HAKCD, the work graph must produce ≥ 95% of the orchestrator's hand-built task list when given the same locked scope, with correct dependencies and correct agent assignments.

---

## A8. Execute (handoff to Section B + C)

The work graph drives everything downstream. Storyboard, scene manager, asset approver, agent dashboard, gates — all read/write to the work graph. Section A is complete when the graph is locked + handed off. Section B/C consumes it.

---

# SECTION B — DOWNSTREAM: Authoring IDE (Panic-grade surfaces)

Everything in Section B is driven by the work graph from A7. None of these surfaces invent state — they render and mutate graph nodes.

---

## B1. Storyboard View

### Purpose
26 scenes laid out visually. The first thing the user sees when entering a project.

### UX skeleton
- Full-page canvas at `/project/<id>/storyboard`
- Each scene = card with: thumbnail (anchor or generated bg, if exists), scene ID, title, status pill (color-coded), char list, mechanic chip
- Drag to reorder (mutates work graph dep edges if user confirms)
- Branch UI: shift+drag from a scene to add a conditional branch (for multi-path narratives)
- Annotate: per-scene note overlay (saved to graph node `notes`)
- Click scene = drill-down panel (B2)
- Filter: by status, by act, by character present, by mechanic, by coverage gap
- Search: by scene ID, title, dialog content
- Bulk select: shift-click multiple scenes → bulk-defer / bulk-regen / bulk-annotate

### Ships in
v1.

### Dependencies
A7 + A2 (extracted scene list).

---

## B2. Scene Manager (per-scene state machine)

### Purpose
Per-scene drill-down. Status visible at a glance: `prompt drafted → asset generated → QA passed → Lua written → sim-tested → shipped`.

### UX skeleton
- Drawer/modal opens from B1 scene click
- Top: scene metadata (ID, title, anchors, canon section cited, SKILL.md rules)
- State machine visualization: 6 stages, current stage highlighted, completed stages green, failed stages red with error tooltip
- Per-stage panel: prompt sent, asset output, QA report, Lua text, sim screenshot
- Actions per stage: `Re-run`, `Override`, `Skip` (with rationale)
- Bottom: dialog block editor (per-character dialog with voice cues)
- Right rail: dependency map (this scene blocks / is blocked by)

### Ships in
v1.

### Dependencies
A7 + B1.

---

## B3. Asset Approver

### Purpose
Review queue for every generated image. One screen, one decision per asset, batch 50 in 10 minutes.

### UX skeleton
- Queue at `/project/<id>/approve`
- Each item: side-by-side panes
  - Prompt sent (full text, scrollable)
  - Generated output (large preview, click to fullscreen)
  - Anchored reference (next to output for comparison)
  - Canon section cited (collapsible)
  - SKILL.md rule check results (pass/fail per rule)
  - Drift detector verdict (B12 below)
- Actions: `Approve`, `Reject`, `Re-roll same prompt`, `Re-roll w/ filter-safe variant`, `Fall back to canon filter-safe rewrite §X`, `Defer`
- Keyboard shortcuts: A/R/space/1/2/3 — batch flow
- Auto-advance after decision
- Footer: queue progress (N of M), cost-so-far, gates blocked

### Ships in
v1.

### Dependencies
A7 + B2 + image generation pipeline.

---

## B4. Prompt Canon Viewer + Editor

### Purpose
Canon doc as browsable spec. Live diff against what autopilot actually sent. Edit canon = downstream prompts inherit.

### UX skeleton
- `/project/<id>/canon`
- Left: TOC with section anchors (jumps to §1, §2, ... §20)
- Center: rendered canon (markdown + syntax highlighting for prompt blocks)
- Right: "Used by" panel — which work-graph nodes reference each section
- Edit mode: in-place markdown editor, save creates a new canon version (git-tracked)
- Live diff: per-section, "what autopilot sent (latest run) vs canon source" — flags drift instantly
- Filter-safe rewrites flagged with a banner: "this section is a fallback only; original §X is the canonical version"

### Ships in
v1.

### Dependencies
A2 (canon parsed) + B3 (so approver knows which section a prompt cited).

---

## B5. Reference Image Library

### Purpose
The pixel_collection as a tagged, searchable gallery. Replace the "user re-lists paths in chat" pattern.

### UX skeleton
- `/project/<id>/references`
- Gallery grid with thumbnails (1-bit + native size variant toggle)
- Per-image: name, dims, dither type (parsed by A2), tags, anchored-to subjects (scenes/characters/UI)
- Drag image onto a scene card in storyboard (B1) → becomes that scene's anchor (mutates work graph)
- Bulk-tag UI: select multiple → apply tag set
- Search: by tag, by anchored scene, by visual similarity (perceptual hash)
- Upload new reference → triggers re-extraction (A2) for affected scenes
- Ambiguity surface: if A2 flagged an image (e.g., chat.png byte-dupe of bbs_chat_close), banner on the image with resolution UI

### Ships in
v1.

### Dependencies
A2 (reference catalog).

---

## B6. Live Agent Dashboard

### Purpose
Every spawned agent, its current task, its inbox, its last output, its branch. Pause / resume / kill / re-spawn. Not log-tailing in a terminal — a real dashboard.

### UX skeleton
- `/project/<id>/agents` (also accessible globally at `/agents`)
- List view: agent name, type, status (active/idle/blocked/shutdown), current task, branch, last message timestamp, mailbox count
- Click agent = detail pane: full inbox, full output stream (live tail), task assignment history, decision log filtered to this agent
- Actions: `Pause`, `Resume`, `Send message`, `Reassign task`, `Shutdown`, `Re-spawn with prompt edit`
- **Permission gate surfacing**: when an agent's tool call gates on permission, the agent card shows a yellow banner with the gated call + accept/deny buttons RIGHT THERE. No more silently stalled pipeline-driver.
- Graph view: who spawned whom, message-passing arrows (animated when messages flow), shutdown markers
- Filter: by team, by status, by has-pending-permission

### Ships in
v1 — this directly fixes the HAKCD Phase 4 lived pain.

### Dependencies
Agent runtime instrumentation (must emit lifecycle events to the dashboard).

---

## B7. Simulator Integration

### Purpose
Click "run" on a scene = pdc compile + Playdate Simulator launch + scene loaded at that entry point. No tab-switching, no terminal commands.

### UX skeleton
- Per-scene button in B2: `▶ Run in sim`
- Top-of-page persistent sim panel (collapsible) at any project route: shows last sim screenshot, controls
- Click run: pdc spawns headless, Xvfb sim launches (per existing `sdk_preview.js`), browser canvas streams frames at 15 fps via WebSocket (binary PNG, per existing impl)
- Input controls: virtual d-pad + A/B + crank dial mapped to xdotool
- Recording: hold record → captures gif/mp4 of session (max 60s by default)
- Build-from-scene: deep-link to a specific scene entry point (auto-modifies main.lua to start at scene X, restores after)

### Ships in
v1.

### Dependencies
Existing `sdk_preview.js` (already wired in platform) + B2 (per-scene context).

---

## B8. Cost + Budget Panel

### Purpose
Live OpenRouter spend, per-stage breakdown, per-scene burn, projection to completion. Cap alarms.

### UX skeleton
- Persistent panel in top-right of every project page (collapsible)
- Numbers shown:
  - Total spend (running counter, updates per generation)
  - Per-stage subtotal (image, lua, sfx, music)
  - Per-scene cost
  - Budget remaining vs cap
  - Projected completion cost (based on remaining work graph nodes × historical per-node spend)
- Cap alarms: configurable thresholds (50%, 75%, 90%); at 90%, autopilot auto-pauses + dashboard banner
- Per-call detail: drill-down list of every OpenRouter call, model, prompt size, cost, scene attribution
- Export: CSV of all calls for accounting

### Ships in
v1 — directly fixes the "cost meter never showed actual spend" pain.

### Dependencies
OpenRouter call wrapper must report usage cents to a shared store (already partially wired; needs panel + cap enforcement).

---

## B9. Gate Review UI

### Purpose
GATE 1/2/3/N are first-class objects. When a gate triggers, the dashboard surfaces the exact decisions needed, assets to review, dialog to sign off. Not buried in a chat scrollback.

### UX skeleton
- Per-project gate timeline at top: G1 (bible review) → G2 (visual ship) → G3 (smoke test) → ...
- Active gate gets a dedicated banner across all pages: "GATE 2 awaiting your review — N decisions pending"
- Click gate = full review screen:
  - For GATE 1 (scope/bible): summary doc + question queue residue from A5 + scope diff
  - For GATE 2 (visual ship): comparison.html-style side-by-side anchor vs generated for every scene + per-scene approve/reject + cameo dialog editor
  - For GATE 3 (smoke test): test-step list with screenshots + log tail + pass/fail
- "Sign off" button (big, green) — only enabled when all sub-decisions resolved
- Sign-off captured in decision log (C2)

### Ships in
v1.

### Dependencies
Gate framework in the work graph (each gate is a graph node with sub-decisions).

---

## B10. Lua Editor + Canon-Aware Linting

### Purpose
SKILL.md rules enforced inline. Edit scene_lua in the browser; lint blocks save until fixed or explicitly overridden.

### UX skeleton
- Per-scene editor at `/project/<id>/scenes/<sceneId>/lua`
- Monaco-based, Lua syntax highlighting
- Lint rules from SKILL.md (live, per-keystroke). Coverage = RUNTIME-LUA-LINTABLE subset; asset-side rules live in B3/image-gen pipeline; rule 13 (launcher name baked in) lives in B11; rule 15 (simulator lies) is operational guidance not lintable.
  - **SKILL.md #2** 400×240 only — flag hardcoded resolution mismatches
  - **SKILL.md #6** `setRefreshRate(30)` present — flag if missing or set wrong
  - **SKILL.md #8** `name-table-W-H.png` imagetable naming — flag PNG refs that don't match
  - **SKILL.md #9** No runtime rotate/scale of large sprites — flag in main-loop transforms
  - **SKILL.md #11** Crank + B (not A) — flag crank+A combinations
  - **SKILL.md #12** A = confirm, B = cancel — flag `AButtonDown` triggering destructive actions
  - **SKILL.md #14** Sprite system usage — flag full-screen redraws when sprite system would suffice
  - **Mandatory call presence**: `playdate.update()` + (if sprites) `gfx.sprite.update()` + (if timers) `timer.updateTimers()` — flag any missing
  - **Bootstrap pattern** `_G.<name> = M` + `return M` — flag missing or wrong
- Asset-side SKILL.md rules enforced elsewhere (NOT in B10):
  - **#1** 1-bit pure black/white/alpha — enforced in B3 on generated images (drift detector C3 + asset approver)
  - **#4** Tile minimum 16×16 — enforced in B3 on sprite/tile imports
  - **#5** Text minimums (14px dialog / 10px HUD / 8px floor) — enforced in B3 on rendered text-bearing images
  - **#7** Audio 44.1 kHz — enforced in B3 on WAV imports
  - **#10** Dither flashing (scroll-by-even-pixels OR mask-and-redraw) — enforced in B3 on animation imagetables
  - **#13** Launcher card name baked in — enforced in B11 build pipeline
  - **#15** Simulator lies — operational guidance surfaced in B7 sim-integration tooltip
- Lint severity: error blocks save; warning is overridable with reason note (logged)
- Auto-fix actions for trivial fixes (add missing `setRefreshRate`, fix bootstrap pattern)
- Diff view against the last autopilot-generated version

### Ships in
v1 — this directly fixes the "QA regex false positive blocked build" pattern by making lint pre-flight visible.

### Dependencies
SKILL.md parsed into machine-checkable rules (A2 extension).

---

## B11. Build + Ship Pipeline (one button)

### Purpose
pdc → pdx.zip → examples/<game>/ commit → PR. One button. Sim walkthrough captured to gif/mp4 attached to PR automatically.

### UX skeleton
- "Build & Ship" button on every project page
- Click triggers:
  1. Lint pass (B10) across all scene_lua — blocks if errors
  2. Drift detector pass (C3) — blocks if drift > threshold (override w/ note)
  3. Asset approver queue empty? — blocks if pending approvals
  4. `pdc` build → existing sdk_export
  5. .pdx.zip packaged
  6. Sim walkthrough auto-recorded (B7) → gif + mp4 attached
  7. Copy to `examples/<game>/` in 23studios repo
  8. Commit + push to a `ship/<game>-v0.x` branch
  9. PR opened with: scope summary, work graph diff vs last ship, screenshots, gif, cost report, gate signoffs
- Status panel: per-step progress
- One-click rollback: if ship fails post-PR, revert the examples/ commit

### Ships in
v1.

### Dependencies
B10 + C3 + existing sdk_export + B7 (sim recording).

---

## B12. Bible / Canon / SKILL.md Linked-Doc Viewer

### Purpose
Cross-reference: clicking a scene in the storyboard shows its bible entry, its canon section, the SKILL.md rules that apply, all in one pane.

### UX skeleton
- Persistent right-rail "Source" pane on B1/B2/B3 screens
- Three tabs: Bible | Canon | SKILL
- Auto-scrolls to the relevant section when the user selects a scene/asset
- Bidirectional links: from Bible scene description → storyboard card; from Canon section → work graph nodes that use it; from SKILL.md rule → lint rule that enforces it
- Quote pin: pin a bible/canon excerpt to a scene's notes (saved to graph node)

### Ships in
v1.

### Dependencies
A2 (source parsed + sectioned).

---

# SECTION C — AI PIPELINE EXTENSIONS (orchestrator-specific)

The things Panic doesn't need because they aren't AI-orchestrated.

---

## C1. Multi-Agent Visibility (extends B6)

### Purpose
Beyond per-agent dashboard: the agent graph as a first-class view. Who spawned whom, message passing between agents in near-real-time, branch/team membership.

### UX skeleton
- `/project/<id>/agents/graph` (also at `/agents/graph` globally)
- Force-directed graph: nodes = agents, edges = parent-spawn or active-message
- Animated message dots traveling along edges when SendMessage happens
- Hover = agent summary; click = jump to B6 detail
- Time scrubber: replay agent activity over a time window (debugging stuck pipelines)
- Filter: by team, by status, by cost-spent

### Ships in
v1.5 (B6 is the must-ship; the graph view is nice-to-have).

### Dependencies
B6.

---

## C2. Decision Log

### Purpose
Every choice the orchestrator made autonomously vs escalated. Filterable. Auditable. "Show me every time autopilot chose filter-safe over canon."

### Storage
- Append-only JSONL at `<project>/sdk_data/decisions.jsonl`
- Per-entry: `{ts, decided_by: "orchestrator"|"user"|"agent:<name>", category, question, options, choice, rationale, source_refs (canon §X, SKILL.md rule Y), graph_node_id, escalated_from}`

### UX skeleton
- `/project/<id>/decisions`
- Filterable table: who decided, when, category (scope, scene-content, prompt-variant, fallback-vs-original, gate-signoff)
- Click row = full context (the question that was asked, options surfaced, what was picked, downstream effect)
- "Re-decide": if a past decision is contentious in hindsight, button to surface the alternative + re-run dependent graph nodes
- Export: CSV/markdown for retro reviews

### Ships in
v1.

### Dependencies
Orchestrator + agents instrumented to log every choice.

---

## C3. Drift Detector

### Purpose
Compare any generated prompt against canon §3 preamble + style canon. Flag deviations. The contamination problem (asset-prep "DO NOT INCLUDE: any imagery that could be interpreted as instructional" reflex) should be impossible to repeat silently.

### Detection mechanism
- Pre-send (proactive): every image-gen prompt assembled by the platform passes through a drift check BEFORE OpenRouter call
  - Required tokens (must be present, drawn from canon §3 preamble): 1-bit, 400×240, dither type, anchor cite
  - Forbidden tokens (must be absent, drawn from corporate-safety reflex list): "could be interpreted as instructional", "any harmful content", proactive negative prompts not in canon
  - Forbidden style references (must be absent if not in canon): the orchestrator catches "Mars After Midnight" etc. when not canon-authorized
- Post-generate (reactive): generated image compared against anchor via perceptual hash + structural similarity; deviation score > threshold flags for approver review

### UX skeleton
- Live banner on B3 (asset approver): "Drift flagged: prompt missing canon §3 preamble — review before approve"
- Project-level drift dashboard at `/project/<id>/drift`: per-stage drift incidents, contamination patterns
- Per-agent drift score in B6: agents with high drift get a yellow halo

### Ships in
v1 — directly fixes the canon-contamination pattern we already hit.

### Dependencies
Canon parsed (A2) + image-gen wrapper intercepts.

---

## C4. Reference Grounding Enforcement

### Purpose
No prompt ships without an anchor image cited OR an explicit "no anchor exists" tag. Visible per scene.

### Mechanism
- Work graph node requires `anchor_refs` field populated OR `no_anchor: true` with rationale
- Pre-send check on image-gen prompts: prompt body must reference at least one anchor image path OR include the no-anchor explicit override
- B5 surfaces unanchored-but-not-tagged scenes as red items in the gallery

### UX skeleton
- B1 storyboard: scene cards without anchor get a "⚠ unanchored" badge
- B2 scene manager: anchor selector dropdown (populated from B5 library) + "no anchor available — derive from GLOBAL_STYLE master" toggle (with required rationale)
- B3 asset approver: the cited anchor image displayed prominently next to the generated output

### Ships in
v1.

### Dependencies
A7 work graph schema + B5 + image-gen wrapper.

---

# SECTION D — CROSS-CUTTING CONCERNS

---

## D1. Auth + Multi-User
- Current `STUDIO_AUTH_DISABLED=true` mode preserved for local dev
- v1.5: add per-user accounts so multiple operators can collaborate on a project (decisions log records "decided by user X")
- Permission model: read-only viewer / author / approver (gate signoff) roles
- Defer to v1.5

## D2. State Persistence
- Work graph is the source of truth; all UIs render from + mutate it
- Postgres backing store (or JSON-on-disk for solo dev, with optional Postgres adapter)
- Graph snapshots per ship — Phase 5 iteration loop already snapshots builds; extend to snapshot the work graph alongside

## D3. WebSocket Channels
- Existing channels: chat (already wired), preview (Xvfb sim frames), export progress
- New channels: agent-events, graph-updates, drift-alerts, gate-state-changes
- Single multiplexed WS connection per browser tab; per-channel subscription model

## D4. Authoring State Conflicts
- Two users editing the same scene's Lua simultaneously → OT or CRDT (defer to v2; v1 = last-write-wins with a banner warning)
- Two agents writing the same graph node → graph runtime enforces single-writer per node (already partially via team coordination guardrails from Phase 4 retro)

## D5. Accessibility
- Keyboard nav across all surfaces (storyboard tab order, approver A/R shortcuts, gate signoff hotkeys)
- Voice input on interview (A5) — Web Speech API fallback
- Color-blind-safe status pills (don't rely on green/red only — use icon + color)
- Screen reader announcements for agent lifecycle events on B6

## D6. Telemetry + Analytics (opt-in)
- Per-action timings for the IDE itself (was the storyboard slow to load with 100 scenes?)
- Surfaces in `/admin/telemetry` for operator self-tuning
- Strict opt-in; off by default; no PII

---

# SECTION E — PHASING

## Phase 6.0 — v1 (must-ship)

### Upstream (Section A)
- A1 Intake ✓
- A2 Parse + Extract ✓
- A3 Requirements Derivation ✓
- A4 Coverage Gap Analysis ✓
- A5 Interactive Requirements Interview ✓
- A6 Scope Proposal + Lock ✓
- A7 Work Graph Generation ✓

### Downstream (Section B)
- B1 Storyboard ✓
- B2 Scene Manager ✓
- B3 Asset Approver ✓
- B4 Canon Viewer + Editor ✓
- B5 Reference Library ✓
- B6 Agent Dashboard (per-agent view + permission-gate surfacing) ✓
- B7 Simulator Integration ✓
- B8 Cost Panel ✓
- B9 Gate Review UI ✓
- B10 Lua Editor + Linting ✓
- B11 Build + Ship ✓
- B12 Bible/Canon/SKILL Viewer ✓

### Extensions (Section C)
- C2 Decision Log ✓
- C3 Drift Detector ✓
- C4 Reference Grounding ✓

### Acceptance bar for v1
Re-run the HAKCD Phase 4 build from scratch using only Phase 6 v1 — no orchestrator hand-decomposition. Outcome must equal or exceed the manual run: ≥ 8 scenes generated, .pdx.zip < 25MB, sim:PASS, ≤ 30min wall time, ≤ $20 OpenRouter spend, all gates surfaced + signed off in UI (not chat).

## Phase 6.1 — v1.5 (high-value follow-ups)

- C1 Multi-Agent Visibility (agent graph view)
- D1 Auth + Multi-User
- Re-intake diffing (mid-project bible/canon updates)
- Reference image similarity search (perceptual hash)

## Phase 6.2 — v2 (deferred)

- D4 Real-time collaboration (OT/CRDT for Lua editor)
- Marketplace: publish reusable canon packs / scene recipes / minigame kits
- Plugin API for custom agents and custom QA rules
- Internationalization (currently EN-only)

---

# SECTION F — DEPENDENCIES MAP

```
A1 (Intake)
  └─> A2 (Parse + Extract) [internally parallel: bible | canon | reference-image extraction = 3 workers]
        ├─> A3 (Requirements Derivation)
        │     └─> A4 (Coverage Gap Analysis)
        │           └─> A5 (Interactive Interview)
        │                 └─> A6 (Scope Lock)
        │                       └─> A7 (Work Graph)
        │                             └─> A8 (Execute)
        │                                   ├─> B1 (Storyboard)
        │                                   ├─> B2 (Scene Manager)
        │                                   ├─> B3 (Asset Approver)
        │                                   ├─> B6 (Agent Dashboard)
        │                                   ├─> B7 (Sim Integration)
        │                                   ├─> B8 (Cost Panel)
        │                                   ├─> B9 (Gate Review)
        │                                   ├─> B10 (Lua Editor + Lint)
        │                                   ├─> B11 (Build + Ship)
        │                                   ├─> C2 (Decision Log)
        │                                   ├─> C3 (Drift Detector)
        │                                   └─> C4 (Reference Grounding)
        ├─> B4 (Canon Viewer) ── feeds back into A3+A5  [can start dev parallel with A3-A7]
        ├─> B5 (Reference Library) ── feeds back into A4  [can start dev parallel with A3-A7]
        └─> B12 (Linked Doc Viewer)                       [can start dev parallel with A3-A7]

Critical path to v1: A1 → A2 → A3 → A4 → A5 → A6 → A7 (7 sequential nodes).
Parallelization wins:
  - Within A2: bible/canon/refs extraction in 3 parallel Claude calls
  - After A2 done: B4, B5, B12 can develop in parallel with A3-A7
  - After A7 done: B1, B2, B3, B6, B7, B8, B9, B10, B11 + C2, C3, C4 all parallelize

Time estimate (2-3 focused devs):
  Upstream critical path A1-A7:       ~16 days
  Downstream parallel (B + C):        ~12 days (after A7)
  v1 total:                           ~6 weeks; 8-week target = 2-week safety margin

Cross-cutting (D1-D6): cut into every B/C surface.
```

---

# SECTION G — OPEN QUESTIONS

1. **LLM choice for A2/A3 parse-and-extract**: Claude (subscription, per Phase 5 cost split) for the deep semantic work, OR a smaller OpenRouter model for the structured-extraction subset? Tradeoff: subscription latency vs API throughput. Default: Claude.

2. **A2 extraction model versioning**: if the extractor improves over time, do re-runs auto-update old projects' extracted.json? Default: no, manual re-extract button with diff preview.

3. **B6 permission-gate UI**: who can approve agent permissions? Project author only, or any authenticated user with approver role? Default: author-only in v1, role-based in v1.5.

4. **C3 drift threshold tuning**: hardcoded thresholds or per-project configurable? Default: hardcoded defaults (canon-required tokens 100% present, forbidden tokens 0% present), configurable per project in v1.5.

5. **B11 ship target**: assume every ship goes to `examples/<game>/` in the 23studios platform repo, OR allow per-project external repo target (e.g., personal/hakcd)? Default: configurable per project, default = examples/ in 23studios.

6. **A5 voice input transcription**: browser-native Web Speech API (free, varying quality) or Whisper-via-OpenRouter (paid, consistent)? Default: Web Speech with Whisper fallback toggle.

7. **A7 work graph editing post-lock**: can a user manually add/remove a graph node after scope lock without re-running A6? Default: yes, but flagged as "manual edit" in decision log + re-coverage-check fires.

---

# SECTION H — ACCEPTANCE BAR (overall)

Phase 6 v1 ships when:

1. New-project flow from "I have a story bible" to "scope locked + work graph emitted" takes ≤ 1 hour with a 26-scene bible + 18-image reference set.
2. HAKCD Phase 4 outcome reproducible from Phase 6 v1 alone, with no orchestrator hand-decomposition.
3. All 12 v1 downstream surfaces (B1-B12) render the same work graph consistently.
4. Permission gates on agents surface in B6 within 2 seconds of being raised, and can be approved without leaving the dashboard.
5. Drift detector prevents at least one known canon-contamination pattern (the corporate-safety-reflex regression we hit during HAKCD asset-prep) from re-occurring.
6. Decision log captures 100% of orchestrator autonomous choices made during a full HAKCD re-run.
7. Cost panel shows live OpenRouter spend within ±2% of OpenRouter's own dashboard.
8. Build + Ship one-button produces a PR with: pdx.zip, scope summary, screenshots, gif/mp4, cost report, all gate signoffs — without any manual git commands.
9. All UI text is keyboard-navigable.
10. The web app for a new game project requires zero terminal commands from open-to-ship.

---

## End of spec.

When approved, implementation order should follow Section A first (the upstream is the bridge), then Section B in dependency order, then Section C extensions, then D cross-cutting. Each subsection is a separate PR. Aim for a v1 ship in ≤ 8 weeks of focused work.
