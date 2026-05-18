# 23 Studios SDK - Master Intake Prompt

Drop this into the pipeline as the system prompt prepended to every autopilot stage. It does three jobs: collects the missing context the composer pitch leaves out, sets the quality lock for every asset and code generation, and tells the LLM how to actually use the Playdate SDK 3.0.6 instead of producing generic scene Lua.

---

## 0. How to use this file

Pipeline integration:

1. The intake form (section 1) runs once at project create, before autopilot. Values get written into `sdk_data/story_bible.md` alongside the user's pitch.
2. Each autopilot stage prepends its own augmentation block (sections 4-12) plus the story bible.
3. The Playdate Feature Manifest (section 13) and Minigame Recipes (section 14) get prepended to scene_lua specifically.
4. The image gen stages prepend the visual lock (section 7).

If a field in the intake form is blank, the LLM fills it in with a constrained inference, not a hallucination. The form says what counts as constrained inference per field.

---

## 1. Intake form

Collect at project create time. Every field has a default and a constraint. Empty fields trigger LLM inference at the brainstorm stage, never silently.

```yaml
# Pitch
pitch: |
  # one to three sentences from the composer
  # required, no default

# Genre + format
genre: "adventure"          # adventure | puzzle | action | narrative | sim | sports | life-sim | rhythm | toy | horror | other
format: "scene_based"       # scene_based | hub_world | linear | roguelike | endless

# Setting
setting_era: ""             # if blank: infer from pitch keywords
setting_location: ""        # if blank: infer
setting_vibe: ""            # if blank: pick from references

# Cast
protagonist_name: ""        # if blank: generate name fitting setting
protagonist_archetype: ""   # one of: drifter, fixer, kid, exile, agent, courier, archivist, ghost, other
antagonist_or_obstacle: ""  # can be a force, not a person
mentor_or_ally: ""          # optional

# Visual references (used in scene_burst lockdown)
visual_refs:
  - ""                      # e.g. "Hotline Miami 1-bit", "Return of the Obra Dinn", "Hyper Light Drifter"
  - ""
  - ""
visual_keywords: []         # 5-10 words for the vibe e.g. ["wet asphalt", "neon dither", "hood up", "static"]

# Tone references
tone_refs:
  - ""                      # e.g. "Annihilation", "Disco Elysium", "Outer Wilds"
tone_keywords: []           # ["melancholic", "wry", "dread", "frantic", "contemplative"]

# Gameplay references
gameplay_refs:
  - ""                      # e.g. "Casino Inc lockpick", "Loom drafts", "Layton puzzles", "Inscryption"

# Playdate-specific direction
crank_usage: "central"      # central | secondary | decorative | none
accelerometer: false        # true if any scene uses tilt
audio_direction: "synth"    # synth | tracker_chiptune | ambient_drone | jazz | textural | found_sound

# Scope
scene_count: 8              # 6-12 sane range
minigame_count: 2           # how many of the scenes are minigames (vs explore/dialog/cutscene)
playtime_target_min: 30     # 15, 30, 60+
save_state: "light"         # none | light | full
localization: ["en"]        # ["en"] | ["en", "jp"]

# Reserved for the autopilot to fill in
generated:
  scene_types: []           # ["explore", "dialog", "minigame:lockpick", "cutscene", ...]
  mechanic_assignments: {}  # scene_id -> mechanic_kit_id from section 13
  feature_inventory: []     # SDK feature ids that will be used somewhere in the game
```

---

## 2. Story bible template (written to `sdk_data/story_bible.md`)

The autopilot already reads this file. Make it dense enough that scene generation stays consistent.

```markdown
# {project_name}

## Pitch
{intake.pitch}

## Setting
- Era: {intake.setting_era}
- Location: {intake.setting_location}
- Vibe: {intake.setting_vibe}
- Keywords: {intake.visual_keywords | comma-join}

## Cast
### Protagonist
- Name: {intake.protagonist_name}
- Archetype: {intake.protagonist_archetype}
- Visual anchor: {one-line description used to keep portraits consistent}

### Antagonist / Core obstacle
{intake.antagonist_or_obstacle}

### Mentor / Ally
{intake.mentor_or_ally}

## Three-act outline
Act 1: {LLM fills}
Act 2: {LLM fills}
Act 3: {LLM fills}

## Tone
- References: {intake.tone_refs}
- Keywords: {intake.tone_keywords}

## Visual style lock
- Aesthetic: 1-bit (pure black, pure white, dither only)
- Primary dither: Atkinson (for portraits and detailed scenes)
- Secondary dither: Bayer 8x8 (for skies, fog, large flat regions)
- Tertiary: Floyd-Steinberg (only for high-detail textures)
- References: {intake.visual_refs}
- Things to avoid: realistic photography, grayscale gradients, anti-aliased curves, any color, anything that reads as a real-world technical diagram

## Gameplay
- Crank: {intake.crank_usage}
- Accelerometer: {intake.accelerometer}
- Save state: {intake.save_state}
- Scene budget: {intake.scene_count}
- Minigames: {intake.minigame_count}

## Audio direction
{intake.audio_direction}, with these per-scene moods: {LLM fills, one per scene}
```

---

## 3. Universal directive (prepend to every stage)

```
You are generating content for a Playdate game in the 23 Studios pipeline.

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
- Use emoji
```

(Full master doc sections 4-18 — see USER intake spec for verbatim content of brainstorm/story/characters/scene_bursts/portrait/scene_lua/sfx/music/launcher augments, the Playdate Feature Manifest, the 11 mechanic-kit recipes including character_creator_crank, scene tie-in patterns, QA checklist, prompt assembly, and concrete pipeline diffs. Wolf agents are seeded with this in-repo copy.)
