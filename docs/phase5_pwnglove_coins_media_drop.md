# FOLLOWUP — PWNGLOVE + 23 C0iNS media drop required

Phase 5 addendum (`docs/phase5_pwnglove_coins_priority.md`) names PWNGLOVE + 23 C0iNS as the top-priority mechanics. The bible binding in `personal/hakcd/sdk_data/story_bible.md` references the media listed below.

## Already on disk (copied from public repos)

These were pulled from the cloned `NoDataFound/23Coins` repo and placed under `bible_media/art/`:

- `23coins_logo_real.jpeg` — official 23 Coins logo (from `23Coins/Art/23.logo.only.jpeg`)
- `23coins_coin0_real.png` — Coin 0 face render (from `23Coins/Coins/Coin0/Coin0.png`)

These can serve as primary refs for the coin grid recipe's art passes until the user supplies higher-fidelity assets.

## Still missing — user must drop

Three MagPi Issue 33 (May 2015) scans referenced by the bible PWNGLOVE section. Required filenames at `/home/hakcer/projects/personal/hakcd/bible_media/art/`:

| Required filename | Source content |
|---|---|
| `pwnglove_real_magpi_hero.jpg` | Cover / hero shot — full PWNGLOVE buildup + Cory headshot |
| `pwnglove_real_magpi_disassembly.jpg` | Build-process page — disassembled glove + parts on a table |
| `pwnglove_real_magpi_feature.jpg` | Feature spread — "Quick Facts" sidebar + build details |

Optional but recommended:

| Filename | Source |
|---|---|
| `trikc0x01_hardware.png` | Real physical coin from `NoDataFound/TriKC0x01` repo, if a render exists |
| `coins_inventory_screen.png` | Canonical in-game coin grid mockup (referenced by `ui_reference` in bible) — may need to be drawn fresh |

## Why this blocks (a little)

Team Bible's PWNGLOVE rewrite during Phase 5 Wave A wires the bible `art:` block to actual filenames. Until the three MagPi scans exist, only `pwnglove_device_pixel.png` is bound and the asset library cannot offer the magazine references to image-gen prompts. The rewrite can ship without them; image fidelity for the SecKC acquisition scene drops accordingly.

## Repos cloned for reference

```
/tmp/coin-refs/23Coins/      # NoDataFound/23Coins — software/protocol
/tmp/coin-refs/TriKC0x01/    # NoDataFound/TriKC0x01 — hardware coin + PWNGLOVE firmware
```

`PwnGlove.ino` in the second repo is the source of truth for: bend sensor layout, NeoPixel matrix (16×16, FastLED palette cycle every 5s), Konami button bitmask order, and the serial protocol.
