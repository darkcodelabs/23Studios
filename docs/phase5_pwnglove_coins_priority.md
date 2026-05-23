# Phase 5 Addendum: PWNGLOVE and 23 Coins are TOP priority

Two mechanics in the bible are not fictional — they're grounded in real artifacts the user built and documented publicly. These get priority in Phase 5's parallel sprint because:

1. The mechanics are already designed (real-world references show how they work)
2. Real photos + magazine feature provide unambiguous art references
3. The user has skin in the game on these specifically being right
4. Both have public repos with code that can be ported or referenced

These two outrank the other 9 minigame_kit entries in the recipe seed JSON. If the sprint runs short, ship these two complete before partially shipping the others.

## Real-world artifacts

### PWNGLOVE — the actual device

Documented in MagPi Issue 33 (May 2015), built by Cory Kennedy (the project owner, real SecKC organizer).

**Real components (confirmed from `NoDataFound/TriKC0x01/PwnGlove.ino`):**
- Original Nintendo Power Glove peripheral, gutted
- Raspberry Pi inside the palm housing
- Arduino driving the sensor IO
- Four bend sensors (thumb, index, middle, ring) on analog pin 3
- Analog multiplexer (`pinMuxCtl0`, `pinMuxCtl1`) cycles all four through one ADC pin
- 3-axis accelerometer on analog pins 0/1/2
- Bluetooth to Pi
- Adafruit NeoPixel WS2812 array (16×16 = 256 LEDs) driven from pin 6 with FastLED palette cycling
- Modified wrist pad — most buttons still work, some PCB cut away for Arduino space
- Connects to retro Nintendo games via RetroPie
- Wrist-mounted screen for solo play
- Wii Remote support for two-player co-op (see `TriKC0x01/notes` + `attachwii.sh`)
- Serial protocol per loop: `buttons<TAB>bendT<TAB>bendI<TAB>bendM<TAB>bendR<TAB>accelX<TAB>accelY<TAB>accelZ\n`
- Konami code (Up Up Down Down Left Right Left Right B A Start) unlocks "30 extra lives" mode (button bitmask order in firmware: U-D-L-R-B-A-Start-Select)
- Demo'd at SecKC Hacker Show-off Contest

**Bible binding:**

Find the PWNGLOVE section in `/home/hakcer/projects/personal/hakcd/sdk_data/story_bible.md`. Rewrite the `art:` block to attach the real MagPi photos and the PwnGlove device shots from `bible_media/art/`. Mechanic_kit binding becomes:

```markdown
## PWNGLOVE

mechanic_kit: pwnglove_konami_unlock
acquired_in_act: 2
acquired_via: SecKC hacker show-off contest (real-world reference)

real_world_source: |
  Built by Cory Kennedy, documented in MagPi Issue 33 (May 2015).
  Original Power Glove gutted, retrofitted with Raspberry Pi + Arduino +
  Bluetooth + NeoPixel array. Four bend sensors (thumb/index/middle/ring)
  feed an analog multiplexer in the palm housing, data piped via Bluetooth
  to the Pi. Wrist-mounted screen for solo, Wii Remote for co-op.
  Konami code unlocks 30 extra lives mode. NeoPixel lights pay homage to
  the original advertising material.

ingame_function:
  - Acquired during SecKC scene as reward for hacker show-off demo
  - Once equipped: D-pad input + B button on PWNGLOVE finger sensor
    enables Konami-code unlock in any scene with a "hardened" target
  - Konami code input (UUDDLRLRBA-Start) → 30 extra "attempts" buffer
    on any subsequent minigame
  - NeoPixel state visible as overlay HUD when equipped
  - Bend sensor visualization: 4 LEDs on screen show finger curl state,
    used in lockpick minigame as input
```

### 23 C0iNS — the actual minting system

Public repos:
- `https://github.com/23-codes/23Coins` — software / protocol layer (mirrors `NoDataFound/23Coins`)
- `https://github.com/NoDataFound/TriKC0x01` — hardware coin (physical artifact + PWNGLOVE firmware)

**Confirmed mechanic (from `23Coins/README.md`):**

> "23 Coins to solve, 23 spots to earn a minted coin by solving. Coin 0 (printable) is the welcome coin. **Rules:** Delivering the 'Phrase that pays' from these coins will earn you a minted coin and a spot on this leaderboard. **Solving the ENTIRE coin will earn you the next coin regardless if you solve.**"

Per-coin folder shape: `Coins/CoinN/CoinN.png` + `Coins/CoinN/CoinN_solvers.23`. Solvers list tiers: complete-coin solvers (top), Level-1 solvers (per-phrase). Coin 0 is printable (Thingiverse 5229745). Active coins on the repo today: 0, 1, 2.

```markdown
## 23 C0iNS

mechanic_kit: coin_grid_minter
acquired_in_act: 1 (Coin 0 on first BBS login)

real_world_source: |
  Based on the real 23 C0iNS system at NoDataFound/23Coins (software / protocol)
  and NoDataFound/TriKC0x01 (hardware coin). Total of 24 coins (0 .. 23).
  Each coin has a hidden "Phrase that pays" — discovering and delivering
  the phrase mints the coin. Solving the ENTIRE coin (all hints + the
  phrase) automatically grants the NEXT coin regardless of solve status,
  so completionists can pull ahead. Coin 0 is the welcome coin, minted
  automatically on first BBS login.

ingame_function:
  - 24-coin grid (numbered 0–23, matches the SecKC "23" branding)
  - Coin 0 minted on first BBS login (welcome coin, free)
  - Subsequent coins unlocked by completing scene-bound puzzles
  - "Solving the entire coin earns you the next coin regardless of solve status"
    (mirrors the real repo rule)
  - Phrase-locked: each coin has a phrase that must be discovered in-world
    before the coin can be minted
  - Coin grid shown as 6x4 grid with status pips (MINTED / AVAILABLE / LOCKED)
```

## Phase 5 priority order (revised)

Original Phase 5 awkwardness catalog had 21 items across 5 teams over 10 days. Insert PWNGLOVE + 23 Coins ahead of the generic minigame recipes:

### Wave A — Make scenes playable (Days 2-5)

Original Wave A scope stands, PLUS:

- **Team Bible:** Pull real-world source material first.
  - Repos already cloned to `/tmp/coin-refs/{23Coins,TriKC0x01}`
  - Read both READMEs + spec files (done; see `phase5_pwnglove_coins_priority.md` notes)
  - Rewrite PWNGLOVE + 23 C0iNS bible sections per the templates above
  - Bind the MagPi photos to PWNGLOVE section
  - Verify mechanic_kit names match what Team Emitter expects

- **Team Emitter:** Recipe inliner explicitly tested against `pwnglove_konami_unlock` and `coin_grid_minter` recipes BEFORE the generic recipes. These two recipes get hand-tuned in the seed JSON if needed.

### Wave B — Make game progressive (Days 6-10)

- **Team Runtime:** `progression.lua` MUST handle:
  - Inventory state for PWNGLOVE (holstered → equipped → konami_armed → konami_consumed)
  - Coin grid state (24 coins, per-coin status, phrase discovery flags)
  - These two are the most complex state machines in the game; if `progression.lua` handles them cleanly, the other minigame states are trivial

- **Team Runtime:** New module `runtime/concepts/pwnglove_hud.lua`:
  - NeoPixel array visualization (4 LEDs on screen = 4 finger sensors)
  - Konami code input buffer + listener
  - Bend sensor input mapping (finger curl → game input)
  - Equipped overlay visible in any scene where PWNGLOVE is equipped

- **Team Runtime:** New module `runtime/concepts/coin_grid.lua`:
  - 6x4 grid rendering matching the bible reference UI
  - Per-coin state pip rendering
  - Side panel with current coin detail
  - Mint puzzle launch on A-press over available coin
  - Phrase discovery event listener (fires when scene reveals a phrase, unlocks next coin)

## Recipe seed JSON additions

Two new entries appended to `server/data/minigame_recipes.seed.json`:

- `pwnglove_konami_unlock` — Konami code input buffer arms a 30-attempt bonus on the next minigame.
- `coin_grid_minter` — 24-coin grid, phrase-locked, with "completing entire coin grants next coin" fallback rule.

Both are TOP priority — first two through the emitter pipeline as the regression test for whether recipe inlining works.

## Acceptance for PWNGLOVE specifically

Sideload the integration build at end of Wave B. Test sequence:

1. Play through to Act 2 SecKC scene
2. Win the hacker show-off demo (whatever the scene mechanic is)
3. Verify PWNGLOVE appears in inventory (state: holstered)
4. Open inventory, equip PWNGLOVE (state: equipped, HUD shows NeoPixel array)
5. Enter any scene with a minigame
6. Before starting the minigame, input Konami code (UUDDLRLRBA-Start)
7. Verify HUD updates: "30 EXTRA ATTEMPTS ARMED"
8. Start the minigame, fail intentionally — counter should NOT decrement past attempt 30
9. Win the minigame → verify konami_consumed state, HUD clears the buffer

If all 9 steps work, PWNGLOVE shipped.

## Acceptance for 23 Coins specifically

Sideload, test sequence:

1. First BBS login mints Coin 0 automatically, no puzzle
2. Open coin grid (probably a menu option), verify 1/24 MINTED status
3. Coin 0 shows "WELCOME COIN" detail
4. Coins 1-23 show ??? LOCKED
5. Play through a scene that reveals Coin 1's phrase
6. Re-open coin grid, Coin 1 now shows AVAILABLE
7. Activate Coin 1's mint puzzle (whatever it is per the real spec)
8. Win the puzzle, Coin 1 status = MINTED
9. Verify Coin 2's phrase hint is now unlocked

If 9 steps work, the coin system shipped grounded in the real 23Coins mechanic.

## Why these jump the queue

Other minigame recipes in the seed JSON (`crank_lockpick`, etc.) are also legit. They get full Wave B treatment too. But PWNGLOVE and 23 Coins have three properties the others don't:

1. **Real-world reference removes design ambiguity.** When the bible says "Konami code unlocks 30 extra lives mode," that's not a design choice the implementer needs to interpret — it's documented in MagPi and in `PwnGlove.ino`. Same for the coin grid mechanics in the 23Coins repo. Less guesswork = faster shipping = fewer revisions.

2. **Cory Kennedy IS the project owner.** PWNGLOVE is his real device. 23 Coins is his real project. The user cares disproportionately about these being right because they're his actual work being represented in the game. Misimplementing them is a bigger failure than misimplementing a generic minigame.

3. **They anchor the game's authenticity.** A 1998 phreaker game that includes a real homemade PWNGLOVE and a real 23 Coins minting system is qualitatively different from a generic hacker-themed game. The platform's whole pitch is "AI-generated game grounded in the creator's real world." These two mechanics ARE that pitch in concrete form.

## What this addendum does NOT change

- The five-team parallel structure stands
- The 10-day timeline stands (these are inserted into existing Wave A + Wave B slots, not added as extra work)
- The contracts file on Day 1 still gets written first
- Daily integration smoke tests still run
- The other 9 minigame recipes still get implemented

This addendum just says: when Team Bible writes the schema migrations and Team Runtime writes the concept modules and Team Emitter wires the recipes, PWNGLOVE and 23 Coins are the first two through the pipeline. They're the regression test for whether the whole Phase 5 pattern works. If those two ship clean on Day 10, the rest of the recipes scale predictably.

## OUTSTANDING — media drop required

MagPi Issue 33 photos NOT yet on disk. Required at `bible_media/art/`:

```
pwnglove_real_magpi_hero.jpg           (cover page hero shot — full PWNGLOVE buildup + Cory headshot)
pwnglove_real_magpi_disassembly.jpg    (build-process page — disassembled glove + parts)
pwnglove_real_magpi_feature.jpg        (feature spread — "Quick Facts" sidebar)
```

User to drop these into the bible_media/art/ folder before Team Bible begins the PWNGLOVE rewrite. Until then, PWNGLOVE bible art block stays attached to existing `bible_media/art/pwnglove_device_pixel.png` only.

Don't fictionalize anything that has a real source. The user will know.
