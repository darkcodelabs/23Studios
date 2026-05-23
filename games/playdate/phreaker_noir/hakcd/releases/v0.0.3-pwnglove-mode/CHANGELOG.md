# HAKCD v0.0.3 — PWNGLOVE MODE Tier 1

Date: 2026-05-23
Size: 62 MB zip / 83 MB unpacked `.pdx`
pdc: clean compile

## What's new

First sideloadable build of **PWNGLOVE MODE** — the system-menu-accessible playground for showing every PWNGLOVE capability on demand. This is the build the demo video gets shot against.

### System menu integration

Hardware menu button → **"pwnglove mode"** entry:
- Snapshots story state via `save_state.push_checkpoint("pre_pwnglove_mode")`
- Plays the 1.5s glove splash (`pwnglove_mode_intro`)
- Drops the player into the playground room

Hardware menu button → **"back to story"** entry restores the snapshot and returns to title.

### Playground — 9 hotspots

| Hotspot | Tier | Status |
|---|---|---|
| LOCKPICK STATION | 1 | **REAL** — full 5-pin minigame matching `docs/lockpickmini.png` UI density (compass + binding zone + tension meter + 1-3 attempts + 60s timer + newb dialog reactions) |
| TYSON CABINET | 1 | **REAL** — enter `007-373-5963` via crank-digit-select + A-commit → cascades all PWNGLOVE layer unlocks + 3s `★ TYSON MODE ★` overlay + persists to save_state |
| COIN VAULT | 1 | **REAL** — 24-coin grid viewer matching `docs/coingame.png` UI. Coins 0-3 ship with real art from `23-codes/23Coins` repo + per-coin newb dialog. Coins 4-23 show locked placeholder. D-pad navigates, A zooms, B returns |
| RFID PEDESTAL | 2 | Stub dialog ("Cloned. Now I'm someone else for ninety seconds. Knuckleheads taught me well.") — Day 2 |
| PAYPHONE | 2 | Stub dialog — Day 2 |
| IR WALL | 3 | Stub dialog — Day 2 |
| GRAVITY ARENA | 3 | Stub dialog — Day 2 |
| SUBGHZ TUNER | 3 | Stub dialog — Day 2 |
| PORTAL PEDESTAL | 3 | Stub dialog — Day 2 |

All 9 visited → "MASTER HAKCER" achievement banner + `save_state.pwnglove_mode_complete = true`.

### Canonical pinned assets

Six display-only assets shipped as pinned source files. Pipeline NEVER regenerates them.

| Asset | Source | Where it's used |
|---|---|---|
| `images/title.png` | `docs/hakcd_title.png` | Title screen (full-frame, A/B advances to bedroom, "press any key" blink) |
| `images/pwnglove_icon.png` | `docs/gamepwnglovev2.png` | PWNGLOVE MODE intro splash (1.5s) |
| `images/coins/coin_0..3.png` + `_large.png` | `docs/coin0.png` / `coin1.jpg` / `coin2.jpg` / `coingame.png` | Coin Vault grid + closeup |

### New runtime modules

- `runtime/concepts/progression.lua` — typed wrapper over `save_state`. Adds checkpoint API + PWNGLOVE state + 24-coin status tracking + `cascade_unlock_all_layers()` for Tyson master unlock.
- `runtime/concepts/pwnglove_hud.lua` — global crank-as-power-channel. Tracks `crank_rpm` + `crank_revs_total` + heat overlay + bottom 20-LED HUD strip render.
- `runtime/concepts/pwnglove_lockpick.lua` — full 5-pin lockpick state machine with binding-zone angle check, tension meter, 3 attempts, 60s timer.
- `runtime/concepts/pwnglove_tyson.lua` — digit-entry UI + 007-373-5963 matcher + cascade unlock dispatcher.

### Save state extensions

```
save_state.push_checkpoint(label)
save_state.has_checkpoint(label) -> bool
save_state.restore_checkpoint(label) -> bool
```

Deep-copies `flags` only. Audio prefs (music/sfx enabled+volume) excluded from checkpoint — those persist across mode switches.

### Audio

13 SFX wired (Tier 1: re-aliased from the 6-baseline `sfx_synth.js` set). Sounds are stand-ins; real synth pass in Tier 2.

### Lockpick mechanic spec (Lucas Pope density)

- Crank rotates the AIM compass (0-359°). Indicator triangle points outward.
- Each pin has a hidden BINDING ZONE (default 45°-90° arc width, randomized center per pin).
- A-press locks the current pin if AIM is within its binding zone — pin sets, points awarded, advance to next pin.
- A-press outside binding zone = snap, all pins reset, attempt consumed.
- Tension meter rises +0.15 per A-press. STOP zone (top 20%) = over-tension = reset.
- Tension naturally bleeds off when not pressing.
- 5 pins set within 60s and ≤3 attempts = "** LOCK OPEN **" + win.
- Newb dialog reactions per pin (pin 1, 2, 3, 4, 5) + per failure mode.
- Bottom dialog bar with newb portrait placeholder.

### Tyson cascade spec

- Crank scrolls 0-9 (36° per digit step).
- A-press commits current digit at cursor + auto-skips dashes (`-` at positions 4 and 8).
- 11 slots total (9 digits + 2 dashes). Auto-evaluates on full entry.
- Match `007-373-5963` → cascade-unlock all PWNGLOVE layers + `save_state.tyson_unlock = true` + 3s overlay.
- Mismatch → reset + "That's not it. Try again."
- Already-granted run shows "ALREADY GRANTED — 1987" cabinet glass etching.

## Known gaps / Day-2 work

- All 6 Flipper Zero tools + Portal Gun + Gravity Gun are stub dialogs only — real implementations spawn with the 5-team parallel sprint tomorrow morning.
- SFX are aliased re-uses of the 6 baseline wavs. No bespoke lockpick crank-rasp / 2600Hz tone / arcade WINNER sting yet.
- Playground background is primitive outlines + labels. Real dithered set-dressing per-station deferred.
- Bend-sensor visualization (4-LED finger curl row) not yet implemented — `pwnglove_hud.draw_strip()` shows the 20-LED brightness strip only.
- Coin Vault sidebar layout matches `docs/coingame.png` topology but is not yet pixel-tight to the reference — closer-pass deferred.

## Acceptance for tonight's sideload

1. Boot → canonical title splash → press A → bedroom
2. Hardware menu → "pwnglove mode" → glove splash (1.5s) → playground
3. Walk newb to **LOCKPICK STATION** + A → full lockpick UI matches reference within ~85% (gate-1 success threshold)
4. Crank to rotate AIM, A to lock a pin in binding zone, observe tension rise
5. Snap a pin (wrong angle) → all reset, attempt -1, "Snapped. Try again."
6. Solve 5 pins → "Clean. Knuckleheads style." + lock open
7. Walk to **TYSON CABINET** + A → digit-entry UI
8. Crank → 0..9, A → commit, enter `007-373-5963`
9. On match → ★ TYSON MODE ★ overlay, all PWNGLOVE layers persisted unlocked
10. Walk to **COIN VAULT** + A → 24-card grid viewer
11. D-pad navigates, A zooms into coin (real art for 0-3), B returns to grid
12. B from grid exits viewer back to playground
13. Visit all 9 stations → "MASTER HAKCER" banner
14. Hardware menu → "back to story" → restore checkpoint → title screen

If 14 land clean, this is the demo-video-ready build.

## Files added this release

```
source/main.lua                                    (+system menu hook)
source/runtime/save_state.lua                      (+push/has/restore_checkpoint)
source/runtime/concepts/progression.lua            (NEW)
source/runtime/concepts/pwnglove_hud.lua           (NEW)
source/runtime/concepts/pwnglove_lockpick.lua      (NEW)
source/runtime/concepts/pwnglove_tyson.lua         (NEW)
source/scenes/title.lua                            (rewritten - canonical pin)
source/scenes/pwnglove_mode_intro.lua              (NEW)
source/scenes/pwnglove_playground.lua              (NEW)
source/scenes/coin_vault_viewer.lua                (NEW)
source/data/coins.json                             (NEW)
source/images/title.png                            (canonical pin, 400x240 1-bit)
source/images/pwnglove_icon.png                    (canonical pin, 200x133 1-bit)
source/images/coins/coin_0..3.png + _large.png     (canonical pins, 48 + 200)
source/images/coins/coin_locked.png                (NEW placeholder)
source/images/ui/lockpick_body.png                 (NEW sprite for lockpick UI)
source/images/scenes/pwnglove_playground.png       (NEW placeholder bg)
source/sounds/sfx/{13 new aliases}                 (lockpick + tyson + vault stubs)
```
