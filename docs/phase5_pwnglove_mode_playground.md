# Phase 5 Addendum: PWNGLOVE MODE — System Menu Playground

A dedicated showcase scene accessible via the **Playdate System Menu** (menu button, right side of device). Not part of story progression. Sandbox room where every PWNGLOVE capability is wired to a hotspot. Player walks between stations, triggers minigames on demand.

This is the **demo video setup**. Also a **regression test** — if every capability works in the playground, the platform works.

## System menu integration

Playdate System Menu = hardware menu button. Games add custom items via `playdate.getSystemMenu():addMenuItem()`. Standard pattern.

In `main.lua` after scene_manager init:

```lua
local menu = playdate.getSystemMenu()

menu:addMenuItem("pwnglove mode", function()
  save_state.push_checkpoint("pre_pwnglove_mode")
  scene_manager.transition_to("pwnglove_playground")
end)

menu:addMenuItem("back to story", function()
  if save_state.has_checkpoint("pre_pwnglove_mode") then
    save_state.restore_checkpoint("pre_pwnglove_mode")
  end
end)
```

When player selects "pwnglove mode": current game state freezes (no progress lost), scene transitions to the playground. "back to story" restores them.

PWNGLOVE MODE is always available — even if PWNGLOVE hasn't been acquired in main story. In playground, the device is **fully unlocked with all four power layers active**. Intentional. Playground showcases capability, doesn't gate it.

## Required contract additions (gates Team Wiring + Team Runtime)

| Contract field | Owner | Notes |
|---|---|---|
| `save_state.push_checkpoint(label)` | Team Wiring (progression.lua) | Deep-copy snapshot of all flags |
| `save_state.has_checkpoint(label)` | Team Wiring | Boolean predicate |
| `save_state.restore_checkpoint(label)` | Team Wiring | Restore + drop checkpoint |
| `SYSTEM_MENU_ITEMS` | Coordinator | Exported from `phase5_contracts.js` as an enumerated list |
| `PWNGLOVE_PLAYGROUND_SCENE_ID = "pwnglove_playground"` | Coordinator | Reserved scene id |

## Playground scene layout

`source/scenes/pwnglove_playground.lua` — **hand-authored, not generated**. Curated room.

400x240 top-down layout:

```
+---------------------------------------------------+
|  [NEON SIGN: "PWNGLOVE MODE"]                     |
|                                                   |
|  [LOCKPICK STATION]    [RFID PEDESTAL]            |
|  practice deadbolt      badge reader              |
|  + door                 + light                   |
|                                                   |
|  [PAYPHONE]            [IR DEVICE WALL]           |
|  blue box demo          TV + IR-lock door         |
|                                                   |
|  [GRAVITY ARENA]       [SUBGHZ TUNER]             |
|  movable boxes/         garage door + cordless    |
|  server rack            phone receiver            |
|                                                   |
|  [PORTAL GUN PEDESTAL]                            |
|  warp to: bedroom / SecKC / Aegis (story-locked)  |
|                                                   |
|  [TYSON ARCADE CABINET]                           |
|  Mike Tyson's Punch-Out!! splash, hint            |
+---------------------------------------------------+
       [NEWB SPAWNS HERE — center bottom]
```

**8 hotspots**, each demos a different layer.

## Station-by-station spec

### 1. LOCKPICK STATION

**Visual reference: `bible_media/art/pwnglove_lockpick_ui_ref.png`** (copied from `docs/lockpickmini.png`). EXACT visual target — Lucas Pope levels of UI density. Do not simplify.

Top bar: `PUZZLE: 5-PIN STANDARD | ATTEMPT 1/3 | 0 POINTS | hourglass 0:47 | PUZZLE IN PROGRESS`
Center: 5 vertical pin tumblers numbered 1-5, "UNLOCK ZONE" label spanning all 5
Above pins: BINDING ZONE indicator `90°-45°` with compass (N/E/S/W) + rotation triangle
Right: TENSION meter vertical — STOP / CARE / SAFE zones, current marker arrow
Bottom controls: `[CRANK] AIM | [A] LOCK PIN | [B] ABANDON`
Dialog bar bottom with newb portrait reacting

Mechanic: crank rotates AIM (compass shows angle) → stop on pin within binding zone (90°-45° highlighted bracket) → A presses pin → tension meter rises with each lock → over-tension = STOP = reset → 5 pins in unlock zone within 60s = open.

Audio: crank turn (low metallic rasp), pin click (sharp), tension spike (rising whine), lock open (clunk + brass tumble), failure (harsh buzz).

Dialog samples (newb portrait reacts):
- Pin 1: "Easy. Standard pin."
- Pin 3: "Pin three. Steady on the crank. Almost there."
- High tension: "Easy. Easy. Don't snap it."
- Open: "Clean. Knuckleheads style."
- All failed: "Snapped the tension wrench. Try again."

### 2. RFID PEDESTAL

**Visual reference: `bible_media/art/pwnglove_rfid_ui_ref.png`** (copied from `docs/pwnglove_remotehack.png`). RFID emission with concentric arcs from glove, floating `0xA8F2 / AUTH / OK` text, cloning progress bar on wrist screen, parking garage P2/B + CAM 07 monitor + AUTHORIZED PERSONNEL ONLY door.

Mechanic: A on badge → PWNGLOVE extends, cloning meter in HUD → crank charges → 50 units = read. A on reader → emit cloned signal → door buzzes open (animation, no destination — demo).

Audio: crank charge (rising capacitor hum), capture (chirp), emit (card-reader burst), door (hydraulic + clunk).

Dialog (verbatim "Knuckleheads" line from reference, use exactly):
- Approach badge: "Some chump left it here. Easy capture."
- Capturing: "Cranking the read coil. Hold steady."
- Captured: "Got it. Badge ID 0xA8F2. Auth signature clean."
- Emit: "Cloned. Now I'm someone else for ninety seconds. Knuckleheads taught me well."

### 3. PAYPHONE / BLUE BOX

Period-accurate payphone, receiver in cradle, coin slot.

Mechanic: A → pick up receiver, PWNGLOVE near mouthpiece → crank generates tones → crank speed = frequency → lock 2600Hz (vertical bar, target line at 2600) → hold 3s → trunk seizes → free long-distance dialer overlay (demo only).

Audio: receiver clatter, continuously variable sine wave, 2600 lock (pitch stabilizes + echo), trunk seize (CCITT signaling), era dial tone.

Dialog:
- Pick up: "Bell pedestal. Old school."
- Tuning: "Looking for the magic number."
- Locked: "There it is. Trunk's mine."
- Hold: "Holding the tone. Keep cranking."
- Seized: "I'm in. Free long distance. Used to be a felony."

### 4. IR DEVICE WALL

CRT TV on shelf + IR-locked door.

Mechanic: A on TV → IR LEARN → crank charges IR LED → D-pad up to point + emit → CRT flickers + dies (TV-B-Gone effect). A on IR door → same charge → emit → door unlocks.

Audio: IR LED whine (visual feedback), CRT die (whoomp-then-static), door unlock (chirp + servo).

Dialog:
- TV approach: "Hate that thing."
- Emit at TV: "Off. Stay off."
- Door: "IR lock. Standard model. Probably 38kHz carrier."
- Open: "Click."

### 5. GRAVITY ARENA

Open area, movable objects: floppy (light), CRT (medium), server rack (heavy), refrigerator (very heavy). Target ring painted on concrete.

Mechanic: A on object → attach if RPM sufficient for mass (floppy=any, CRT=50+, rack=200+, fridge=300+ sustained). D-pad moves. A places. B throws (force = current RPM). Place server rack in target ring → "GRAVITY GUN MASTER" achievement banner (optional easter egg).

Audio: coil spin-up (rising EM whine), attach (clank), move (low hum), heavy lift (strained whine), throw (whoosh + thud), overheat (sputter + cooldown beep).

Dialog:
- Floppy: "Light work."
- Rack: "This is what the EMF coil's for."
- Overheat: "Coil's red. Drop it."
- Target ring hit: "Placed. Cleanly."

### 6. SUBGHZ TUNER

Garage door + cordless phone receiver.

Mechanic: A on garage door → SubGHz capture → crank powers antenna → scripted "homeowner pressing remote nearby" event fires → capture rolling code → emit to open. A on cordless phone → capture in-progress call → replay (transcript scrolls — punchline "She doesn't know I'm at Knuckleheads tonight").

Audio: antenna spin-up (low static), signal capture (warble locking in), replay (muffled radio chatter, real sub-1GHz sample dithered), garage motor (whine + chain rattle).

Dialog:
- Garage: "Standard 315MHz garage opener. Common as dirt."
- Capture: "Got the rolling code chunk. Lucky timing."
- Replay: "Open sesame."
- Phone: "Cordless on 49MHz. People still use these?"

### 7. PORTAL GUN PEDESTAL

Glowing plinth with three holographic scene previews: bedroom, SecKC hive, Aegis (greyed + padlock).

Mechanic: A → portal mode → crank charges portal_energy → thresholds light destinations → select → warp. Aegis is story-gated. Try to select → lock flashes "STORY GATE: REQUIRES ACT 3".

"back to story" menu item stays available so they can return to playground.

Audio: portal charge (rising harmonic), select (chime), warp (teleport whoosh), locked (denial buzz).

Dialog:
- Approach: "Cached handshakes. The glove remembers every BBS I've cracked."
- Charging: "Spinning up the dialer."
- Warp: "Re-dialing."
- Locked: "Aegis is hardened. Can't warp in. Have to walk."

### 8. TYSON ARCADE CABINET

Arcade cabinet against back wall. Marquee "MIKE TYSON'S PUNCH-OUT!!" with classic NES art. CRT shows title screen.

Mechanic: A → opens digit-entry UI directly (cabinet IS the entry point — no need to discover the hold-B-crank gesture in the playground). Enter `007-373-5963` via crank-digit select with reverse-flick commits.

On correct: NeoPixel full rainbow sweep + screen overlay `★ TYSON MODE ★` for 3s + `save_state.tyson_unlock = true` + all PWNGLOVE layers permanently unlocked.

If already granted: cabinet shows "ALREADY GRANTED" + year `1987` etched on cabinet glass.

Audio: cabinet approach (classic arcade attract-mode loop, period-accurate), digit confirm (click), wrong (harsh buzz), correct (iconic "WINNER" sting from Punch-Out), unlock (full rainbow sweep + crowd cheer).

Dialog:
- Approach: "Knew there was a code. Heard it from a kid at the arcade in '88."
- Wrong: "That's not it. Try again."
- Correct: "Seven digits. Three-seven-three. Five-nine-six-three. Mike Tyson's password."
- Post-unlock: "Everything's mine now."

## Visual style for the room

Established 1-bit Playdate aesthetic, EXTRA detail (showcase room). Each station = period-accurate set dressing:

- Lockpick: workbench + tools (files, tension wrenches, picks), exposed deadbolt, "PROPERTY OF KNUCKLEHEADS" stencil
- RFID: corporate office (potted plant, "EMPLOYEE OF THE MONTH" frame), CAM 07 monitor showing the room
- Payphone: brick wall + graffiti (small `2600` tag, anarchist A, phreaker ASCII art), gum under receiver
- IR wall: 90s living room — shag carpet, TV on wheeled cart, IR-lock door + keypad
- Gravity arena: warehouse floor + target ring painted on concrete + scattered objects
- SubGHz: garage corner + workbench + hanging cables
- Portal pedestal: dark corner, plinth glows, scene previews as small dithered animations
- Tyson cabinet: full arcade alley — neon glow, scrolling marquee, change machine adjacent

## Neon sign — title card

Top of room: "PWNGLOVE MODE" in massive neon-style 1-bit type. Animate: flicker, occasionally sequence `PWN` → `GLOVE` → full word. Establishing shot when player walks in. This is the demo video's title card.

## Audio

Ambient track: soft 90s warez-scene chiptune low. When player enters a station, music ducks under interaction sound design. Use a keygen scraper track (Phase 4.7.2 Patch C wiring) — `act_demo_loop.wav`.

## Achievement: visit all stations

Background tracker per station: `visited: bool`. All 8 visited → neon sign flashes "MASTER HAKCER" + small achievement card bottom-right. Saves `save_state.pwnglove_mode_complete = true`. Subsequent visits show unlocked indicator on the sign.

## Implementation scope — hand-author, no autopilot

Files:

| File | Owner | Status |
|---|---|---|
| `source/scenes/pwnglove_playground.lua` | Coordinator (hand-author) | NEW |
| `source/scenes/pwnglove_playground.hotspots.json` | Coordinator | NEW — 8 hotspots, hand-positioned |
| `source/images/scenes/pwnglove_playground.png` | Coordinator | NEW — generated via `pulp_ai.js` with strong prompt OR hand-pixel for max polish |
| `main.lua` — system menu hook | Coordinator | edit existing |
| Each minigame recipe (`pwnglove_lockpick`, `pwnglove_rfid`, etc.) | Team Emitter | ships as it lands |
| `save_state.push/has/restore_checkpoint` | Team Wiring (progression) | NEW API |

Per scoping rule, **the playground IS the showcase** — polish matters more than scale. Coordinator hand-authors the playground scene + minigame UIs against the reference images. Teams ship the underlying recipes/runtime in parallel.

## Tonight's 6-hour minimum cutoff

**Tier 1 — must ship tonight:**
- Playground scene exists, accessible via system menu
- Newb walks between hotspots
- Lockpick station works (using `pwnglove_lockpick_ui_ref.png` reference UI)
- Tyson cabinet works (`007-373-5963` unlocks everything)

**Tier 2 — ship if time allows:**
- RFID pedestal (with `pwnglove_rfid_ui_ref.png` reference)
- Payphone / blue box

**Tier 3 — post-tonight, before demo video:**
- IR wall
- Gravity arena
- SubGHz tuner
- Portal pedestal

Tier 1 is the floor. Tier 2 expands the demo. Tier 3 is the full vision.

## Demo video flow (filming guide)

90-second cut:

| Time | Beat |
|---|---|
| 0–5s | Title card — HAKCD splash with PWNGLOVE wired-glove image |
| 5–15s | Press menu → PWNGLOVE MODE → newb walks into room, neon sign flickers on |
| 15–25s | Lockpick station — crank, pin clicks, dialog, lock opens |
| 25–35s | RFID pedestal — capture, emit, "Cloned. Now I'm someone else for ninety seconds. Knuckleheads taught me well." |
| 35–45s | Payphone — crank, 2600Hz lock, trunk seize |
| 45–55s | Gravity gun — server rack with full crank, place in target ring |
| 55–65s | Portal gun — warp to SecKC hive briefly, warp back |
| 65–80s | Tyson cabinet — enter `007-373-5963`, RAINBOW SWEEP, TYSON MODE |
| 80–90s | Outro — newb walks out, fade to title with "HAKCD — coming whenever it's ready" |

Every beat lands. Sound design carries the energy. Viewer either gets it immediately or they're not the audience.

## Audio matters as much as visuals

If the lockpick station has visual feedback but no satisfying click on pin set, the demo falls flat. **Pick the sounds first, design visuals around them.** SFX list (Coordinator queues to `sfx_synth.js` / keygen sampler):

- `lockpick_crank_turn` — low metallic rasp loop
- `lockpick_pin_click` — sharp click
- `lockpick_tension_warn` — rising whine
- `lockpick_open` — clunk + brass tumble
- `lockpick_fail` — harsh buzz
- `rfid_charge_loop` — rising capacitor hum
- `rfid_capture_chirp` — confirmation
- `rfid_emit_burst` — card-reader beep
- `door_buzz_clunk` — hydraulic + clunk
- `payphone_pickup` — receiver clatter
- `payphone_tone_loop` — variable sine wave
- `payphone_2600_lock` — stabilize + echo
- `payphone_trunk_seize` — CCITT signaling
- `crt_die` — whoomp + static
- `coil_spin_up` — rising EM whine
- `coil_overheat` — sputter + cooldown beep
- `object_attach` — metallic clank
- `object_throw` — whoosh + thud
- `portal_charge` — rising harmonic
- `portal_warp` — teleport whoosh
- `portal_locked` — harsh denial buzz
- `arcade_attract_loop` — period-accurate
- `arcade_punchout_winner_sting` — iconic Punch-Out winner music
- `tyson_unlock_cheer` — rainbow sweep + crowd cheer
- `ambient_warez_loop` — `act_demo_loop.wav` (keygen)

## Notes — implementation order tonight

1. System menu hook in `main.lua` first (without that, playground is just another scene)
2. Playground scene + 8 hotspots stubbed (newb can walk between them)
3. Lockpick station full implementation against the reference image
4. Tyson cabinet full implementation
5. Sideload, verify Tier 1 works on hardware
6. Continue to Tier 2 if time
