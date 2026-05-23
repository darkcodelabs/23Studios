# Phase 5 PWNGLOVE Expansion: Multi-Tool + Tyson Master Unlock

PWNGLOVE was scoped as a single-mechanic device (Konami → 30 extra attempts). It becomes a **four-layer multi-tool with progressive unlocking AND a master cheat code that unlocks everything at once**.

mechanic_kit enum value changes:
- **WAS:** `pwnglove_konami_unlock`
- **NOW:** `pwnglove_multitool`

The Konami layer remains. Three new layers stack on top. A master unlock (Tyson Punch-Out!! password `007-373-5963`) cascade-unlocks everything.

## The four power layers

### Layer 1 — Konami unlock (already specified in phase5_pwnglove_coins_priority.md)

`UUDDLRLRBA-Start` → arms +30 attempts on next minigame. Easter egg, available from the moment PWNGLOVE is equipped. No progression gate.

### Layer 2 — Flipper Zero capability suite (in-scene hacking)

Six tools, each unlocks via a specific story beat. All housed in PWNGLOVE as switchable modes (D-pad up/down cycles tool, A activates).

| Tool | Function | Unlocks via | Era-accurate fit |
|------|----------|-------------|------------------|
| **RFID Clone** | Read badge → store → emit clone | Parking Garage scene completion (Act 2) | Yes — 1998 RFID systems existed |
| **Sub-GHz Replay** | Capture cordless / garage door / pager → replay | Mrs Kowalski's garage scene (Act 2) | Yes |
| **IR Learn/Replay** | TV-B-Gone style — kill CRTs, unlock IR-locked doors | Corporate BBS infiltration (Act 3) | Yes |
| **iButton Emulate** | Read 1-Wire iButton key → emulate at locked door | Office break-in scene (Act 3) | Yes — Dallas Semi iButton popular in 90s |
| **Blue Box Tones** | Generate 2600Hz + DTMF for phreak ops | Bell pedestal scene (Act 1) | Yes — canonical phreaker tool |
| **Bad USB Script** | HID injection at unattended workstations | Aegis Corp data center (Act 4) | Slight anachronism — earned per Konami precedent |

### Layer 3 — Portal Gun (scene fast travel)

Acquired in Act 3 after Phractal Kingdom completion. Narrative: "The glove caches BBS modem handshakes — re-dialing a cracked system is faster than physical traversal."

- Hold B + select scene from visited-scenes overlay
- Cooldown: 1 use per act, refills on act transition
- Some scenes portal-locked (Aegis data center, SecKC hive — story-gated, you walk there)

### Layer 4 — Gravity Gun (in-scene object manipulation)

Acquired in Act 4 from Aegis data center crank room. Narrative: "PWNGLOVE's NeoPixel array doubles as an EMF coil resonator — manipulates small metal objects within 2 meters."

- A → pick up movable object
- D-pad → reposition (object follows cursor)
- A → place / B → throw
- Movable objects: floppy disks, modems, keys, security cards, payphone receivers, server rack components
- Some puzzles REQUIRE gravity gun (move rack to access cable, lift camera to redirect view, place floppy in drive across room)

New bible field per scene: `movable_objects: [{id, sprite, mass, init_pos}]`. Bible validator enforces gravity-puzzle scenes declare at least one.

## The Tyson Master Unlock

**Code:** `007-373-5963` — Mike Tyson's Punch-Out!! password (NES, 1987). Entered on the PWNGLOVE: cascade-unlocks ALL powers.

- All six Flipper tools unlocked
- Portal gun unlocked
- Gravity gun unlocked
- Konami code still works on top

No progression gating. Player who knows the Tyson code identifies as the right audience.

### Why this is the right cheat code

1. **Cultural literacy filter.** Anyone who knows 007-373-5963 lived through NES-era gaming OR researched it. Either way, they're HAKCD's audience.
2. **Period-accurate.** 1987 code in a 1998 phreaker game = exact era continuity.
3. **Doesn't break the game.** Skipping progression skips the satisfaction. Vast majority play normal arc. Cheat is for replays / speedruns / showing off.
4. **Easter egg layering.** Konami = +30 attempts. Tyson = everything. Two era-canonical codes, two reward tiers.

### Implementation

- PWNGLOVE equipped, in any scene
- Hold B + crank → digit entry UI overlays
- Crank rotates 0-9, A confirms current digit, advances cursor
- Enter `007-373-5963` (dashes auto-inserted at positions 4 and 7)
- On match: cascade-unlock all layers, NeoPixel full rainbow sweep, screen overlay "★ TYSON MODE ★" for 3000ms
- save_state field `tyson_unlock: true` persists across sessions

### Anti-cheese

If players enter Tyson in first 10 minutes — fine. Game's value isn't gated by mechanic progression — it's the art, dialogue, SecKC voice, worldbuilding. The ONE thing Tyson doesn't unlock: **story-gated scenes**. Aegis data center still requires Act 3. SecKC hive still requires Knuckleheads invitation. Tyson is a tool unlock, not a story skip.

## Bible binding (replaces single-layer PWNGLOVE block)

```yaml
mechanic_kit: pwnglove_multitool
acquired_in_act: 2 (initial — Konami layer only)

power_layers:
  - layer: konami_buffer
    unlocked_at: equip
    code: "UUDDLRLRBA-Start"
    effect: "+30 attempts on next minigame"

  - layer: flipper_suite
    unlocked_progressively: true
    tools:
      - rfid_clone:      { unlocks: "sc_parking_garage_complete",   act: 2 }
      - subghz_replay:   { unlocks: "sc_mrs_kowalski_garage_complete", act: 2 }
      - ir_learn:        { unlocks: "sc_corporate_bbs_complete",    act: 3 }
      - ibutton_emulate: { unlocks: "sc_office_breakin_complete",   act: 3 }
      - blue_box:        { unlocks: "sc_bell_pedestal_complete",    act: 1 }
      - bad_usb:         { unlocks: "sc_aegis_datacenter_complete", act: 4 }

  - layer: portal_gun
    unlocked_at: "sc_phractal_kingdom_complete"
    act: 3
    cooldown: "1 use per act, refills on act transition"
    locked_destinations: ["sc_aegis_datacenter", "sc_seckc_hive"]

  - layer: gravity_gun
    unlocked_at: "sc_aegis_crankroom_complete"
    act: 4
    range_meters: 2
    movable_object_property_required: true

master_unlock:
  code: "007-373-5963"
  reference: "Mike Tyson's Punch-Out!! (NES, 1987) password"
  entry_method: "Hold B + crank digit selection in any scene"
  effect: "Unlock ALL power layers immediately (Flipper suite + portal gun + gravity gun)"
  does_not_skip: ["story_gated_scenes", "narrative_progression"]
  save_state_field: "tyson_unlock: bool"
  visual_feedback: "NeoPixel rainbow sweep + screen overlay 'TYSON MODE' for 3000ms"
```

## Recipe seed JSON additions

Four new recipes appended (in addition to existing `pwnglove_konami_unlock` which becomes Layer 1):

- `pwnglove_flipper_suite` — mode-cycle multi-tool interface (D-pad up/down cycles, A activates)
- `pwnglove_portal_gun` — scene fast-travel + cooldown
- `pwnglove_gravity_gun` — attach / move / place / throw, mass-based
- `pwnglove_tyson_master_unlock` — crank-digit code-entry + cascade unlock

See `server/data/minigame_recipes.seed.json` for canonical shapes. All four declare `priority: top` + `crank_power_channel: true` (see companion addendum).

## Runtime concept additions (Team Runtime)

Beyond original Wave-B scope (pwnglove_hud, coin_grid):

- `pwnglove_flipper.lua` — mode-switcher for six Flipper tools, each as a sub-minigame
- `pwnglove_portal.lua` — scene fast-travel UI + cooldown tracker
- `pwnglove_gravity.lua` — object attach/move/place/throw + scene `movable_objects` registry
- `pwnglove_tyson.lua` — crank-digit-entry UI + code matcher + cascade unlock dispatcher
- `object_manipulator.lua` — shared runtime module for gravity_gun (attach state, cursor follow, mass-based throw physics)

Update `pwnglove_hud.lua` — display current active layer (konami / tool name / portal / gravity / tyson).

## Bible parser additions (Team Bible)

- Parse `power_layers:` block → emit per-scene `pwnglove_layers_required: []` field
- Parse `master_unlock:` block → emit single `MasterUnlockSpec` for the project
- Parse new per-scene `movable_objects:` block → `MovableObjectSpec[]`
- Validate gravity-puzzle scenes declare at least one movable object

## Acceptance tests (replaces original Konami-only set)

**Konami test (unchanged):** Steps 1-9 from `phase5_pwnglove_coins_priority.md`.

**Flipper suite test:**
1. Complete Bell pedestal scene (Act 1), verify `blue_box` mode appears in PWNGLOVE
2. Cycle PWNGLOVE modes with D-pad up/down, verify mode label updates
3. Activate `blue_box` at a payphone hotspot, verify 2600Hz tone plays + payphone responds
4. Complete each subsequent act-bound scene, verify corresponding Flipper tool unlocks

**Portal gun test:**
1. Complete Phractal Kingdom (Act 3), verify `portal_gun` layer unlocks
2. Hold B + select visited scene from overlay
3. Verify warp transition fires + cooldown timer starts
4. Try to warp to Aegis datacenter, verify LOCKED with reason `story_gated`

**Gravity gun test:**
1. Complete Aegis crank room (Act 4), verify `gravity_gun` layer unlocks
2. Enter scene with `movable_objects` defined
3. A-press on movable object, verify attach
4. D-pad reposition, verify object follows cursor
5. A to place, verify object stays
6. B to throw, verify object launches with momentum

**Tyson master unlock test:**
1. Acquire PWNGLOVE (Act 2)
2. Hold B + crank, enter `007-373-5963`
3. Verify NeoPixel rainbow sweep + "TYSON MODE" overlay
4. Open inventory, verify all six Flipper tools unlocked
5. Try to portal warp, verify `portal_gun` active
6. Try to attach movable object, verify `gravity_gun` active
7. Save, quit, reload — verify Tyson mode persists
8. Try to enter Aegis datacenter without Act 3 progress — verify story gating still applies

All four suites pass → PWNGLOVE shipped at full multi-tool spec.

## Out of scope

- Real-world Flipper Zero firmware integration (in-game simulation only)
- Multi-step gravity puzzles requiring chained object placements (basic first; complex in Phase 6 if prioritized)
- Tyson mode achievement / leaderboard (data layer not built)
- Portal gun multi-target queueing
- Flipper suite custom firmware loading (six tools fixed; no user-extensible slots)

## Scope mitigation (+0 days)

This expansion = ~30% more work. Mitigation chosen: **Option A — drop generic `lockpick_crank` recipe**. PWNGLOVE Flipper suite covers `blue_box`, `ir_learn`, `ibutton_emulate`, `subghz_replay`, `rfid_clone`, `bad_usb` — overlaps heavily with the generic recipes. Hand-write only the NON-overlapping generic recipes (`drawing_canvas` for graffiti, `character_creator_crank` for handle picker, `pursuit_evade` for chase scenes). PWNGLOVE becomes the unified hacking interface across most scenes.

**Phase 5 still ships in 10 days.**

## Note for first-sideload

First thing the user will do at the Day 10 sideload: enter `007-373-5963` to see if it triggers. **Don't disappoint.**
