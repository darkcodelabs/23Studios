# Phase 5 Addendum: Canonical Pins + Coin Vault + PWNGLOVE Icon

Two locked decisions before the 6-hour sprint kicks off. Both are display-only — the assets are already done, just need wiring.

## 1. Canonical pinned assets — pipeline NEVER regenerates

Six asset ids are pinned to source files in `docs/`. `sdk_main_emitter.js` must hard-copy these on every build, NEVER call the image pipeline.

### Pin map

```javascript
// server/services/sdk_main_emitter.js
const CANONICAL_PINS = {
  'title':          path.resolve(__dirname, '../../docs/hakcd_title.png'),
  'pwnglove_icon':  path.resolve(__dirname, '../../docs/gamepwnglovev2.png'),
  'coin_0':         path.resolve(__dirname, '../../docs/coin0.png'),
  'coin_1':         path.resolve(__dirname, '../../docs/coin1.jpg'),
  'coin_2':         path.resolve(__dirname, '../../docs/coin2.jpg'),
  'coin_3':         path.resolve(__dirname, '../../docs/coingame.png'),
};

if (CANONICAL_PINS[assetId]) {
  await fs.copyFile(CANONICAL_PINS[assetId], outputPath);
  logger.info(`Canonical pinned asset: ${assetId} (no regeneration)`);
  return;
}
```

Contract exposed as `CANONICAL_PINS` in `server/types/phase5_contracts.js`. Team Wiring (sdk_main_emitter) wires the guard, Team UI (Gallery) shows these as pinned in the gallery never as regenerated artifacts.

### Why pinned

- **Title splash** sets expectations in 2 seconds. Anyone seeing it gets the entire pitch: 1998 phreaker, AOHell, PWNGLOVE polaroid taped to Gateway 2000, Phrack 49, Marlboro Medium, BellSouth past-due, the works. Generic regen weakens the whole product.
- **Coins** are the most visually distinct assets in the project. Each one is a real puzzle from the live `23-codes/23Coins` repo. Pipeline can't beat the originals.
- **PWNGLOVE icon** is the already-generated 1-bit game asset. Dithered. Ready. No "let me try a variant."

Lineage matters: HAKCD's title + coins come from the real 23 Coins game project. The fictional universe is grounded in the real one.

## 2. PWNGLOVE Icon — splash + HUD + polaroid

`docs/gamepwnglovev2.png` is the canonical 1-bit game asset. Pipeline-guarded. Scaled variants ship from one source PNG.

### Uses

- **Intro splash scene** — full-frame 1.5s when player selects "pwnglove mode" from system menu
- **Inventory equip screen** — centered on inventory modal when PWNGLOVE selected
- **Coin Vault dialog portrait** — corner thumbnail when newb examines coins
- **HUD reference** — small 32x32 in corner during PWNGLOVE-active scenes (current layer state)
- **Title screen polaroid** — already baked into `hakcd_title.png`, no separate render

### Intro scene

```lua
-- source/scenes/pwnglove_mode_intro.lua
local intro = {}
local gloveImage = playdate.graphics.image.new("images/pwnglove_icon")
local timer = 0

function intro:enter()
  timer = 0
  if audio_manager and audio_manager.play_sfx then
    audio_manager.play_sfx("pwnglove_boot")
  end
end

function intro:update(dt)
  timer = timer + (dt or (1/30))
  if timer >= 1.5 then
    scene_manager.transition_to("pwnglove_playground")
  end
end

function intro:draw()
  playdate.graphics.clear(playdate.graphics.kColorBlack)
  gloveImage:drawCentered(200, 100)
  playdate.graphics.setImageDrawMode(playdate.graphics.kDrawModeFillWhite)
  playdate.graphics.drawTextAligned("PWNGLOVE MODE", 200, 180, kTextAlignment.center)
  playdate.graphics.drawTextAligned("engaged", 200, 210, kTextAlignment.center)
  playdate.graphics.setImageDrawMode(playdate.graphics.kDrawModeCopy)
end

_G.pwnglove_mode_intro = intro
_G.Scene_pwnglove_mode_intro = intro
return intro
```

### System menu hook (revised)

```lua
menu:addMenuItem("pwnglove mode", function()
  save_state.push_checkpoint("pre_pwnglove_mode")
  scene_manager.transition_to("pwnglove_mode_intro")
end)

menu:addMenuItem("back to story", function()
  if save_state.has_checkpoint("pre_pwnglove_mode") then
    save_state.restore_checkpoint("pre_pwnglove_mode")
  end
end)
```

Sequence: menu → push checkpoint → intro splash (1.5s) → playground.

## 3. Coin Vault — 9th playground station

Display-only. No minigame. Close-up reveal of the 23 C0iNS with newb reacting to each. The most visually striking single thing in the project gets its own showcase.

### Visual

Pedestal in the playground (between Portal Pedestal and Tyson Cabinet). On the pedestal: 6x4 grid of coin slots in miniature. A-press → opens COIN VAULT viewer.

### Viewer layout

Matches `docs/coingame.png` exactly:

- Top bar: `HAKCD > 23 C0iNS` with a small indicator arrow
- Main grid: 4 columns × 6 rows = 24 coin cards
  - Coin 0: MINTED (welcome, auto-minted)
  - Coin 1: AVAILABLE (current focus)
  - Coin 2: AVAILABLE
  - Coins 3-23: LOCKED (`???`)
- Right sidebar: `MINTED: 1 / 24` + `STATUS: WELCOME COIN` + large coin preview + canonical rule text + skull-bracketed `[ 23 C0iNS ]`
- Bottom dialog bar: newb portrait + commentary

### Playground behavior

In PWNGLOVE MODE, viewer is **unlocked** — all 24 coins visible, no LOCKED states (showcase mode). D-pad navigates. A zooms. B returns.

When zoomed: sidebar shows coin's number, title, hash signature, newb flavor dialog.

### The four shipped coins

Real reference art pinned at `docs/`:

#### Coin 0 — WELCOME COIN (`docs/coin0.png`)
Simple "23 C" coin face with starburst rays.

Newb dialog:
- Grid: "Coin Zero. Minted on first visit. Phrase locked. Coin One waiting. Let's see what it wants."
- Closeup: "Twenty-three. The number SecKC chose. Year I started cracking BBSes."
- Linger: "Lloyd Blankenship would've appreciated this. Mentor's manifesto, '86."

#### Coin 1 — ROTARY DIAL (`docs/coin1.jpg`)
Rotary dial with 23 in two slots, laughing face center, lotus petals, AABBB ABBAB Bacon-cipher border text.

Newb dialog:
- Grid: "Coin One. Phone dial. Phreaker shit. The border text rotates — that's a Bacon cipher or I'm an idiot."
- Closeup: "The face in the middle. Some kind of grinning Bond villain. Probably means something."
- Linger: "AABBB ABBAB AAABB. That's letters. Need to decode it."

#### Coin 2 — LOST WAGES / SPEAK & SPELL (`docs/coin2.jpg`)
Welcome to Fabulous Lost Wages sign, MAD LIBS goddess, TI Speak & Spell, Francis Bacon portrait, encrypted text, Zork-style cavern of PBEL response.

Newb dialog:
- Grid: "Coin Two. This one's a fucking maze. Speak & Spell, Vegas, Francis Bacon, text adventure. What is this?"
- Closeup: "PBEL. That's PBEL backwards. Or anagrammed. Or both."
- Linger: "'Suddenly you are standing in the cavern that is the evil mind of PBEL.' Zork meets paranoid hacker fiction."
- Long linger: "I lived here too long. Speak & Spell knows what I'm talking about."

#### Coin 3 — YODA HASH (`docs/coingame.png` as placeholder — Yoda file not on disk; user to drop or pick from 23Coins repo)
Yoda face extreme close-up dither, hex hash `1QZ9M9G3E6WXK7` across forehead, "fuûga tJo Bichen" in cheek text, marching figures in textures.

Newb dialog:
- Grid: "Coin Three. Yoda. With a hash tattoo. Sure."
- Closeup: "1QZ9M9G3E6WXK7. That's 14 chars. Bitcoin-style address compression? Or it spells something."
- Linger: "Marching ants on the cheek. Probably nothing. Probably everything."

#### Coins 4-23
Generic LOCKED placeholder card. Story progression unlocks them — playground shows all 24 as browsable.

### Audio

- Approach pedestal: low EM hum (vault is "powered")
- Open viewer: heavy vault door click + servo
- Highlight coin: soft tick (click wheel)
- Zoom: whoosh + coin-spin
- Newb dialog auto-advances ~3s or on A
- Close: vault re-seal

### Files

- `source/scenes/coin_vault_viewer.lua` — NEW modal scene
- `source/data/coins.json` — coin metadata (id, title, dialog, art paths)
- `source/images/coins/coin_0.png` ... `coin_3.png` — 64x64 grid + 200x200 closeup variants of canonical pins
- `source/images/coins/coin_locked.png` — generic locked card for coins 4-23
- `source/scenes/pwnglove_playground.lua` — adds 9th hotspot at coin vault pedestal coords

### Tier 1 (tonight, must ship)

- Coin vault pedestal exists in playground (9th hotspot)
- A-press opens viewer with grid of 24 cards
- Coins 0-3 show real art (coin_3 falls back to coingame.png placeholder until Yoda drops)
- Coins 4-23 show generic LOCKED card
- D-pad navigates, A zooms, B returns
- Newb dialog at bottom

### Tier 2 (if time)
- Closeup view with full sidebar
- Auto-advancing multi-line dialog
- Audio cues

### Tier 3 (post-tonight)
- Hand-pick 4-5 more real coins from `23Coins` repo
- Sparkle animation on closeup
- Phrase-lock indicators

## Updated playground layout (9 stations)

```
+---------------------------------------------------+
|  [NEON SIGN: "PWNGLOVE MODE"]                     |
|                                                   |
|  [LOCKPICK STATION]    [RFID PEDESTAL]            |
|  practice deadbolt      badge reader              |
|                                                   |
|  [PAYPHONE]            [IR DEVICE WALL]           |
|  blue box demo          TV + IR-lock door         |
|                                                   |
|  [GRAVITY ARENA]       [SUBGHZ TUNER]             |
|  movable boxes/         garage door + cordless    |
|  server rack                                      |
|                                                   |
|  [PORTAL GUN PEDESTAL] [COIN VAULT PEDESTAL]      |
|  warp targets           24-card grid viewer       |
|                                                   |
|  [TYSON ARCADE CABINET]                           |
|  enter 007-373-5963                               |
+---------------------------------------------------+
       [NEWB SPAWNS HERE - center bottom]
```

### Updated demo video flow (90s cut)

| Time | Beat |
|---|---|
| 0–5s | Title splash (canonical `hakcd_title.png`) |
| 5–15s | Press menu → PWNGLOVE MODE intro splash (1.5s glove) → walk into room |
| 15–25s | Lockpick station |
| 25–35s | RFID clone — "Knuckleheads taught me well." |
| 35–45s | Payphone / blue box |
| 45–55s | Gravity arena (server rack lift) |
| 55–60s | **Coin vault rapid scroll** (4 real coins + newb deadpan) |
| 60–70s | Portal gun |
| 70–85s | Tyson cabinet — `007-373-5963` → TYSON MODE |
| 85–90s | Outro |

## Notes for Coordinator

Title splash + coin vault + PWNGLOVE icon are **display-only**. No pipeline generation. Pin the files at the paths listed and copy as-is.

The lineage matters: title from real 23 Coins project, coins are real 23 Coins art, glove is the already-rendered game asset. Anyone who recognizes them gets the inside reference. Anyone who doesn't still sees beautiful weird coin art with newb's commentary. Both audiences served.

Two new highlight moments for the demo: canonical title fade-up (3s of "wait, what game is this even") + coin vault rapid scroll (5s of "oh god there are 24 of these puzzles"). 8 seconds total of pinned-asset footage. Rest of runtime is the playground demonstrations.

Ship Tier 1 of coin vault + intro splash tonight alongside Tier 1 of PWNGLOVE MODE (lockpick + Tyson). Then shoot the demo.
